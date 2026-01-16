/**
 * Orion Edge Gateway
 * Single entrypoint for all iOS apps and dashboard
 *
 * Responsibilities:
 * - Auth verification (Clerk JWT)
 * - Request signature verification (optional HMAC)
 * - Rate limiting (KV)
 * - Idempotency (KV + D1)
 * - Consent enforcement
 * - Event redaction (registry.json policy)
 * - Fanout to Convex, Brain, Social
 * - Blob upload (R2)
 */

import { Env } from "./env";
import { json, text, corsOptions } from "./utils/respond";
import { verifyClerkJWT, authError } from "./auth/clerk";
import { verifyRequestSignature } from "./security/signature";
import { rateLimitKV } from "./security/rateLimit";
import { checkIdempotencyKV, storeIdempotencyKV } from "./security/idempotency";
import { redactPayload } from "./utils/redact";
import { d1InsertEvent, d1InsertEventWithTrace, d1UpsertIdempotency, d1CountUserEvents7d, d1GetConsent } from "./storage/d1";
import { EventEnvelope, BatchIngestRequest, BrainQueryRequest } from "./types";
import { createLogger } from "./utils/logger";

const logger = createLogger({ module: "index" });

// Validation (suite-contracts integration)
import {
  validateEventSync,
  formatValidationErrors,
  ValidationErrorCodes,
} from "./validation/validateEvent";

// Registry-driven enforcement (Window 26)
// The registry is the SINGLE SOURCE OF TRUTH for all policy decisions
import {
  getPolicy,
  getRedactKeys,
} from "./validation/registry";

// Consent enforcement (Window 25 + 26)
// Note: getRequiredScopes is now also available from registry.ts
// but we keep using consent/scopes.ts for backwards compatibility
import { getRequiredScopes } from "./consent/scopes";

// Endpoints
import { handleEventsList } from "./admin/eventsList";
import { handleDeliveryStatus, handleDeliveryRecent, handleDeliveryRequeue } from "./admin/delivery";
import {
  handleEventsListByTrace,
  handleDeliveryStatusByTrace,
  handleDeliveryReplayByTrace,
} from "./admin/provability";
import { handleConsentGet, handleConsentSet, handleConsentUpdate, handleConsentScopes } from "./endpoints/consent";
import { handleEventsMine } from "./endpoints/eventsMine";
import { handleEventsRecent } from "./endpoints/eventsRecent";
import { handleDashboardSearch } from "./endpoints/dashboardSearch";
import { handleWhoami } from "./endpoints/whoami";
import { handleProfileGet, handleProfileUpdate } from "./endpoints/profile";
import { handleProfileSnapshotGet, handleAvatarSnapshotGet } from "./endpoints/profileSnapshot";
import { handleSignedUpload, handleBlobUpload, handleBlobGet, handleBlobDelete } from "./blobs/signedUpload";
import { queryBrain } from "./fanout/brain";
import { handleFanoutBatch } from "./queues/consumer";
import { handleInternalEventsList } from "./endpoints/internalEventsList";
import { handleBrainAnswer } from "./endpoints/brainAnswer";

