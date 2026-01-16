/**
 * Fanout handler integration tests
 * Tests Brain, Convex, and Social fanout handlers and queue consumer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Env } from "../env";
import { EventEnvelopeT } from "../types";

// ============================================================================
// Global Fetch Mock
// ============================================================================

const mockFetch = vi.fn();
// Use globalThis for Workers compatibility
(globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

// ============================================================================
// Mock D1 Storage Functions
// ============================================================================

const mockD1MarkConvexDelivery = vi.fn().mockResolvedValue(undefined);
const mockD1MarkSocialDelivery = vi.fn().mockResolvedValue(undefined);
const mockD1SkipSocialDelivery = vi.fn().mockResolvedValue(undefined);
const mockD1GetConsent = vi.fn().mockResolvedValue(false);
const mockD1Audit = vi.fn().mockResolvedValue(undefined);
const mockD1UpsertProfileSnapshot = vi.fn().mockResolvedValue(undefined);

vi.mock("../storage/d1", () => ({
  d1MarkConvexDelivery: (...args: unknown[]) => mockD1MarkConvexDelivery(...args),
  d1MarkSocialDelivery: (...args: unknown[]) => mockD1MarkSocialDelivery(...args),
  d1SkipSocialDelivery: (...args: unknown[]) => mockD1SkipSocialDelivery(...args),
  d1GetConsent: (...args: unknown[]) => mockD1GetConsent(...args),
  d1Audit: (...args: unknown[]) => mockD1Audit(...args),
  d1UpsertProfileSnapshot: (...args: unknown[]) => mockD1UpsertProfileSnapshot(...args),
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
    BRAIN_INGEST_URL: "https://brain.test/ingest",
    BRAIN_QUERY_URL: "https://brain.test/query",
    SOCIAL_SIGNAL_URL: "https://social.test/signal",
    GATEWAY_INTERNAL_KEY: "test_gateway_key",
    R2_ACCOUNT_ID: "test_account",
    R2_BUCKET_NAME: "test_bucket",
    R2_S3_ACCESS_KEY_ID: "test_key",
    R2_S3_SECRET_ACCESS_KEY: "test_secret",
  };
}

function createValidEventEnvelope(overrides: Partial<EventEnvelopeT> = {}): EventEnvelopeT {
  return {
    eventId: `evt_${Math.random().toString(36).substr(2, 9)}`,
    userId: "user_test123",
    sourceApp: "browser",
    eventType: "browser.page_viewed", // brainEnabled: true
    timestamp: Date.now(),
    privacyScope: "private",
    consentVersion: "v1.0",
    idempotencyKey: `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    payload: { url: "https://example.com", title: "Test Page" },
    ...overrides,
  };
}

interface MockMessage<T> {
  body: T;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function createMockMessageBatch<T>(bodies: T[]): MessageBatch<T> {
  return {
    messages: bodies.map((body) => ({
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    })),
    queue: "fanout-queue",
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<T>;
}

// ============================================================================
// Brain Fanout Tests
// ============================================================================

describe("Brain Fanout Handler", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("forwardToBrain", () => {
    it("should forward brain-enabled events to Brain API", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { forwardToBrain } = await import("../fanout/brain");
      const envelope = createValidEventEnvelope({
        eventType: "browser.page_viewed", // brainEnabled: true
      });

      const result = await forwardToBrain(mockEnv, envelope);

      expect(result.forwarded).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://brain.test/ingest",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Gateway-Key": "test_gateway_key",
          }),
        })
      );
    });

    it("should not forward events when brainEnabled is false", async () => {
      const { forwardToBrain, shouldForwardToBrain } = await import("../fanout/brain");
      const envelope = createValidEventEnvelope({
        eventType: "system.app_backgrounded", // brainEnabled: false
      });

      expect(shouldForwardToBrain(envelope.eventType)).toBe(false);

      const result = await forwardToBrain(mockEnv, envelope);

      expect(result.forwarded).toBe(false);
      expect(result.reason).toContain("brainEnabled=false");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not forward when BRAIN_INGEST_URL is not configured", async () => {
      const envWithoutBrain = { ...mockEnv, BRAIN_INGEST_URL: undefined };
      const { forwardToBrain } = await import("../fanout/brain");
      const envelope = createValidEventEnvelope();

      const result = await forwardToBrain(envWithoutBrain, envelope);

      expect(result.forwarded).toBe(false);
      expect(result.reason).toContain("BRAIN_INGEST_URL not configured");
    });

    it("should throw error on Brain API failure", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

      const { forwardToBrain } = await import("../fanout/brain");
      const envelope = createValidEventEnvelope();

      await expect(forwardToBrain(mockEnv, envelope)).rejects.toThrow("Brain ingest failed: 500");
    });

    it("should include traceId in request when present in envelope", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { forwardToBrain } = await import("../fanout/brain");
      const traceId = "trace_golden_123";
      const envelope = { ...createValidEventEnvelope(), traceId } as EventEnvelopeT & { traceId: string };

      await forwardToBrain(mockEnv, envelope);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Trace-Id": traceId,
          }),
        })
      );

      // Verify body includes traceId
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.traceId).toBe(traceId);
    });

    it("should include graphRequired flag based on registry", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { forwardToBrain } = await import("../fanout/brain");
      const envelope = createValidEventEnvelope({
        eventType: "browser.page_viewed", // graphRequired: true
      });

      await forwardToBrain(mockEnv, envelope);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.graphRequired).toBe(true);
    });
  });

  describe("forwardToBrainBatch", () => {
    it("should forward multiple events in batch", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { forwardToBrainBatch } = await import("../fanout/brain");
      const envelopes = [
        createValidEventEnvelope({ eventId: "evt_batch_001" }),
        createValidEventEnvelope({ eventId: "evt_batch_002" }),
        createValidEventEnvelope({ eventId: "evt_batch_003" }),
      ];

      const results = await forwardToBrainBatch(mockEnv, envelopes);

      expect(results.size).toBe(3);
      expect(results.get("evt_batch_001")?.forwarded).toBe(true);
      expect(results.get("evt_batch_002")?.forwarded).toBe(true);
      expect(results.get("evt_batch_003")?.forwarded).toBe(true);
    });

    it("should skip non-brain-enabled events in batch", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { forwardToBrainBatch } = await import("../fanout/brain");
      const envelopes = [
        createValidEventEnvelope({ eventId: "evt_brain", eventType: "browser.page_viewed" }),
        createValidEventEnvelope({ eventId: "evt_no_brain", eventType: "system.app_backgrounded" }),
      ];

      const results = await forwardToBrainBatch(mockEnv, envelopes);

      expect(results.get("evt_brain")?.forwarded).toBe(true);
      expect(results.get("evt_no_brain")?.forwarded).toBe(false);
      expect(results.get("evt_no_brain")?.reason).toContain("brainEnabled=false");
    });

    it("should return all skipped when no events are brain-enabled", async () => {
      const { forwardToBrainBatch } = await import("../fanout/brain");
      const envelopes = [
        createValidEventEnvelope({ eventId: "evt_1", eventType: "system.app_backgrounded" }),
        createValidEventEnvelope({ eventId: "evt_2", eventType: "system.upload_succeeded" }),
      ];

      const results = await forwardToBrainBatch(mockEnv, envelopes);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(results.get("evt_1")?.forwarded).toBe(false);
      expect(results.get("evt_2")?.forwarded).toBe(false);
    });
  });

  describe("queryBrain", () => {
    it("should send query to Brain API", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ answer: "Test answer", sources: [] }), { status: 200 })
      );

      const { queryBrain } = await import("../fanout/brain");
      const query = {
        userId: "user_test123",
        query: "What did I do yesterday?",
        scopes: ["browser"],
      };

      const result = await queryBrain(mockEnv, query);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://brain.test/query",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toHaveProperty("answer");
    });

    it("should throw error when BRAIN_QUERY_URL is not configured", async () => {
      const envWithoutBrain = { ...mockEnv, BRAIN_QUERY_URL: undefined };
      const { queryBrain } = await import("../fanout/brain");

      await expect(queryBrain(envWithoutBrain, { userId: "user_123", query: "test" })).rejects.toThrow(
        "Missing BRAIN_QUERY_URL"
      );
    });

    it("should throw error on invalid query body", async () => {
      const { queryBrain } = await import("../fanout/brain");

      await expect(queryBrain(mockEnv, { userId: "", query: "" })).rejects.toThrow("Invalid BrainQueryBody");
    });
  });
});

// ============================================================================
// Convex Fanout Tests
// ============================================================================

describe("Convex Fanout Handler", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    mockFetch.mockReset();
  });

  describe("sendToConvex", () => {
    it("should send events to Convex with legacy auth", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { sendToConvex } = await import("../fanout/convex");
      const batch = [createValidEventEnvelope(), createValidEventEnvelope()];

      await sendToConvex(mockEnv, batch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://convex.test/insertBatch",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Gateway-Key": "test_gateway_key",
          }),
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.events).toHaveLength(2);
    });

    it("should use HMAC signing when ORION_HMAC_SHARED_SECRET is configured", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, summary: { errors: 0 } }), { status: 200 })
      );

      const envWithHmac = {
        ...mockEnv,
        ORION_HMAC_SHARED_SECRET: "test_hmac_secret",
      };
      const { sendToConvex } = await import("../fanout/convex");
      const batch = [createValidEventEnvelope()];

      await sendToConvex(envWithHmac, batch);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/ingest/queueBatch"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Orion-Signature": expect.stringMatching(/^sha256=[a-f0-9]+$/),
          }),
        })
      );
    });

    it("should throw error on Convex API failure", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));

      const { sendToConvex } = await import("../fanout/convex");
      const batch = [createValidEventEnvelope()];

      await expect(sendToConvex(mockEnv, batch)).rejects.toThrow("Convex ingest failed: 503");
    });

    it("should throw error when CONVEX_INGEST_URL is missing", async () => {
      const envWithoutConvex = { ...mockEnv, CONVEX_INGEST_URL: "" };
      const { sendToConvex } = await import("../fanout/convex");

      await expect(sendToConvex(envWithoutConvex, [createValidEventEnvelope()])).rejects.toThrow(
        "Missing CONVEX_INGEST_URL"
      );
    });

    it("should transform batch format for HMAC endpoint", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, summary: { errors: 0 } }), { status: 200 })
      );

      const envWithHmac = {
        ...mockEnv,
        ORION_HMAC_SHARED_SECRET: "test_secret",
      };
      const { sendToConvex } = await import("../fanout/convex");
      const batch = [
        createValidEventEnvelope({ userId: "user_1" }),
        createValidEventEnvelope({ userId: "user_2" }),
      ];

      await sendToConvex(envWithHmac, batch);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]).toHaveProperty("envelope");
      expect(body.messages[0]).toHaveProperty("userId");
      expect(body.messages[0]).toHaveProperty("tenantId");
    });
  });
});

// ============================================================================
// Queue Consumer Tests
// ============================================================================

describe("Queue Consumer (handleFanoutBatch)", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();
    mockFetch.mockReset();
    mockD1GetConsent.mockResolvedValue(false); // Default: social opt-in disabled
  });

  describe("Convex Delivery", () => {
    it("should deliver all events to Convex successfully", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const batch = createMockMessageBatch([
        createValidEventEnvelope({ eventId: "evt_1" }),
        createValidEventEnvelope({ eventId: "evt_2" }),
      ]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockFetch).toHaveBeenCalled();
      expect(mockD1MarkConvexDelivery).toHaveBeenCalledTimes(2);

      // Verify success was marked
      const call1 = mockD1MarkConvexDelivery.mock.calls[0];
      expect(call1[1]).toBe("evt_1");
      expect(call1[2].success).toBe(true);
    });

    it("should retry entire batch on Convex failure", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Error", { status: 500 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelopes = [createValidEventEnvelope({ eventId: "evt_1" })];
      const batch = createMockMessageBatch(envelopes);

      await handleFanoutBatch(batch, mockEnv);

      // Verify retry was called
      const msg = batch.messages[0] as unknown as MockMessage<EventEnvelopeT>;
      expect(msg.retry).toHaveBeenCalled();

      // Verify failure was marked
      expect(mockD1MarkConvexDelivery).toHaveBeenCalledWith(
        mockEnv,
        "evt_1",
        expect.objectContaining({
          success: false,
        })
      );

      // Verify audit log was written
      expect(mockD1Audit).toHaveBeenCalledWith(mockEnv, "fanout_convex_failed", expect.any(String));
    });
  });

  describe("Profile Snapshot Processing", () => {
    it("should process profile.avatar_snapshot_updated events", async () => {
      // Setup successful Convex delivery
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_profile",
        eventType: "profile.avatar_snapshot_updated",
        payload: {
          questionnaireId: "avatar.core.v1",
          questionnaireVersion: 1,
          answers: { q1: "answer1" },
          answerCount: 1,
        },
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockD1UpsertProfileSnapshot).toHaveBeenCalled();
    });

    it("should process profile.app_snapshot_updated events", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_app_profile",
        eventType: "profile.app_snapshot_updated",
        payload: {
          questionnaireId: "email.preferences.v1",
          questionnaireVersion: 1,
          answers: { theme: "dark" },
          answerCount: 1,
          appId: "email",
        },
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockD1UpsertProfileSnapshot).toHaveBeenCalled();
    });

    it("should continue processing even if profile snapshot fails", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      mockD1UpsertProfileSnapshot.mockRejectedValueOnce(new Error("DB Error"));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const batch = createMockMessageBatch([
        createValidEventEnvelope({
          eventId: "evt_profile_fail",
          eventType: "profile.avatar_snapshot_updated",
          payload: { questionnaireId: "test" },
        }),
      ]);

      // Should not throw
      await handleFanoutBatch(batch, mockEnv);

      // Verify audit log recorded the failure
      expect(mockD1Audit).toHaveBeenCalledWith(
        mockEnv,
        "profile_snapshot_failed",
        expect.stringContaining("evt_profile_fail")
      );
    });
  });

  describe("Brain Delivery", () => {
    it("should forward brain-enabled events to Brain", async () => {
      // Convex success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      // Brain success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_brain",
        eventType: "browser.page_viewed", // brainEnabled: true
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      // Should have called fetch twice (Convex + Brain)
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify Brain was called
      const brainCall = mockFetch.mock.calls[1];
      expect(brainCall[0]).toBe("https://brain.test/ingest");
    });

    it("should skip Brain for non-brain-enabled events", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_no_brain",
        eventType: "system.app_backgrounded", // brainEnabled: false
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      // Only Convex should be called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe("https://convex.test/insertBatch");
    });

    it("should log Brain failures but not block queue", async () => {
      // Convex success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      // Brain failure
      mockFetch.mockResolvedValueOnce(new Response("Error", { status: 500 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_brain_fail",
        eventType: "browser.page_viewed",
      });
      const batch = createMockMessageBatch([envelope]);

      // Should not throw
      await handleFanoutBatch(batch, mockEnv);

      // Verify audit log recorded the failure
      expect(mockD1Audit).toHaveBeenCalledWith(
        mockEnv,
        "fanout_brain_failed",
        expect.stringContaining("evt_brain_fail"),
        expect.any(String)
      );
    });
  });

  describe("Social Delivery", () => {
    it("should skip social for private scope events", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_private",
        privacyScope: "private",
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockD1SkipSocialDelivery).toHaveBeenCalledWith(mockEnv, "evt_private", "private scope");
    });

    it("should skip social when user not opted in", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      mockD1GetConsent.mockResolvedValue(false); // Not opted in

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_no_optin",
        privacyScope: "social",
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockD1SkipSocialDelivery).toHaveBeenCalledWith(mockEnv, "evt_no_optin", "user not opted in");
    });

    it("should forward to social when user opted in and scope allows", async () => {
      // Convex success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      // Social success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      mockD1GetConsent.mockResolvedValue(true); // Opted in

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_social",
        eventType: "system.app_backgrounded", // brainEnabled: false, so no Brain call
        privacyScope: "social",
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      // Verify social delivery was marked
      expect(mockD1MarkSocialDelivery).toHaveBeenCalledWith(
        mockEnv,
        "evt_social",
        expect.objectContaining({ success: true })
      );
    });

    it("should retry social on failure", async () => {
      // Convex success
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      // Social failure
      mockFetch.mockResolvedValueOnce(new Response("Error", { status: 503 }));
      mockD1GetConsent.mockResolvedValue(true);

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_social_fail",
        eventType: "system.app_backgrounded",
        privacyScope: "social",
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      const msg = batch.messages[0] as unknown as MockMessage<EventEnvelopeT>;
      expect(msg.retry).toHaveBeenCalled();

      expect(mockD1MarkSocialDelivery).toHaveBeenCalledWith(
        mockEnv,
        "evt_social_fail",
        expect.objectContaining({ success: false })
      );
    });

    it("should send reduced signal to social (no raw payload)", async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      mockD1GetConsent.mockResolvedValue(true);

      const { handleFanoutBatch } = await import("../queues/consumer");
      const envelope = createValidEventEnvelope({
        eventId: "evt_social_signal",
        eventType: "system.app_backgrounded",
        privacyScope: "social",
        payload: { sensitiveData: "should_not_be_sent" },
      });
      const batch = createMockMessageBatch([envelope]);

      await handleFanoutBatch(batch, mockEnv);

      // Find the social call
      const socialCall = mockFetch.mock.calls.find((call) =>
        (call[0] as string).includes("social.test")
      );
      expect(socialCall).toBeDefined();

      const body = JSON.parse(socialCall![1].body as string);
      expect(body).not.toHaveProperty("sensitiveData");
      expect(body).toHaveProperty("userId");
      expect(body).toHaveProperty("eventType");
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("privacyScope");
    });
  });

  describe("Batch Processing", () => {
    it("should process multiple events with mixed destinations", async () => {
      // Setup multiple fetch responses
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) // Convex batch
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) // Brain 1
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })); // Brain 2

      mockD1GetConsent.mockResolvedValue(false); // No social

      const { handleFanoutBatch } = await import("../queues/consumer");
      const batch = createMockMessageBatch([
        createValidEventEnvelope({
          eventId: "evt_1",
          eventType: "browser.page_viewed", // Brain enabled
          privacyScope: "private",
        }),
        createValidEventEnvelope({
          eventId: "evt_2",
          eventType: "system.app_backgrounded", // No Brain
          privacyScope: "private",
        }),
        createValidEventEnvelope({
          eventId: "evt_3",
          eventType: "browser.link_clicked", // Brain enabled
          privacyScope: "private",
        }),
      ]);

      await handleFanoutBatch(batch, mockEnv);

      // Convex should be called once with all events
      expect(mockD1MarkConvexDelivery).toHaveBeenCalledTimes(3);

      // All messages should be acked (private scope = no social)
      for (const msg of batch.messages) {
        const mockMsg = msg as unknown as MockMessage<EventEnvelopeT>;
        expect(mockMsg.ack).toHaveBeenCalled();
      }
    });
  });

  describe("Error Recovery", () => {
    it("should mark failure status with HTTP status code when available", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));

      const { handleFanoutBatch } = await import("../queues/consumer");
      const batch = createMockMessageBatch([createValidEventEnvelope({ eventId: "evt_http_error" })]);

      await handleFanoutBatch(batch, mockEnv);

      expect(mockD1MarkConvexDelivery).toHaveBeenCalledWith(
        mockEnv,
        "evt_http_error",
        expect.objectContaining({
          success: false,
          httpStatus: 502,
        })
      );
    });
  });
});

// ============================================================================
// Social Signal Reduction Tests
// ============================================================================

describe("Social Signal Reduction", () => {
  it("should reduce event to minimal social signal", async () => {
    const { reduceToSocialSignal } = await import("../fanout/social");

    const envelope = {
      eventId: "evt_test_123",
      userId: "user_123",
      sourceApp: "browser",
      eventType: "browser.page_viewed",
      timestamp: 1704067200000,
      privacyScope: "social" as const,
      consentVersion: "1.0",
      idempotencyKey: "idem_test_123",
      payload: {
        url: "https://sensitive-site.com/secret-page",
        title: "Secret Document",
        category: "productivity",
        sensitiveField: "should_be_removed",
      },
    };

    const signal = reduceToSocialSignal(envelope);

    expect(signal.userId).toBe("user_123");
    expect(signal.eventType).toBe("browser.page_viewed");
    expect(signal.timestamp).toBe(1704067200000);
    expect(signal.privacyScope).toBe("social");
    expect(signal.category).toBe("productivity");

    // Sensitive fields should NOT be present
    expect(signal).not.toHaveProperty("url");
    expect(signal).not.toHaveProperty("title");
    expect(signal).not.toHaveProperty("sensitiveField");
    expect(signal).not.toHaveProperty("payload");
  });
});
