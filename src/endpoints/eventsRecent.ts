/**
 * Recent Events endpoint for Orion Edge Gateway
 *
 * GET /v1/events/recent - Retrieve user's recent events
 *
 * This endpoint provides a simple way to get recent events for a user,
 * with optional filtering by event type.
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { d1GetRecentEvents } from "../storage/d1";
import { getRedactKeys } from "../validation/registry";
import { redactPayload } from "../utils/redact";
import { createLogger } from "../utils/logger";
import { EventRow } from "../types/database";

const logger = createLogger({ module: "endpoints/eventsRecent" });

// ============================================================================
// Response Types
// ============================================================================

interface RecentEventItem {
  eventId: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestamp: number;
  privacyScope: string;
  payload: Record<string, unknown>;
}

interface RecentEventsResponse {
  ok: true;
  count: number;
  items: RecentEventItem[];
}

interface RecentEventsErrorResponse {
  ok: false;
  error: string;
  message: string;
}

// ============================================================================
// Route Handler
// ============================================================================

/**
 * GET /v1/events/recent
 *
 * Retrieves the authenticated user's recent events.
 * Query params:
 *   - limit: Maximum number of events (default 50, max 200)
 *   - eventTypes: Comma-separated list of event types to filter by
 *
 * Response:
 * {
 *   "ok": true,
 *   "count": 10,
 *   "items": [
 *     {
 *       "eventId": "...",
 *       "userId": "...",
 *       "sourceApp": "finance",
 *       "eventType": "finance.transaction_ingested",
 *       "timestamp": 1234567890,
 *       "privacyScope": "private",
 *       "payload": { ... }
 *     },
 *     ...
 *   ]
 * }
 */
export async function handleEventsRecent(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const url = new URL(req.url);

  // Parse query parameters
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const eventTypesParam = url.searchParams.get("eventTypes");
  const eventTypes = eventTypesParam
    ? eventTypesParam.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  try {
    const rows = await d1GetRecentEvents(env, userId, limit, eventTypes) as unknown as EventRow[];

    // Re-redact payloads at read-time (belt & suspenders)
    const items: RecentEventItem[] = rows.map((row) => {
      const redactKeys = getRedactKeys(row.event_type);
      let payload: Record<string, unknown> = {};

      try {
        payload = row.payload_json ? JSON.parse(row.payload_json) : {};
      } catch {
        payload = { _parseError: true };
      }

      const redacted = redactPayload(payload, redactKeys);

      return {
        eventId: row.id,
        userId: row.user_id,
        sourceApp: row.source_app,
        eventType: row.event_type,
        timestamp: row.timestamp_ms,
        privacyScope: row.privacy_scope,
        payload: redacted,
      };
    });

    const response: RecentEventsResponse = {
      ok: true,
      count: items.length,
      items,
    };

    return json(response, 200);
  } catch (e) {
    logger.error("Recent events retrieval failed", e instanceof Error ? e : null, { userId });
    const response: RecentEventsErrorResponse = {
      ok: false,
      error: "internal_error",
      message: "Failed to retrieve recent events",
    };
    return json(response, 500);
  }
}