// Proxies
import {
  handleSocialInvitesList,
  handleSocialInvitesRespond,
  handleSocialSettingsGet,
  handleSocialSettingsSet,
  handleSocialEdgesList,
  handleSocialEdgesCreate,
  handleSocialEdgesRemove,
} from "./proxy/social";
import {
  handleCalendarProposalsList,
  handleCalendarProposalsAck,
  handleCalendarSettingsGet,
  handleCalendarLocksGet,
} from "./proxy/calendar";
import {
  handleOpsConvexHasEvent,
  handleOpsBrainStatus,
  handleOpsNeo4jHasNode,
} from "./routes/ops";
import { handleA2PStatus } from "./twilio/a2p";
import { handleNumbersList, handleNumberSetDefault } from "./twilio/numbers";
import { handleTwilioToken } from "./twilio/token";
import { handleVoiceOutbound, handleVoiceFallback, handleVoiceStatus, handleRecordingStatus, handleVoiceInbound } from "./twilio/voice";
import { handleSmsInbound, handleSmsStatus } from "./twilio/sms";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return corsOptions();
    }

    // Health check
    if (pathname === "/health") {
      return json({ status: "healthy", timestamp: Date.now() });
    }

    // ========================================================================
    // Twilio webhook routes (authenticated via Twilio signature, not Clerk JWT)
    // These must be public endpoints that Twilio can call
    // ========================================================================
    if (url.pathname === "/twilio/voice/outbound" && req.method === "POST") {
      return handleVoiceOutbound(req, env);
    }
    if (url.pathname === "/twilio/voice/inbound" && req.method === "POST") {
      return handleVoiceInbound(req, env);
    }
    if (url.pathname === "/twilio/voice/fallback" && req.method === "POST") {
      return handleVoiceFallback(req, env);
    }
    if (url.pathname === "/twilio/voice/status" && req.method === "POST") {
      return handleVoiceStatus(req, env);
    }
    if (url.pathname === "/twilio/voice/recording" && req.method === "POST") {
      return handleRecordingStatus(req, env);
    }
    if (url.pathname === "/twilio/sms/inbound" && req.method === "POST") {
      return handleSmsInbound(req, env);
    }
    if (url.pathname === "/twilio/sms/status" && req.method === "POST") {
      return handleSmsStatus(req, env);
    }

    // ========================================================================
    // Admin endpoints (X-Admin-Key auth)
    // ========================================================================
    if (pathname === "/v1/events/list" && method === "GET") {
      // Check if traceId param is present - use provability endpoint
      const url = new URL(req.url);
      if (url.searchParams.has("traceId")) {
        return handleEventsListByTrace(req, env);
      }
      return handleEventsList(req, env);
    }

    // --- Admin Delivery Status ---
    if (pathname === "/v1/admin/delivery/status" && method === "GET") {
      // Check if traceId param is present - use provability endpoint
      const url = new URL(req.url);
      if (url.searchParams.has("traceId")) {
        return handleDeliveryStatusByTrace(req, env);
      }
      return handleDeliveryStatus(req, env);
    }

    if (pathname === "/v1/admin/delivery/recent" && method === "GET") {
      return handleDeliveryRecent(req, env);
    }

    if (pathname === "/v1/admin/delivery/requeue" && method === "POST") {
      return handleDeliveryRequeue(req, env);
    }

    // --- Provability Replay (traceId-based) ---
    if (pathname === "/v1/admin/delivery/replay" && method === "GET") {
      return handleDeliveryReplayByTrace(req, env);
    }

    // --- Ops Proxy Routes (Window 111) ---
    if (pathname === "/v1/ops/convex/hasEvent" && method === "GET") {
      return handleOpsConvexHasEvent(req, env);
    }

    if (pathname === "/v1/ops/brain/status" && method === "GET") {
      return handleOpsBrainStatus(req, env);
    }

    if (pathname === "/v1/ops/neo4j/hasNode" && method === "GET") {
      return handleOpsNeo4jHasNode(req, env);
    }

    // --- Internal Events List (service-only, for brain-platform - Window G) ---
    if (pathname === "/v1/internal/events/list" && method === "GET") {
      return handleInternalEventsList(req, env);
    }

    // ========================================================================
    // Public endpoints (Clerk JWT auth)
    // ========================================================================
    try {
      // --- Events ---
      if (pathname === "/v1/events/ingest" && method === "POST") {
        return await handleEventsIngest(req, env);
      }

      if (pathname === "/v1/events/ingestBatch" && method === "POST") {
        return await handleEventsIngestBatch(req, env);
      }

      // Window H.9: Emit/insertBatch route aliases for compatibility
      if (pathname === "/v1/events/emit" && method === "POST") {
        return await handleEventsIngest(req, env);
      }

      if (pathname === "/v1/events/insertBatch" && method === "POST") {
        return await handleEventsIngestBatch(req, env);
      }

      if (pathname === "/v1/events/mine" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleEventsMine(req, env, userId);
      }

      if (pathname === "/v1/events/recent" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleEventsRecent(req, env, userId);
      }

      // --- Profile Snapshots (Window B) ---
      if (pathname === "/v1/me/profile-snapshot" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleProfileSnapshotGet(req, env, userId);
      }

      if (pathname === "/v1/me/profile-snapshot/avatar" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleAvatarSnapshotGet(req, env, userId);
      }

      // --- Dashboard Search ---
      if (pathname === "/v1/dashboard/search" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleDashboardSearch(req, env, userId);
      }

      // --- Auth / Identity ---
      if (pathname === "/v1/auth/whoami" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleWhoami(req, env, userId);
      }

      // --- Profile ---
      if (pathname === "/v1/profile/get" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleProfileGet(req, env, userId);
      }

      if (pathname === "/v1/profile/update" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleProfileUpdate(req, env, userId);
      }

      // --- Consent ---
      if (pathname === "/v1/consent/get" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleConsentGet(req, env, userId);
      }

      if (pathname === "/v1/consent/set" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleConsentSet(req, env, userId);
      }

      // --- Consent Update (Window 25 - bulk update) ---
      if (pathname === "/v1/consent/update" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleConsentUpdate(req, env, userId);
      }

      // --- Consent Scopes (Window 25 - list available scopes) ---
      if (pathname === "/v1/consent/scopes" && method === "GET") {
        return await handleConsentScopes(req, env);
      }

      // --- Brain Query ---
      if (pathname === "/v1/brain/query" && method === "POST") {
        return await handleBrainQuery(req, env);
      }

      // --- Brain Answer (Window G) ---
      if (pathname === "/v1/brain/answer" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleBrainAnswer(req, env, userId);
      }

      // --- Twilio Token ---
      if (pathname === "/v1/twilio/token" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleTwilioToken(req, env, userId);
      }

      // --- Blob Upload ---
      if (pathname === "/v1/blobs/signUpload" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleSignedUpload(req, env, userId);
      }

      if (pathname.startsWith("/v1/blobs/upload/") && method === "PUT") {
        const userId = await verifyClerkJWT(req, env);
        const r2Key = pathname.replace("/v1/blobs/upload/", "");
        return handleBlobUpload(req, env, userId, r2Key);
      }

      // Blob retrieval (GET)
      if (pathname.startsWith("/v1/blobs/") && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        const r2Key = pathname.replace("/v1/blobs/", "");
        return handleBlobGet(req, env, userId, r2Key);
      }

      // Blob deletion (DELETE)
      if (pathname.startsWith("/v1/blobs/") && method === "DELETE") {
        const userId = await verifyClerkJWT(req, env);
        const r2Key = pathname.replace("/v1/blobs/", "");
        return handleBlobDelete(req, env, userId, r2Key);
      }

      // --- Social Proxy ---
      if (pathname === "/v1/social/invites" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialInvitesList(req, env, userId);
      }

      if (pathname === "/v1/social/invites/respond" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialInvitesRespond(req, env, userId);
      }

      if (pathname === "/v1/social/settings" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialSettingsGet(req, env, userId);
      }

      if (pathname === "/v1/social/settings" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialSettingsSet(req, env, userId);
      }

      if (pathname === "/v1/social/edges" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialEdgesList(req, env, userId);
      }

      if (pathname === "/v1/social/edges" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialEdgesCreate(req, env, userId);
      }

      if (pathname === "/v1/social/edges" && method === "DELETE") {
        const userId = await verifyClerkJWT(req, env);
        return handleSocialEdgesRemove(req, env, userId);
      }

      // --- Calendar Proxy ---
      if (pathname === "/v1/calendar/proposals" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleCalendarProposalsList(req, env, userId);
      }

      if (pathname === "/v1/calendar/proposals/ack" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleCalendarProposalsAck(req, env, userId);
      }

      if (pathname === "/v1/calendar/settings" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleCalendarSettingsGet(req, env, userId);
      }

      if (pathname === "/v1/calendar/locks" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleCalendarLocksGet(req, env, userId);
      }

      // --- A2P Status ---
      if (pathname === "/v1/a2p/status" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleA2PStatus(req, env, userId);
      }

      // --- Numbers ---
      if (pathname === "/v1/numbers/list" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleNumbersList(req, env, userId);
      }

      if (pathname === "/v1/numbers/setDefault" && method === "POST") {
        const userId = await verifyClerkJWT(req, env);
        return handleNumberSetDefault(req, env, userId);
      }

      return text("not found", 404);
    } catch (e) {
      return authError(e);
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    // Cast to the expected type - messages are QueueEventEnvelope
    await handleFanoutBatch(batch as MessageBatch<import("./types/queue").QueueEventEnvelope>, env);
  },
} satisfies ExportedHandler<Env>;

