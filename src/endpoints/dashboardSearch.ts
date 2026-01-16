/**
 * Dashboard Search Endpoint
 *
 * GET /v1/dashboard/search
 *
 * User-scoped event search for Dashboard app.
 * Returns only events owned by the authenticated user.
 *
 * Query params:
 *   - traceId (optional): Filter by traceId
 *   - eventType (optional): Filter by eventType
 *   - eventId (optional): Filter by specific eventId
 *   - sinceMs (optional): Events after this timestamp
 *   - untilMs (optional): Events before this timestamp
 *   - limit (optional): Max events to return (default 50, max 200)
 *
 * Response:
 * {
 *   "count": number,
 *   "traceId": string | null,
 *   "events": [{
 *     "eventId": string,
 *     "eventType": string,
 *     "timestampMs": number,
 *     "summary": object
 *   }],
 *   "facets": {
 *     "topEventTypes": [{ "eventType": string, "count": number }]
 *   }
 * }
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { d1ListEventsForUser, d1GetEventsByTraceId, d1GetEventById } from "../storage/d1";
import { getRedactKeys } from "../validation/registry";
import { redactPayload } from "../utils/redact";
import { createLogger } from "../utils/logger";
import { EventRow } from "../types/database";

const logger = createLogger({ module: "endpoints/dashboardSearch" });

interface DashboardEvent {
  eventId: string;
  eventType: string;
  timestampMs: number;
  summary: Record<string, unknown>;
}

interface EventTypeFacet {
  eventType: string;
  count: number;
}

interface DashboardSearchResponse {
  count: number;
  traceId: string | null;
  events: DashboardEvent[];
  facets: {
    topEventTypes: EventTypeFacet[];
  };
}

export async function handleDashboardSearch(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const url = new URL(req.url);

  // Parse query parameters
  const traceId = url.searchParams.get("traceId");
  const eventType = url.searchParams.get("eventType");
  const eventId = url.searchParams.get("eventId");
  const sinceMs = url.searchParams.get("sinceMs");
  const untilMs = url.searchParams.get("untilMs");
  const limitParam = url.searchParams.get("limit");

  const limit = Math.min(200, Math.max(1, parseInt(limitParam ?? "50", 10)));

  let rows: EventRow[] = [];

  try {
    // If eventId is specified, fetch that specific event
    if (eventId) {
      const event = await d1GetEventById(env, eventId, userId);
      if (event) {
        rows = [event as unknown as EventRow];
      }
    }
    // If traceId is specified, fetch by traceId
    else if (traceId) {
      rows = await d1GetEventsByTraceId(env, traceId, userId, limit) as unknown as EventRow[];
    }
    // Otherwise, list user's events
    else {
      const since = sinceMs ? Number(sinceMs) : null;
      rows = await d1ListEventsForUser(
        env,
        userId,
        Number.isFinite(since ?? NaN) ? since : null,
        limit
      ) as unknown as EventRow[];
    }
  } catch (error) {
    logger.error("Dashboard search failed", error instanceof Error ? error : null, { userId, traceId, eventType, eventId });
    return json({ ok: false, error: "search_failed" }, 500);
  }

  // Apply filters
  let filtered = rows;

  // Filter by eventType if specified
  if (eventType) {
    filtered = filtered.filter((r) => r.event_type === eventType);
  }

  // Filter by untilMs if specified
  if (untilMs) {
    const until = Number(untilMs);
    if (Number.isFinite(until)) {
      filtered = filtered.filter((r) => r.timestamp_ms <= until);
    }
  }

  // Filter by sinceMs if specified (for traceId queries that don't use it)
  if (sinceMs && traceId) {
    const since = Number(sinceMs);
    if (Number.isFinite(since)) {
      filtered = filtered.filter((r) => r.timestamp_ms >= since);
    }
  }

  // Build response events with redaction and summary
  const events: DashboardEvent[] = filtered.map((r) => {
    const redactKeys = getRedactKeys(r.event_type);
    let payload: Record<string, unknown> = {};
    try {
      payload = r.payload_json ? JSON.parse(r.payload_json) : {};
    } catch {
      payload = { _parseError: true };
    }
    const redacted = redactPayload(payload, redactKeys);

    // Build summary based on event type
    const summary = buildEventSummary(r.event_type, redacted);

    return {
      eventId: r.id,
      eventType: r.event_type,
      timestampMs: r.timestamp_ms,
      summary,
    };
  });

  // Build facets (top event types)
  const eventTypeCounts = new Map<string, number>();
  for (const event of events) {
    const count = eventTypeCounts.get(event.eventType) || 0;
    eventTypeCounts.set(event.eventType, count + 1);
  }

  const topEventTypes: EventTypeFacet[] = Array.from(eventTypeCounts.entries())
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const response: DashboardSearchResponse = {
    count: events.length,
    traceId: traceId || null,
    events,
    facets: {
      topEventTypes,
    },
  };

  return json(response, 200);
}

/**
 * Build a summary object for display in Dashboard
 */
function buildEventSummary(
  eventType: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  switch (eventType) {
    case "browser.page_visited":
      if (payload.url) summary.url = payload.url;
      if (payload.title) summary.title = payload.title;
      if (payload.host) summary.host = payload.host;
      break;

    case "tasks.task_created":
    case "tasks.task_completed":
    case "tasks.task_updated":
      if (payload.taskId) summary.taskId = payload.taskId;
      if (payload.title) summary.title = payload.title;
      break;

    case "calendar.event_created":
    case "calendar.event_updated":
      if (payload.title) summary.title = payload.title;
      if (payload.startMs) summary.startMs = payload.startMs;
      break;

    case "finance.transaction_created":
      if (payload.merchantName) summary.merchant = payload.merchantName;
      if (payload.amount) summary.amount = payload.amount;
      if (payload.currency) summary.currency = payload.currency;
      break;

    case "finance.receipt_captured":
      if (payload.receiptId) summary.receiptId = payload.receiptId;
      if (payload.merchantName) summary.merchant = payload.merchantName;
      break;

    case "email.message_sent":
    case "email.message_received":
      if (payload.provider) summary.provider = payload.provider;
      if (payload.toCount) summary.toCount = payload.toCount;
      break;

    case "system.smoke_test":
      if (payload.note) summary.note = payload.note;
      break;

    default:
      // Include first few non-sensitive keys for unknown types
      const keys = Object.keys(payload).slice(0, 3);
      for (const key of keys) {
        if (!key.startsWith("_")) {
          summary[key] = payload[key];
        }
      }
  }

  return summary;
}
