import { Env } from "../env";
import { json } from "../utils/respond";
import { redactForDashboard, summarizePayload } from "../utils/redact";
import { EventRow, SqlBindValue } from "../types/database";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "admin/eventsList" });

/**
 * Events List Response Format (Window 15.3)
 */
interface DeliveryStatus {
  status: "pending" | "delivered" | "done" | "failed" | "skipped";
  atMs: number | null;
  attempts: number;
  error: string | null;
}

interface EventListItem {
  eventId: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestampMs: number;
  receivedAtMs: number | null;
  traceId: string | null;
  privacyScope: string;
  delivery: {
    toConvex: DeliveryStatus;
    toBrain: DeliveryStatus;
    toSocial: DeliveryStatus;
  };
  payload: Record<string, unknown>;
  blobCount: number;
}

interface EventsListResponse {
  events: EventListItem[];
  count: number;
  nextCursor: string | null;
}

/**
 * Map raw DB row to Window 15 response format
 */
function mapEventRow(row: EventRow): EventListItem {
  // Parse payload JSON
  let payload: Record<string, unknown> = {};
  try {
    payload = row.payload_json ? JSON.parse(row.payload_json) : {};
  } catch {
    payload = {};
  }

  // Apply Dashboard redaction
  const safePayload = redactForDashboard(
    payload,
    row.event_type,
    row.source_app,
    row.privacy_scope
  );

  return {
    eventId: row.id,
    userId: row.user_id,
    sourceApp: row.source_app,
    eventType: row.event_type,
    timestampMs: row.timestamp_ms,
    receivedAtMs: row.received_at_ms ?? null,
    traceId: row.trace_id ?? null,
    privacyScope: row.privacy_scope,
    delivery: {
      toConvex: {
        status: mapConvexStatus(row.convex_delivery_status),
        atMs: row.delivered_to_convex_at_ms ?? null,
        attempts: row.convex_attempts ?? 0,
        error: row.convex_delivery_error ?? null,
      },
      toBrain: {
        status: (row.brain_delivery_status ?? "pending") as DeliveryStatus["status"],
        atMs: row.brain_delivered_at_ms ?? null,
        attempts: row.brain_attempts ?? 0,
        error: row.brain_delivery_error ?? null,
      },
      toSocial: {
        status: mapSocialStatus(row.social_delivery_status),
        atMs: row.social_forwarded_at_ms ?? null,
        attempts: row.social_attempts ?? 0,
        error: row.social_delivery_error ?? null,
      },
    },
    payload: safePayload,
    blobCount: row.blob_count ?? 0,
  };
}

/**
 * Map legacy Convex status values to Window 14 format
 */
function mapConvexStatus(status: string | null): DeliveryStatus["status"] {
  if (!status) return "pending";
  switch (status) {
    case "ok":
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

/**
 * Map legacy Social status values to Window 14 format
 */
function mapSocialStatus(status: string | null): DeliveryStatus["status"] {
  if (!status) return "skipped";
  switch (status) {
    case "ok":
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    default:
      return "skipped";
  }
}

/**
 * Admin endpoint to list events (requires X-Admin-Key)
 *
 * Query params (Window 15.1):
 * - traceId: exact match (highest priority - if set, other filters ignored)
 * - sourceApp: exact match
 * - eventTypePrefix: prefix match (e.g., "finance.")
 * - eventType: exact match
 * - sinceMs: timestamp lower bound
 * - limit: max results (default 100, max 500)
 */
export async function handleEventsList(req: Request, env: Env): Promise<Response> {
  // Auth check
  const adminKey = req.headers.get("X-Admin-Key") || "";
  const expected = env.ADMIN_API_KEY;
  if (!expected || adminKey !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);

  // Parse query params
  const userId = url.searchParams.get("userId");
  const eventType = url.searchParams.get("eventType");
  const eventTypePrefix = url.searchParams.get("eventTypePrefix");
  const sourceApp = url.searchParams.get("sourceApp");
  const sinceMs = Number(url.searchParams.get("sinceMs") || url.searchParams.get("since") || "0");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || "100")));

  // Build SQL query (Window 15.2)
  const where: string[] = [];
  const binds: SqlBindValue[] = [];

  if (userId) {
    where.push("user_id = ?");
    binds.push(userId);
  }

  if (eventType) {
    where.push("event_type = ?");
    binds.push(eventType);
  } else if (eventTypePrefix) {
    // LIKE 'finance.%' pattern
    where.push("event_type LIKE ?");
    binds.push(eventTypePrefix + "%");
  }

  if (sourceApp) {
    where.push("source_app = ?");
    binds.push(sourceApp);
  }

  if (sinceMs > 0) {
    where.push("timestamp_ms >= ?");
    binds.push(sinceMs);
  }

  // Select all delivery tracking fields (snake_case from 0001_d1.sql schema)
  const sql = `
    SELECT
      id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
      consent_scope, consent_version, idempotency_key, payload_json,
      received_at_ms, trace_id,
      -- Convex delivery (from 0001_d1.sql)
      convex_delivery_status, delivered_to_convex_at_ms, convex_delivery_error,
      -- Brain delivery (from 0002_enhanced_delivery_tracking.sql)
      brain_delivery_status, brain_delivered_at_ms, brain_attempts, brain_delivery_error,
      -- Social delivery (from 0001_d1.sql)
      social_delivery_status, social_forwarded_at_ms, social_delivery_error
    FROM events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY timestamp_ms DESC
    LIMIT ?
  `;
  binds.push(limit);

  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    const rows = (res.results ?? []) as unknown as EventRow[];

    // Map to response format
    const events = rows.map(mapEventRow);

    const response: EventsListResponse = {
      events,
      count: events.length,
      nextCursor: null, // TODO: implement cursor pagination
    };

    return json(response);
  } catch (err: unknown) {
    logger.error("Events list query failed", err instanceof Error ? err : null);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ ok: false, error: message }, 500);
  }
}

