/**
 * Admin Delivery Status Endpoints
 * Provides visibility into event delivery pipeline for debugging and E2E testing
 *
 * Endpoints:
 * - GET /v1/admin/delivery/status?eventId=<uuid>  - Single event delivery status
 * - GET /v1/admin/delivery/recent                 - List recent deliveries
 * - POST /v1/admin/delivery/requeue               - Requeue failed event
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { z } from "zod";

// ============================================================================
// Auth Helper
// ============================================================================

function verifyAdminAuth(req: Request, env: Env): { ok: true } | { ok: false; response: Response } {
  const adminKey = req.headers.get("X-Admin-Key") || "";
  const expected = env.ADMIN_API_KEY;
  if (!expected || adminKey !== expected) {
    return {
      ok: false,
      response: json({ ok: false, error: { code: "FORBIDDEN", message: "admin access required" } }, 403),
    };
  }
  return { ok: true };
}

// ============================================================================
// Types
// ============================================================================

type DeliveryStatus = "pending" | "delivered" | "failed" | "skipped";

interface DeliveryTarget {
  target: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAtMs: number | null;
  deliveredAtMs: number | null;
  httpStatus: number | null;
  error: string | null;
  skipReason?: string | null;
}

interface EventDeliveryStatus {
  eventId: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestampMs: number;
  privacyScope: string;
  consentVersion: string;
}

interface PipelineStatus {
  stored: {
    d1InsertedAtMs: number | null;
    idempotencyKey: string;
    deduped: boolean;
  };
  queue: {
    name: string;
    enqueuedAtMs: number | null;
    messageId: string | null;
    attempts: number;
    lastAttemptAtMs: number | null;
    lease: {
      consumerId: string | null;
      leaseExpiresAtMs: number | null;
    } | null;
  };
  deliveries: {
    ingestion: DeliveryTarget;
    brain: DeliveryTarget;
    social: DeliveryTarget;
  };
}

// ============================================================================
// GET /v1/admin/delivery/status?eventId=<uuid>
// ============================================================================

export async function handleDeliveryStatus(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");

  if (!eventId || eventId.length < 8) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "eventId query param required (min 8 chars)" },
    }, 400);
  }

  // Fetch event from D1
  const row = await env.DB.prepare(`
    SELECT
      id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
      consent_scope, consent_version, idempotency_key, received_at_ms,
      queued_at_ms, queue_message_id, queue_attempts, queue_last_attempt_at_ms,
      queue_consumer_id, queue_lease_expires_at_ms,
      convex_delivery_status, convex_attempts, convex_last_attempt_at_ms,
      delivered_to_convex_at_ms, convex_http_status, convex_delivery_error,
      brain_delivery_status, brain_attempts, brain_last_attempt_at_ms,
      brain_delivered_at_ms, brain_http_status, brain_delivery_error, brain_skip_reason,
      social_delivery_status, social_attempts, social_last_attempt_at_ms,
      social_forwarded_at_ms, social_http_status, social_delivery_error, social_skip_reason,
      requeue_count, last_requeue_at_ms, last_requeue_reason
    FROM events
    WHERE id = ?
  `).bind(eventId).first();

  if (!row) {
    return json({
      ok: false,
      error: { code: "NOT_FOUND", message: "eventId not found" },
    }, 404);
  }

  // Map delivery status from DB values
  const mapStatus = (s: string | null): DeliveryStatus => {
    if (!s || s === "pending") return "pending";
    if (s === "ok" || s === "delivered") return "delivered";
    if (s === "failed") return "failed";
    if (s === "skipped") return "skipped";
    return "pending";
  };

  const event: EventDeliveryStatus = {
    eventId: row.id as string,
    userId: row.user_id as string,
    sourceApp: row.source_app as string,
    eventType: row.event_type as string,
    timestampMs: row.timestamp_ms as number,
    privacyScope: row.privacy_scope as string,
    consentVersion: row.consent_version as string,
  };

  const pipeline: PipelineStatus = {
    stored: {
      d1InsertedAtMs: row.received_at_ms as number | null,
      idempotencyKey: row.idempotency_key as string,
      deduped: false, // We don't have this info after the fact
    },
    queue: {
      name: "FANOUT_QUEUE",
      enqueuedAtMs: (row.queued_at_ms as number | null) ?? (row.received_at_ms as number | null),
      messageId: row.queue_message_id as string | null,
      attempts: (row.queue_attempts as number) ?? 0,
      lastAttemptAtMs: row.queue_last_attempt_at_ms as number | null,
      lease: row.queue_consumer_id ? {
        consumerId: row.queue_consumer_id as string,
        leaseExpiresAtMs: row.queue_lease_expires_at_ms as number | null,
      } : null,
    },
    deliveries: {
      ingestion: {
        target: "convex",
        status: mapStatus(row.convex_delivery_status as string | null),
        attempts: (row.convex_attempts as number) ?? 0,
        lastAttemptAtMs: row.convex_last_attempt_at_ms as number | null,
        deliveredAtMs: row.delivered_to_convex_at_ms as number | null,
        httpStatus: row.convex_http_status as number | null,
        error: row.convex_delivery_error as string | null,
      },
      brain: {
        target: "brain-ingest",
        status: mapStatus(row.brain_delivery_status as string | null),
        attempts: (row.brain_attempts as number) ?? 0,
        lastAttemptAtMs: row.brain_last_attempt_at_ms as number | null,
        deliveredAtMs: row.brain_delivered_at_ms as number | null,
        httpStatus: row.brain_http_status as number | null,
        error: row.brain_delivery_error as string | null,
        skipReason: row.brain_skip_reason as string | null,
      },
      social: {
        target: "social-backend",
        status: mapStatus(row.social_delivery_status as string | null),
        attempts: (row.social_attempts as number) ?? 0,
        lastAttemptAtMs: row.social_last_attempt_at_ms as number | null,
        deliveredAtMs: row.social_forwarded_at_ms as number | null,
        httpStatus: row.social_http_status as number | null,
        error: row.social_delivery_error as string | null,
        skipReason: row.social_skip_reason as string | null,
      },
    },
  };

  return json({
    ok: true,
    event,
    pipeline,
    debug: {
      requeueCount: (row.requeue_count as number) ?? 0,
      lastRequeueAtMs: row.last_requeue_at_ms as number | null,
      lastRequeueReason: row.last_requeue_reason as string | null,
    },
  }, 200);
}

// ============================================================================
// GET /v1/admin/delivery/recent
// ============================================================================

export async function handleDeliveryRecent(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const sinceMs = Number(url.searchParams.get("sinceMs") || (Date.now() - 24 * 60 * 60 * 1000));
  const eventType = url.searchParams.get("eventType");
  const status = url.searchParams.get("status");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || "100")));

  // Build query
  const where: string[] = ["received_at_ms >= ?"];
  const binds: any[] = [sinceMs];

  if (eventType) {
    where.push("event_type = ?");
    binds.push(eventType);
  }

  // Status filter is applied post-fetch since it's computed
  const sql = `
    SELECT
      id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
      convex_delivery_status, brain_delivery_status, social_delivery_status,
      convex_delivery_error, brain_delivery_error, social_delivery_error
    FROM events
    WHERE ${where.join(" AND ")}
    ORDER BY received_at_ms DESC
    LIMIT ?
  `;
  binds.push(limit * 2); // Fetch more to account for status filtering

  const res = await env.DB.prepare(sql).bind(...binds).all();
  const rows = res.results ?? [];

  // Compute overall status
  const computeOverallStatus = (row: any): DeliveryStatus => {
    const convex = row.convex_delivery_status;
    const brain = row.brain_delivery_status;
    const social = row.social_delivery_status;

    // If any required delivery failed, overall is failed
    if (convex === "failed") return "failed";

    // If ingestion pending, overall is pending
    if (!convex || convex === "pending") return "pending";

    // If ingestion delivered, check others
    if (convex === "ok" || convex === "delivered") {
      // Brain and social can be skipped
      const brainOk = !brain || brain === "ok" || brain === "delivered" || brain === "skipped";
      const socialOk = !social || social === "ok" || social === "delivered" || social === "skipped";

      if (brain === "failed" || social === "failed") return "failed";
      if (brainOk && socialOk) return "delivered";
    }

    return "pending";
  };

  const mapStatus = (s: string | null): DeliveryStatus => {
    if (!s || s === "pending") return "pending";
    if (s === "ok" || s === "delivered") return "delivered";
    if (s === "failed") return "failed";
    if (s === "skipped") return "skipped";
    return "pending";
  };

  let events = rows.map((row: any) => {
    const overallStatus = computeOverallStatus(row);
    const lastError = row.convex_delivery_error || row.brain_delivery_error || row.social_delivery_error || null;

    return {
      eventId: row.id,
      eventType: row.event_type,
      timestampMs: row.timestamp_ms,
      userId: row.user_id,
      overallStatus,
      deliveries: {
        ingestion: mapStatus(row.convex_delivery_status),
        brain: mapStatus(row.brain_delivery_status),
        social: mapStatus(row.social_delivery_status),
      },
      lastError,
    };
  });

  // Apply status filter if provided
  if (status) {
    events = events.filter((e: any) => e.overallStatus === status);
  }

  // Apply final limit
  events = events.slice(0, limit);

  return json({
    ok: true,
    sinceMs,
    events,
  }, 200);
}

// ============================================================================
// POST /v1/admin/delivery/requeue
// ============================================================================

const RequeueRequest = z.object({
  eventId: z.string().min(8),
  targets: z.array(z.enum(["ingestion", "brain", "social"])).optional(),
  reason: z.string().min(1).max(200),
});

export async function handleDeliveryRequeue(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({
      ok: false,
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
    }, 400);
  }

  const parsed = RequeueRequest.safeParse(body);
  if (!parsed.success) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: parsed.error.flatten() },
    }, 400);
  }

  const { eventId, targets, reason } = parsed.data;

  // Verify event exists
  const row = await env.DB.prepare(`
    SELECT id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
           consent_scope, consent_version, idempotency_key, payload_json, blob_refs_json,
           requeue_count
    FROM events WHERE id = ?
  `).bind(eventId).first();

  if (!row) {
    return json({
      ok: false,
      error: { code: "NOT_FOUND", message: "eventId not found" },
    }, 404);
  }

  const now = Date.now();
  const requeueCount = ((row.requeue_count as number) ?? 0) + 1;

  // Reset delivery status for requested targets
  const resetTargets = targets ?? ["ingestion", "brain", "social"];
  const updates: string[] = [
    "requeue_count = ?",
    "last_requeue_at_ms = ?",
    "last_requeue_reason = ?",
    "queued_at_ms = ?",
  ];
  const updateBinds: any[] = [requeueCount, now, reason, now];

  if (resetTargets.includes("ingestion")) {
    updates.push("convex_delivery_status = 'pending'", "convex_attempts = 0", "convex_delivery_error = NULL");
  }
  if (resetTargets.includes("brain")) {
    updates.push("brain_delivery_status = 'pending'", "brain_attempts = 0", "brain_delivery_error = NULL", "brain_skip_reason = NULL");
  }
  if (resetTargets.includes("social")) {
    updates.push("social_delivery_status = 'pending'", "social_attempts = 0", "social_delivery_error = NULL", "social_skip_reason = NULL");
  }

  await env.DB.prepare(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...updateBinds, eventId)
    .run();

  // Reconstruct event envelope for queue
  const envelope = {
    eventId: row.id,
    userId: row.user_id,
    sourceApp: row.source_app,
    eventType: row.event_type,
    timestamp: row.timestamp_ms,
    privacyScope: row.privacy_scope,
    consentScope: row.consent_scope,
    consentVersion: row.consent_version,
    idempotencyKey: row.idempotency_key,
    payload: row.payload_json ? JSON.parse(row.payload_json as string) : {},
    blobRefs: row.blob_refs_json ? JSON.parse(row.blob_refs_json as string) : undefined,
    _requeue: {
      reason,
      requeueCount,
      targets: resetTargets,
    },
  };

  // Re-enqueue
  await env.FANOUT_QUEUE.send(envelope);

  return json({
    ok: true,
    enqueuedAtMs: now,
    requeueCount,
  }, 200);
}