// ============================================================================
// Event Ingestion Handlers
// ============================================================================

async function handleEventsIngest(req: Request, env: Env): Promise<Response> {
  // Rate limit (IP-based, lightweight)
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const rl = await rateLimitKV(env, `rl:${ip}:/v1/events/ingest`, 120, 60);
  if (!rl.ok) return json({ ok: false, error: "rate_limited" }, 429);

  // Verify JWT
  const clerkUserId = await verifyClerkJWT(req, env);

  // Read raw body for signature verification
  const rawBody = await req.arrayBuffer();

  // Optional request signature
  const sig = await verifyRequestSignature(req, env, rawBody);
  if (sig.enabled && !sig.ok) {
    return json({ ok: false, error: sig.reason ?? "bad_signature" }, 401);
  }

  // Parse + validate body
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const result = EventEnvelope.safeParse(parsed);
  if (!result.success) {
    return json({ ok: false, error: "invalid_envelope", details: result.error.issues }, 400);
  }

  const envelope = result.data;

  // ========================================================================
  // WINDOW 26: REGISTRY-DRIVEN ENFORCEMENT
  // The registry is the SINGLE SOURCE OF TRUTH for all policy decisions
  // ========================================================================

  // Step 1: Get policy from registry
  const policy = getPolicy(envelope.eventType);

  // Check for unknown eventType (not in registry)
  if (!policy) {
    return json({
      ok: false,
      error: "unknown_event_type",
      code: "UNKNOWN_EVENT_TYPE",
      message: `Event type "${envelope.eventType}" is not registered`,
    }, 400);
  }

  // Check for disabled eventType
  if (!policy.enabled) {
    return json({
      ok: false,
      error: "event_type_disabled",
      code: "EVENT_TYPE_DISABLED",
      message: `Event type "${envelope.eventType}" is currently disabled`,
    }, 400);
  }

  // Additional validation (schema, etc.)
  const validationResult = validateEventSync(envelope);
  if (!validationResult.valid) {
    const formatted = formatValidationErrors(validationResult);
    const statusCode =
      formatted.code === ValidationErrorCodes.UNKNOWN_EVENT_TYPE ? 400 :
      formatted.code === ValidationErrorCodes.EVENT_TYPE_DISABLED ? 403 : 400;
    return json({
      ok: false,
      error: formatted.error,
      code: formatted.code,
      details: formatted.details,
    }, statusCode);
  }

  // Enforce identity (don't allow spoofing userId)
  if (envelope.userId !== clerkUserId) {
    return json({ ok: false, error: "user_mismatch" }, 403);
  }

  // ========================================================================
  // CONSENT ENFORCEMENT (Window 26 - Registry-Driven)
  // Uses policy.requiredScopes from registry, falls back to consentScope
  // ========================================================================

  // Get required scopes from registry (primary) or fall back to legacy
  const requiredScopes = policy.requiredScopes && policy.requiredScopes.length > 0
    ? policy.requiredScopes
    : policy.consentScope ? [policy.consentScope] : [];

  // Check each required scope
  if (requiredScopes.length > 0) {
    for (const scope of requiredScopes) {
      const hasConsent = await d1GetConsent(env, clerkUserId, scope);
      if (!hasConsent) {
        return json({
          ok: false,
          error: "consent_required",
          scope,
          message: `Missing consent for scope: ${scope}`,
        }, 403);
      }
    }
  }

  // ========================================================================
  // BLOB REQUIREMENT CHECK (Window 26)
  // If requiresBlob is true, envelope must have non-empty blobRefs
  // ========================================================================

  if (policy.requiresBlob && (!envelope.blobRefs || envelope.blobRefs.length === 0)) {
    return json({
      ok: false,
      error: "missing_blob_refs",
      code: "MISSING_BLOB_REFS",
      message: `Event type "${envelope.eventType}" requires blob attachments`,
    }, 400);
  }

  // KV idempotency fast path
  const kvHit = await checkIdempotencyKV(env, envelope.userId, envelope.idempotencyKey);
  if (kvHit.hit) {
    return json({ ok: true, deduped: true, eventId: kvHit.eventId }, 200);
  }

  // Durable idempotency in D1
  const existingEventId = await d1UpsertIdempotency(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);
  if (existingEventId && existingEventId !== envelope.eventId) {
    await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, existingEventId);
    return json({ ok: true, deduped: true, eventId: existingEventId }, 200);
  }

  // Redact payload before storage (using registry)
  const redactKeys = getRedactKeys(envelope.eventType);
  const redacted = redactPayload(envelope.payload, redactKeys);
  const payloadJson = JSON.stringify(redacted);
  const blobRefsJson = envelope.blobRefs ? JSON.stringify(envelope.blobRefs) : null;

  // Extract traceId from headers for golden flow tests
  const traceId = req.headers.get("X-Trace-Id") ?? undefined;

  // Store event with optional traceId
  if (traceId) {
    await d1InsertEventWithTrace(env, { event: envelope, payloadJson, blobRefsJson, traceId });
  } else {
    await d1InsertEvent(env, { event: envelope, payloadJson, blobRefsJson });
  }
  await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);

  // Enqueue for fanout (include traceId in envelope for downstream tracking)
  const fanoutEnvelope = traceId ? { ...envelope, traceId } : envelope;
  await env.FANOUT_QUEUE.send(fanoutEnvelope);

  return json({ ok: true, eventId: envelope.eventId }, 200);
}

