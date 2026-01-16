/**
 * Provability Endpoints for Golden Feature Proof Tests
 *
 * These endpoints enable E2E testing and debugging of the event pipeline
 * by providing trace-based querying of events and their delivery status.
 *
 * Endpoints:
 * - GET /v1/events/list?traceId=X       - List events by traceId
 * - GET /v1/admin/delivery/status?traceId=X  - Delivery status by traceId
 * - GET /v1/admin/delivery/replay?traceId=X  - Replay failed events by traceId
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { d1GetEventsByTraceId } from "../storage/d1";
import { EventRow, SqlBindValue } from "../types/database";

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

interface EventRecord {
  id: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestampMs: number;
  privacyScope: string;
  consentScope: string | null;
  consentVersion: string;
  idempotencyKey: string;
  payloadJson: string | null;
  blobRefsJson: string | null;
  receivedAtMs: number | null;
  traceId: string | null;
}

interface DeliveryInfo {
  convex: boolean;
  brain: boolean;
}

interface DeliveryTimestamps {
  receivedAt: number | null;
  deliveredToConvexAt: number | null;
  deliveredToBrainAt: number | null;
  deliveredToSocialAt: number | null;
}

// ============================================================================
// GET /v1/events/list?traceId=X
// List events with matching trace_id
// ============================================================================

export async function handleEventsListByTrace(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const traceId = url.searchParams.get("traceId");

  if (!traceId || traceId.length < 8) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "traceId query param required (min 8 chars)" },
    }, 400);
  }

  try {
    const events = await d1GetEventsByTraceId(env, traceId) as unknown as EventRow[];

    const mapped = events.map((row) => ({
      eventId: row.id,
      userId: row.user_id,
      sourceApp: row.source_app,
      eventType: row.event_type,
      timestampMs: row.timestamp_ms,
      privacyScope: row.privacy_scope,
      consentScope: row.consent_scope,
      consentVersion: row.consent_version,
      idempotencyKey: row.idempotency_key,
      payload: row.payload_json ? JSON.parse(row.payload_json) : null,
      blobRefs: row.blob_refs_json ? JSON.parse(row.blob_refs_json) : null,
      receivedAtMs: row.received_at_ms,
      traceId: row.trace_id,
    }));

    return json({
      ok: true,
      traceId,
      events: mapped,
      count: mapped.length,
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to query events";
    return json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message },
    }, 500);
  }
}

// ============================================================================
// GET /v1/admin/delivery/status?traceId=X
// Return delivery status for events with traceId
// ============================================================================

export async function handleDeliveryStatusByTrace(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const traceId = url.searchParams.get("traceId");

  if (!traceId || traceId.length < 8) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "traceId query param required (min 8 chars)" },
    }, 400);
  }

  try {
    // Query events with full delivery status columns
    const res = await env.DB.prepare(`
      SELECT
        id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
        consent_scope, consent_version, idempotency_key, payload_json, blob_refs_json,
        received_at_ms, trace_id,
        convex_delivery_status, delivered_to_convex_at_ms, convex_delivery_error,
        brain_delivery_status, brain_delivered_at_ms, brain_delivery_error,
        social_delivery_status, social_forwarded_at_ms, social_delivery_error
      FROM events
      WHERE trace_id = ?
      ORDER BY timestamp_ms DESC
    `).bind(traceId).all();

    const events = res.results ?? [];

    if (events.length === 0) {
      return json({
        ok: true,
        found: false,
        traceId,
        event: null,
        deliveredTo: null,
        timestamps: null,
      }, 200);
    }

    // Map delivery status from DB values
    const mapStatus = (s: string | null): DeliveryStatus => {
      if (!s || s === "pending") return "pending";
      if (s === "ok" || s === "delivered") return "delivered";
      if (s === "failed") return "failed";
      if (s === "skipped") return "skipped";
      return "pending";
    };

    const isDelivered = (s: string | null): boolean => {
      return s === "ok" || s === "delivered";
    };

    // For single event response, use first event (most recent by timestamp)
    // For multiple events, aggregate into array
    if (events.length === 1) {
      const row = events[0] as unknown as EventRow;

      const event = {
        eventId: row.id,
        userId: row.user_id,
        sourceApp: row.source_app,
        eventType: row.event_type,
        timestampMs: row.timestamp_ms,
        privacyScope: row.privacy_scope,
        consentVersion: row.consent_version,
        traceId: row.trace_id,
      };

      const deliveredTo: DeliveryInfo = {
        convex: isDelivered(row.convex_delivery_status),
        brain: isDelivered(row.brain_delivery_status),
      };

      const timestamps: DeliveryTimestamps = {
        receivedAt: row.received_at_ms,
        deliveredToConvexAt: row.delivered_to_convex_at_ms,
        deliveredToBrainAt: row.brain_delivered_at_ms,
        deliveredToSocialAt: row.social_forwarded_at_ms,
      };

      return json({
        ok: true,
        found: true,
        traceId,
        event,
        deliveredTo,
        timestamps,
        deliveryDetails: {
          convex: {
            status: mapStatus(row.convex_delivery_status),
            error: row.convex_delivery_error,
          },
          brain: {
            status: mapStatus(row.brain_delivery_status),
            error: row.brain_delivery_error,
          },
          social: {
            status: mapStatus(row.social_delivery_status),
            error: row.social_delivery_error,
          },
        },
      }, 200);
    }

    // Multiple events with same traceId
    const mappedEvents = (events as unknown as EventRow[]).map((row) => ({
      event: {
        eventId: row.id,
        userId: row.user_id,
        sourceApp: row.source_app,
        eventType: row.event_type,
        timestampMs: row.timestamp_ms,
        privacyScope: row.privacy_scope,
        consentVersion: row.consent_version,
        traceId: row.trace_id,
      },
      deliveredTo: {
        convex: isDelivered(row.convex_delivery_status),
        brain: isDelivered(row.brain_delivery_status),
      },
      timestamps: {
        receivedAt: row.received_at_ms,
        deliveredToConvexAt: row.delivered_to_convex_at_ms,
        deliveredToBrainAt: row.brain_delivered_at_ms,
        deliveredToSocialAt: row.social_forwarded_at_ms,
      },
      deliveryDetails: {
        convex: {
          status: mapStatus(row.convex_delivery_status),
          error: row.convex_delivery_error,
        },
        brain: {
          status: mapStatus(row.brain_delivery_status),
          error: row.brain_delivery_error,
        },
        social: {
          status: mapStatus(row.social_delivery_status),
          error: row.social_delivery_error,
        },
      },
    }));

    return json({
      ok: true,
      found: true,
      traceId,
      count: mappedEvents.length,
      events: mappedEvents,
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to query delivery status";
    return json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message },
    }, 500);
  }
}

// ============================================================================
// GET /v1/admin/delivery/replay?traceId=X
// Re-attempt delivery for failed events with traceId
// ============================================================================

export async function handleDeliveryReplayByTrace(req: Request, env: Env): Promise<Response> {
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const traceId = url.searchParams.get("traceId");

  if (!traceId || traceId.length < 8) {
    return json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "traceId query param required (min 8 chars)" },
    }, 400);
  }

  try {
    // Find events with this traceId that have failed deliveries
    const res = await env.DB.prepare(`
      SELECT
        id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
        consent_scope, consent_version, idempotency_key, payload_json, blob_refs_json,
        trace_id, requeue_count,
        convex_delivery_status, brain_delivery_status, social_delivery_status
      FROM events
      WHERE trace_id = ?
        AND (convex_delivery_status = 'failed'
          OR brain_delivery_status = 'failed'
          OR social_delivery_status = 'failed')
      ORDER BY timestamp_ms DESC
    `).bind(traceId).all();

    const failedEvents = res.results ?? [];

    if (failedEvents.length === 0) {
      // Check if any events exist with this traceId
      const anyEvents = await env.DB.prepare(`
        SELECT COUNT(1) as c FROM events WHERE trace_id = ?
      `).bind(traceId).first<{ c: number }>();

      if (!anyEvents || anyEvents.c === 0) {
        return json({
          ok: false,
          success: false,
          error: { code: "NOT_FOUND", message: "No events found with this traceId" },
        }, 404);
      }

      return json({
        ok: true,
        success: true,
        replayedAt: null,
        result: {
          traceId,
          message: "No failed deliveries to replay",
          eventsChecked: anyEvents.c,
          eventsReplayed: 0,
        },
      }, 200);
    }

    const now = Date.now();
    const replayResults: Array<{
      eventId: string;
      requeueCount: number;
      targets: string[];
    }> = [];

    for (const row of failedEvents as unknown as EventRow[]) {
      // Determine which targets need replay
      const targets: string[] = [];
      if (row.convex_delivery_status === "failed") targets.push("ingestion");
      if (row.brain_delivery_status === "failed") targets.push("brain");
      if (row.social_delivery_status === "failed") targets.push("social");

      const requeueCount = ((row.requeue_count as number) ?? 0) + 1;

      // Reset delivery status for failed targets
      const updates: string[] = [
        "requeue_count = ?",
        "last_requeue_at_ms = ?",
        "last_requeue_reason = ?",
        "queued_at_ms = ?",
      ];
      const updateBinds: SqlBindValue[] = [requeueCount, now, `replay via traceId: ${traceId}`, now];

      if (targets.includes("ingestion")) {
        updates.push("convex_delivery_status = 'pending'", "delivered_to_convex_at_ms = NULL", "convex_delivery_error = NULL");
      }
      if (targets.includes("brain")) {
        updates.push("brain_delivery_status = 'pending'", "brain_delivered_at_ms = NULL", "brain_delivery_error = NULL");
      }
      if (targets.includes("social")) {
        updates.push("social_delivery_status = 'pending'", "social_forwarded_at_ms = NULL", "social_delivery_error = NULL");
      }

      await env.DB.prepare(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...updateBinds, row.id)
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
        payload: row.payload_json ? JSON.parse(row.payload_json) : {},
        blobRefs: row.blob_refs_json ? JSON.parse(row.blob_refs_json) : undefined,
        traceId: row.trace_id,
        _requeue: {
          reason: `replay via traceId: ${traceId}`,
          requeueCount,
          targets,
        },
      };

      // Re-enqueue
      await env.FANOUT_QUEUE.send(envelope);

      replayResults.push({
        eventId: row.id,
        requeueCount,
        targets,
      });
    }

    return json({
      ok: true,
      success: true,
      replayedAt: now,
      result: {
        traceId,
        eventsReplayed: replayResults.length,
        events: replayResults,
      },
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to replay events";
    return json({
      ok: false,
      success: false,
      error: { code: "INTERNAL_ERROR", message },
    }, 500);
  }
}
