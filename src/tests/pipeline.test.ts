/**
 * End-to-end event pipeline integration tests
 * Tests the complete event ingestion flow from HTTP request to storage and fanout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Env } from "../env";
import { EventEnvelopeT } from "../types";

// ============================================================================
// Mock Setup
// ============================================================================

// Mock Clerk JWT verification
vi.mock("../auth/clerk", () => ({
  verifyClerkJWT: vi.fn().mockResolvedValue("user_test123"),
  authError: vi.fn((e) => new Response(JSON.stringify({ error: String(e) }), { status: 401 })),
}));

// Mock rate limiting
vi.mock("../security/rateLimit", () => ({
  rateLimitKV: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock request signature (disabled by default)
vi.mock("../security/signature", () => ({
  verifyRequestSignature: vi.fn().mockResolvedValue({ enabled: false, ok: true }),
}));

// Mock idempotency checks
vi.mock("../security/idempotency", () => ({
  checkIdempotencyKV: vi.fn().mockResolvedValue({ hit: false }),
  storeIdempotencyKV: vi.fn().mockResolvedValue(undefined),
}));

// Mock D1 storage functions
const mockD1InsertEvent = vi.fn().mockResolvedValue(undefined);
const mockD1InsertEventWithTrace = vi.fn().mockResolvedValue(undefined);
const mockD1UpsertIdempotency = vi.fn().mockResolvedValue(null);
const mockD1GetConsent = vi.fn().mockResolvedValue(true);
const mockD1CountUserEvents7d = vi.fn().mockResolvedValue(50);

vi.mock("../storage/d1", () => ({
  d1InsertEvent: (...args: unknown[]) => mockD1InsertEvent(...args),
  d1InsertEventWithTrace: (...args: unknown[]) => mockD1InsertEventWithTrace(...args),
  d1UpsertIdempotency: (...args: unknown[]) => mockD1UpsertIdempotency(...args),
  d1GetConsent: (...args: unknown[]) => mockD1GetConsent(...args),
  d1CountUserEvents7d: (...args: unknown[]) => mockD1CountUserEvents7d(...args),
  d1MarkConvexDelivery: vi.fn().mockResolvedValue(undefined),
  d1MarkSocialDelivery: vi.fn().mockResolvedValue(undefined),
  d1SkipSocialDelivery: vi.fn().mockResolvedValue(undefined),
  d1Audit: vi.fn().mockResolvedValue(undefined),
  d1UpsertProfileSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// Mock redaction
vi.mock("../utils/redact", () => ({
  redactPayload: vi.fn((payload) => payload),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockEnv(): Env {
  return {
    ENVIRONMENT: "test",
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({}),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    } as unknown as D1Database,
    BLOBS: {} as R2Bucket,
    KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    FANOUT_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    CLERK_ISSUER: "https://clerk.test",
    CLERK_JWKS_URL: "https://clerk.test/.well-known/jwks.json",
    CONVEX_INGEST_URL: "https://convex.test/insertBatch",
    R2_ACCOUNT_ID: "test_account",
    R2_BUCKET_NAME: "test_bucket",
    R2_S3_ACCESS_KEY_ID: "test_key",
    R2_S3_SECRET_ACCESS_KEY: "test_secret",
  };
}

function createValidEventEnvelope(overrides: Partial<EventEnvelopeT> = {}): EventEnvelopeT {
  return {
    eventId: "evt_test_12345678",
    userId: "user_test123",
    sourceApp: "browser",
    eventType: "browser.session_started",
    timestamp: Date.now(),
    privacyScope: "private",
    consentVersion: "v1.0",
    idempotencyKey: `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    payload: { sessionId: "sess_123" },
    ...overrides,
  };
}

function createIngestRequest(envelope: EventEnvelopeT, headers: Record<string, string> = {}): Request {
  return new Request("https://gateway.test/v1/events/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test_token",
      "CF-Connecting-IP": "127.0.0.1",
      ...headers,
    },
    body: JSON.stringify(envelope),
  });
}

// ============================================================================
// Event Ingestion Flow Tests
// ============================================================================

describe("Event Ingestion Pipeline", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    // Reset consent to default (enabled)
    mockD1GetConsent.mockResolvedValue(true);
    mockD1UpsertIdempotency.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Valid Event Acceptance", () => {
    it("should accept a valid event and return ok: true", async () => {
      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      // Import the worker handler
      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; eventId?: string };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.eventId).toBe(envelope.eventId);
    });

    it("should store the event in D1", async () => {
      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      await worker.default.fetch(req, mockEnv);

      expect(mockD1InsertEvent).toHaveBeenCalledTimes(1);
      const callArgs = mockD1InsertEvent.mock.calls[0];
      expect(callArgs[1].event.eventId).toBe(envelope.eventId);
    });

    it("should enqueue the event for fanout", async () => {
      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      await worker.default.fetch(req, mockEnv);

      expect(mockEnv.FANOUT_QUEUE.send).toHaveBeenCalledTimes(1);
      const sentEnvelope = (mockEnv.FANOUT_QUEUE.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sentEnvelope.eventId).toBe(envelope.eventId);
    });

    it("should store event with traceId when X-Trace-Id header is present", async () => {
      const envelope = createValidEventEnvelope();
      const traceId = "trace_golden_flow_123";
      const req = createIngestRequest(envelope, { "X-Trace-Id": traceId });

      const worker = await import("../index");
      await worker.default.fetch(req, mockEnv);

      expect(mockD1InsertEventWithTrace).toHaveBeenCalledTimes(1);
      const callArgs = mockD1InsertEventWithTrace.mock.calls[0];
      expect(callArgs[1].traceId).toBe(traceId);
    });
  });

  describe("Invalid Event Rejection", () => {
    it("should reject events with invalid JSON", async () => {
      const req = new Request("https://gateway.test/v1/events/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_token",
          "CF-Connecting-IP": "127.0.0.1",
        },
        body: "{ invalid json }",
      });

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("invalid_json");
    });

    it("should reject events with missing required fields", async () => {
      const invalidEnvelope = {
        eventId: "evt_123",
        // Missing userId, sourceApp, eventType, etc.
      };

      const req = new Request("https://gateway.test/v1/events/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test_token",
          "CF-Connecting-IP": "127.0.0.1",
        },
        body: JSON.stringify(invalidEnvelope),
      });

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("invalid_envelope");
    });

    it("should reject events with unknown event type", async () => {
      const envelope = createValidEventEnvelope({
        eventType: "unknown.event_type_that_does_not_exist",
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string; code?: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("unknown_event_type");
      expect(body.code).toBe("UNKNOWN_EVENT_TYPE");
    });

    it("should reject events with disabled event type", async () => {
      const envelope = createValidEventEnvelope({
        eventType: "browser.form_started", // Disabled in registry
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string; code?: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("event_type_disabled");
    });

    it("should reject events with user ID mismatch", async () => {
      const envelope = createValidEventEnvelope({
        userId: "user_different_user", // Different from JWT user
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string };

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("user_mismatch");
    });
  });

  describe("Duplicate Event Deduplication", () => {
    it("should deduplicate events using KV fast path", async () => {
      const { checkIdempotencyKV } = await import("../security/idempotency");
      const existingEventId = "evt_existing_123";
      (checkIdempotencyKV as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hit: true,
        eventId: existingEventId,
      });

      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; deduped?: boolean; eventId?: string };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.deduped).toBe(true);
      expect(body.eventId).toBe(existingEventId);
    });

    it("should deduplicate events using D1 fallback", async () => {
      const { checkIdempotencyKV } = await import("../security/idempotency");
      (checkIdempotencyKV as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hit: false });

      const existingEventId = "evt_existing_456";
      mockD1UpsertIdempotency.mockResolvedValueOnce(existingEventId);

      const envelope = createValidEventEnvelope({
        eventId: "evt_new_attempt",
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; deduped?: boolean; eventId?: string };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.deduped).toBe(true);
      expect(body.eventId).toBe(existingEventId);
    });

    it("should not store or enqueue deduplicated events", async () => {
      const { checkIdempotencyKV } = await import("../security/idempotency");
      (checkIdempotencyKV as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hit: true,
        eventId: "evt_existing",
      });

      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      await worker.default.fetch(req, mockEnv);

      expect(mockD1InsertEvent).not.toHaveBeenCalled();
      expect(mockEnv.FANOUT_QUEUE.send).not.toHaveBeenCalled();
    });
  });

  describe("Consent Validation", () => {
    it("should reject events when required consent scope is missing", async () => {
      mockD1GetConsent.mockResolvedValue(false);

      const envelope = createValidEventEnvelope({
        eventType: "browser.session_started", // Requires browser.activity_basic consent
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string; scope?: string };

      expect(response.status).toBe(403);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("consent_required");
      expect(body.scope).toBeDefined();
    });

    it("should accept events when all required consent scopes are granted", async () => {
      mockD1GetConsent.mockResolvedValue(true);

      const envelope = createValidEventEnvelope({
        eventType: "browser.session_started",
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should accept events with empty requiredScopes (no consent required)", async () => {
      // consent.updated has empty requiredScopes
      const envelope = createValidEventEnvelope({
        eventType: "consent.updated",
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  describe("Blob Requirement Validation", () => {
    it("should reject events that require blobs but have none", async () => {
      const envelope = createValidEventEnvelope({
        eventType: "finance.receipt_captured", // requiresBlob: true
        blobRefs: [], // Empty or missing
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string; code?: string };

      expect(response.status).toBe(400);
      expect(body.ok).toBe(false);
      // Error comes from validateEventSync which returns message in error field
      expect(body.error).toContain("requires blob attachment");
      expect(body.code).toBe("MISSING_BLOB_REF");
    });

    it("should accept events that require blobs when blobRefs are provided", async () => {
      // Need to ensure consent is granted for finance.receipts
      mockD1GetConsent.mockResolvedValue(true);

      const envelope = createValidEventEnvelope({
        eventType: "finance.receipt_captured",
        sourceApp: "finance",
        blobRefs: [
          {
            r2Key: "receipts/user_test123/receipt_123.jpg",
            contentType: "image/jpeg",
            sizeBytes: 1024000,
          },
        ],
      });
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  describe("Rate Limiting", () => {
    it("should reject requests when rate limited", async () => {
      const { rateLimitKV } = await import("../security/rateLimit");
      (rateLimitKV as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });

      const envelope = createValidEventEnvelope();
      const req = createIngestRequest(envelope);

      const worker = await import("../index");
      const response = await worker.default.fetch(req, mockEnv);
      const body = await response.json() as { ok: boolean; error?: string };

      expect(response.status).toBe(429);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("rate_limited");
    });
  });
});

// ============================================================================
// Batch Ingestion Tests
// ============================================================================

describe("Batch Event Ingestion", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    mockD1GetConsent.mockResolvedValue(true);
    mockD1UpsertIdempotency.mockResolvedValue(null);
  });

  it("should accept multiple valid events in a batch", async () => {
    const events = [
      createValidEventEnvelope({ eventId: "evt_batch_1" }),
      createValidEventEnvelope({ eventId: "evt_batch_2" }),
      createValidEventEnvelope({ eventId: "evt_batch_3" }),
    ];

    const req = new Request("https://gateway.test/v1/events/ingestBatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_token",
        "CF-Connecting-IP": "127.0.0.1",
      },
      body: JSON.stringify({ events }),
    });

    const worker = await import("../index");
    const response = await worker.default.fetch(req, mockEnv);
    const body = await response.json() as { ok: boolean; accepted?: number; rejected?: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(3);
    expect(body.rejected).toBe(0);
  });

  it("should process mixed valid and invalid events", async () => {
    const events = [
      createValidEventEnvelope({ eventId: "evt_valid_1" }),
      createValidEventEnvelope({
        eventId: "evt_invalid_type",
        eventType: "unknown.type",
      }),
      createValidEventEnvelope({ eventId: "evt_valid_2" }),
    ];

    const req = new Request("https://gateway.test/v1/events/ingestBatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_token",
        "CF-Connecting-IP": "127.0.0.1",
      },
      body: JSON.stringify({ events }),
    });

    const worker = await import("../index");
    const response = await worker.default.fetch(req, mockEnv);
    const body = await response.json() as {
      ok: boolean;
      accepted?: number;
      rejected?: number;
      results?: Array<{ eventId: string; ok: boolean; error?: string }>;
    };

    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
    expect(body.results).toHaveLength(3);

    const invalidResult = body.results?.find((r) => r.eventId === "evt_invalid_type");
    expect(invalidResult?.ok).toBe(false);
    expect(invalidResult?.error).toBe("unknown_event_type");
  });

  it("should handle deduplication within batch", async () => {
    const idempotencyKey = "idem_shared_key";
    const events = [
      createValidEventEnvelope({
        eventId: "evt_first",
        idempotencyKey,
      }),
      createValidEventEnvelope({
        eventId: "evt_second",
        idempotencyKey, // Same key - should be deduped
      }),
    ];

    // Mock to return the first eventId when second tries to insert
    mockD1UpsertIdempotency
      .mockResolvedValueOnce(null) // First event - no existing
      .mockResolvedValueOnce("evt_first"); // Second event - returns first

    const req = new Request("https://gateway.test/v1/events/ingestBatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_token",
        "CF-Connecting-IP": "127.0.0.1",
      },
      body: JSON.stringify({ events }),
    });

    const worker = await import("../index");
    const response = await worker.default.fetch(req, mockEnv);
    const body = await response.json() as {
      ok: boolean;
      results?: Array<{ eventId: string; ok: boolean; deduped?: boolean }>;
    };

    expect(body.ok).toBe(true);
    const secondResult = body.results?.find((r) => r.eventId === "evt_first" && r.deduped);
    expect(secondResult).toBeDefined();
    expect(secondResult?.deduped).toBe(true);
  });

  it("should return 400 when all events fail", async () => {
    const events = [
      createValidEventEnvelope({
        eventId: "evt_bad_1",
        eventType: "unknown.type1",
      }),
      createValidEventEnvelope({
        eventId: "evt_bad_2",
        eventType: "unknown.type2",
      }),
    ];

    const req = new Request("https://gateway.test/v1/events/ingestBatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test_token",
        "CF-Connecting-IP": "127.0.0.1",
      },
      body: JSON.stringify({ events }),
    });

    const worker = await import("../index");
    const response = await worker.default.fetch(req, mockEnv);
    const body = await response.json() as { ok: boolean; rejected?: number };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(true); // ok is true even with failures
    expect(body.rejected).toBe(2);
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe("Health Check Endpoint", () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = createMockEnv();
  });

  it("should return healthy status", async () => {
    const req = new Request("https://gateway.test/health", {
      method: "GET",
    });

    const worker = await import("../index");
    const response = await worker.default.fetch(req, mockEnv);
    const body = await response.json() as { status: string; timestamp?: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeDefined();
  });
});