async function handleEventsIngestBatch(req: Request, env: Env): Promise<Response> {
  // Rate limit
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const rl = await rateLimitKV(env, `rl:${ip}:/v1/events/ingestBatch`, 30, 60);
  if (!rl.ok) return json({ ok: false, error: "rate_limited" }, 429);

  // Verify JWT
  const clerkUserId = await verifyClerkJWT(req, env);

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const result = BatchIngestRequest.safeParse(body);
  if (!result.success) {
    return json({ ok: false, error: "invalid_request", details: result.error.issues }, 400);
  }

  const { events } = result.data;
  const results: Array<{ eventId: string; ok: boolean; error?: string; code?: string; deduped?: boolean }> = [];

  // Extract traceId from headers for golden flow tests
  const traceId = req.headers.get("X-Trace-Id") ?? undefined;

  for (const envelope of events) {
    try {
      // ========================================================================
      // WINDOW 26: REGISTRY-DRIVEN ENFORCEMENT (per event in batch)
      // ========================================================================

      // Step 1: Get policy from registry
      const policy = getPolicy(envelope.eventType);

      // Check for unknown eventType
      if (!policy) {
        results.push({
          eventId: envelope.eventId,
          ok: false,
          error: "unknown_event_type",
          code: "UNKNOWN_EVENT_TYPE",
        });
        continue;
      }

      // Check for disabled eventType
      if (!policy.enabled) {
        results.push({
          eventId: envelope.eventId,
          ok: false,
          error: "event_type_disabled",
          code: "EVENT_TYPE_DISABLED",
        });
        continue;
      }

      // Additional validation (schema, etc.)
      const validationResult = validateEventSync(envelope);
      if (!validationResult.valid) {
        const formatted = formatValidationErrors(validationResult);
        results.push({
          eventId: envelope.eventId,
          ok: false,
          error: formatted.error,
          code: formatted.code,
        });
        continue;
      }

      // Enforce identity
      if (envelope.userId !== clerkUserId) {
        results.push({ eventId: envelope.eventId, ok: false, error: "user_mismatch" });
        continue;
      }

      // Consent enforcement (Window 26)
      const requiredScopes = policy.requiredScopes && policy.requiredScopes.length > 0
        ? policy.requiredScopes
        : policy.consentScope ? [policy.consentScope] : [];

      let consentMissing = false;
      for (const scope of requiredScopes) {
        const hasConsent = await d1GetConsent(env, clerkUserId, scope);
        if (!hasConsent) {
          results.push({
            eventId: envelope.eventId,
            ok: false,
            error: "consent_required",
            code: scope,
          });
          consentMissing = true;
          break;
        }
      }
      if (consentMissing) continue;

      // Blob requirement check (Window 26)
      if (policy.requiresBlob && (!envelope.blobRefs || envelope.blobRefs.length === 0)) {
        results.push({
          eventId: envelope.eventId,
          ok: false,
          error: "missing_blob_refs",
          code: "MISSING_BLOB_REFS",
        });
        continue;
      }

      // Check idempotency
      const kvHit = await checkIdempotencyKV(env, envelope.userId, envelope.idempotencyKey);
      if (kvHit.hit) {
        results.push({ eventId: kvHit.eventId!, ok: true, deduped: true });
        continue;
      }

      const existingEventId = await d1UpsertIdempotency(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);
      if (existingEventId && existingEventId !== envelope.eventId) {
        await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, existingEventId);
        results.push({ eventId: existingEventId, ok: true, deduped: true });
        continue;
      }

      // Redact and store (using registry)
      const redactKeys = getRedactKeys(envelope.eventType);
      const redacted = redactPayload(envelope.payload, redactKeys);
      const payloadJson = JSON.stringify(redacted);
      const blobRefsJson = envelope.blobRefs ? JSON.stringify(envelope.blobRefs) : null;

      // Store event with optional traceId
      if (traceId) {
        await d1InsertEventWithTrace(env, { event: envelope, payloadJson, blobRefsJson, traceId });
      } else {
        await d1InsertEvent(env, { event: envelope, payloadJson, blobRefsJson });
      }
      await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);

      // Enqueue for fanout (include traceId in envelope for downstream tracking)
      const fanoutEnvelope = traceId ? { ...envelope, traceId } : envelope;
      await env.FANOUT_QUEUE.send(fanoutEnvelope);

      results.push({ eventId: envelope.eventId, ok: true });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      results.push({ eventId: envelope.eventId, ok: false, error: errorMsg });
    }
  }

  const accepted = results.filter((r) => r.ok).length;
  const rejected = results.filter((r) => !r.ok).length;

  return json({ ok: true, accepted, rejected, results }, rejected === events.length ? 400 : 200);
}