/**
 * Lightweight events list for Dashboard (summary payloads only)
 */
export async function handleEventsListSummary(req: Request, env: Env): Promise<Response> {
  // Auth check
  const adminKey = req.headers.get("X-Admin-Key") || "";
  const expected = env.ADMIN_API_KEY;
  if (!expected || adminKey !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);

  // Parse query params
  const userId = url.searchParams.get("userId");
  const sourceApp = url.searchParams.get("sourceApp");
  const sinceMs = Number(url.searchParams.get("sinceMs") || "0");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  // Build SQL
  const where: string[] = [];
  const binds: SqlBindValue[] = [];

  if (userId) {
    where.push("user_id = ?");
    binds.push(userId);
  }
  if (sourceApp) {
    where.push("source_app = ?");
    binds.push(sourceApp);
  }
  if (sinceMs > 0) {
    where.push("timestamp_ms >= ?");
    binds.push(sinceMs);
  }

  const sql = `
    SELECT id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
           received_at_ms, trace_id, payload_json,
           convex_delivery_status, brain_delivery_status, social_delivery_status
    FROM events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY timestamp_ms DESC
    LIMIT ?
  `;
  binds.push(limit);

  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    const rows = (res.results ?? []) as unknown as EventRow[];

    // Map to summary format
    const events = rows.map((row) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = row.payload_json ? JSON.parse(row.payload_json) : {};
      } catch {
        payload = {};
      }

      return {
        eventId: row.id,
        userId: row.user_id,
        sourceApp: row.source_app,
        eventType: row.event_type,
        timestampMs: row.timestamp_ms,
        traceId: row.trace_id ?? null,
        privacyScope: row.privacy_scope,
        overallStatus: computeOverallStatus(row),
        summary: summarizePayload(payload, row.event_type, row.source_app),
      };
    });

    return json({
      events,
      count: events.length,
      nextCursor: null,
    });
  } catch (err: unknown) {
    logger.error("Events summary query failed", err instanceof Error ? err : null);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ ok: false, error: message }, 500);
  }
}

/**
 * Compute overall delivery status for an event
 */
function computeOverallStatus(row: EventRow): "pending" | "delivered" | "partial" | "failed" {
  const convex = row.convex_delivery_status ?? "pending";
  const brain = row.brain_delivery_status ?? "pending";
  const social = row.social_delivery_status ?? "skipped";

  // If any failed, overall is failed
  if (convex === "failed" || brain === "failed" || social === "failed") {
    return "failed";
  }

  // If all relevant are delivered/done/skipped, overall is delivered
  const convexOk = convex === "delivered" || convex === "ok";
  const brainOk = brain === "done" || brain === "skipped";
  const socialOk = social === "delivered" || social === "ok" || social === "skipped";

  if (convexOk && brainOk && socialOk) {
    return "delivered";
  }

  // If some are done but not all, partial
  if (convexOk || brainOk) {
    return "partial";
  }

  return "pending";
}
