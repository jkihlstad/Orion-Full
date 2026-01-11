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
import { d1InsertEvent, d1UpsertIdempotency, d1CountUserEvents7d, d1GetConsent } from "./storage/d1";
import { getRedactKeys, getConsentScope } from "./registry/loader";
import { EventEnvelope, BatchIngestRequest, BrainQueryRequest } from "./types";

// Endpoints
import { handleEventsList } from "./admin/eventsList";
import { handleDeliveryStatus, handleDeliveryRecent, handleDeliveryRequeue } from "./admin/delivery";
import { handleConsentGet, handleConsentSet } from "./endpoints/consent";
import { handleEventsMine } from "./endpoints/eventsMine";
import { handleSignedUpload, handleBlobUpload } from "./blobs/signedUpload";
import { queryBrain } from "./fanout/brain";
import { handleFanoutBatch } from "./queues/consumer";

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
      return handleEventsList(req, env);
    }

    // --- Admin Delivery Status ---
    if (pathname === "/v1/admin/delivery/status" && method === "GET") {
      return handleDeliveryStatus(req, env);
    }

    if (pathname === "/v1/admin/delivery/recent" && method === "GET") {
      return handleDeliveryRecent(req, env);
    }

    if (pathname === "/v1/admin/delivery/requeue" && method === "POST") {
      return handleDeliveryRequeue(req, env);
    }

    // ========================================================================
    // Public endpoints (Clerk JWT auth)
    // ========================================================================
    try {
      // --- Events ---
      if (pathname === "/v1/events/ingest" && method === "POST") {
        return handleEventsIngest(req, env);
      }

      if (pathname === "/v1/events/ingestBatch" && method === "POST") {
        return handleEventsIngestBatch(req, env);
      }

      if (pathname === "/v1/events/mine" && method === "GET") {
        const userId = await verifyClerkJWT(req, env);
        return handleEventsMine(req, env, userId);
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

      // --- Brain Query ---
      if (pathname === "/v1/brain/query" && method === "POST") {
        return handleBrainQuery(req, env);
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

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    await handleFanoutBatch(batch, env);
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

  // Enforce identity (don't allow spoofing userId)
  if (envelope.userId !== clerkUserId) {
    return json({ ok: false, error: "user_mismatch" }, 403);
  }

  // Check consent for eventType
  const consentScope = getConsentScope(envelope.eventType);
  if (consentScope) {
    const hasConsent = await d1GetConsent(env, clerkUserId, consentScope);
    if (!hasConsent) {
      return json({ ok: false, error: "consent_required", scope: consentScope }, 403);
    }
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

  // Redact payload before storage
  const redactKeys = getRedactKeys(envelope.eventType);
  const redacted = redactPayload(envelope.payload, redactKeys);
  const payloadJson = JSON.stringify(redacted);
  const blobRefsJson = envelope.blobRefs ? JSON.stringify(envelope.blobRefs) : null;

  await d1InsertEvent(env, { event: envelope, payloadJson, blobRefsJson });
  await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);

  // Enqueue for fanout
  await env.FANOUT_QUEUE.send(envelope);

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
  const results: Array<{ eventId: string; ok: boolean; error?: string; deduped?: boolean }> = [];

  for (const envelope of events) {
    try {
      // Enforce identity
      if (envelope.userId !== clerkUserId) {
        results.push({ eventId: envelope.eventId, ok: false, error: "user_mismatch" });
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

      // Redact and store
      const redactKeys = getRedactKeys(envelope.eventType);
      const redacted = redactPayload(envelope.payload, redactKeys);
      const payloadJson = JSON.stringify(redacted);
      const blobRefsJson = envelope.blobRefs ? JSON.stringify(envelope.blobRefs) : null;

      await d1InsertEvent(env, { event: envelope, payloadJson, blobRefsJson });
      await storeIdempotencyKV(env, envelope.userId, envelope.idempotencyKey, envelope.eventId);
      await env.FANOUT_QUEUE.send(envelope);

      results.push({ eventId: envelope.eventId, ok: true });
    } catch (e: any) {
      results.push({ eventId: envelope.eventId, ok: false, error: String(e?.message ?? e) });
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

  const brainResult = await queryBrain(env, brainReq);
  return json({ ok: true, personalizationLevel, result: brainResult }, 200);
}