async function handleBrainQuery(req: Request, env: Env): Promise<Response> {
  const clerkUserId = await verifyClerkJWT(req, env);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const result = BrainQueryRequest.safeParse(body);
  if (!result.success) {
    return json({ ok: false, error: "invalid_request", details: result.error.issues }, 400);
  }

  // Personalization degradation based on 7d history
  const c7d = await d1CountUserEvents7d(env, clerkUserId);
  const personalizationLevel = c7d < 20 ? "low" : c7d <= 200 ? "medium" : "high";

  const brainReq = {
    userId: clerkUserId,
    query: result.data.query,
    scopes: result.data.scopes ?? [],
    timeRange: { since: result.data.since ?? null, until: result.data.until ?? null },
    granularity: result.data.granularity ?? "summary",
    personalizationLevel,
    fallbackToWeb: personalizationLevel === "low",
  };

  try {
    const brainResult = await queryBrain(env, brainReq);
    return json({ ok: true, personalizationLevel, result: brainResult }, 200);
  } catch (e: unknown) {
    // Graceful degradation when Brain service is unavailable
    logger.error("Brain query failed", e instanceof Error ? e : null, { userId: clerkUserId });
    return json({
      ok: true,
      personalizationLevel,
      result: {
        answer: "Brain service is currently unavailable. Please try again later.",
        sources: [],
        fallback: true,
      },
      warning: "brain_service_unavailable",
    }, 200);
  }
}
