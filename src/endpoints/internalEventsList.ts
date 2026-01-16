/**
 * Internal Events List Endpoint (Windows E, G)
 *
 * Service-only endpoint for brain-platform to fetch user events.
 * Authenticated via X-Gateway-Key header (not Clerk JWT).
 *
 * Two modes:
 * 1. Proxy mode (INGESTION_URL configured): Forwards to ingestion store
 * 2. Local mode (no INGESTION_URL): Queries gateway's D1 directly
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/internalEventsList" });

/**
 * Event structure returned to brain-platform
 */
interface GatewayEvent {
  id: string;
  userId: string;
  eventType: string;
  privacyScope: string;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  payloadPreview: Record<string, unknown>;
}

/**
 * Handle GET /v1/internal/events/list
 *
 * Service-only endpoint for brain-platform to fetch user events.
 * Query params:
 * - userId (required): User ID to fetch events for
 * - limit (optional): Max events to return (default 400, max 500)
 */
export async function handleInternalEventsList(
  req: Request,
  env: Env
): Promise<Response> {
  try {
    // Validate service token (X-Gateway-Key)
    const key = req.headers.get("X-Gateway-Key") || "";
    if (!key || key !== env.GATEWAY_INTERNAL_KEY) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const limitStr = url.searchParams.get("limit");
    const limit = Math.min(500, Math.max(1, parseInt(limitStr || "400", 10)));

    if (!userId) {
      return json({ ok: false, error: "missing userId" }, 400);
    }

    // Proxy mode: forward to ingestion store if configured (Window E)
    if (env.INGESTION_URL) {
      return proxyToIngestionStore(env, userId, limit);
    }

    // Local mode: query gateway's D1 directly
    return queryLocalD1(env, userId, limit);
  } catch (error) {
    logger.error("Internal events list endpoint error", error instanceof Error ? error : null);
    return new Response(JSON.stringify({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Proxy request to ingestion store (Window E)
 */
async function proxyToIngestionStore(
  env: Env,
  userId: string,
  limit: number
): Promise<Response> {
  const upstreamUrl = new URL(env.INGESTION_URL!);
  upstreamUrl.pathname = "/v1/internal/events/list";
  upstreamUrl.searchParams.set("userId", userId);
  upstreamUrl.searchParams.set("limit", String(limit));

  const resp = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      "X-Orion-Service-Token": env.INGESTION_SERVICE_TOKEN ?? "",
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return json(
      {
        ok: false,
        error: `ingestion store error: ${resp.status}`,
        details: errText,
      },
      502
    );
  }

  // Pass through the response
  const events = (await resp.json()) as GatewayEvent[];
  return json(events);
}

/**
 * Query gateway's local D1 database
 */
async function queryLocalD1(
  env: Env,
  userId: string,
  limit: number
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, event_type, privacy_scope, timestamp,
            payload_json, payload_preview
     FROM events
     WHERE user_id = ?1
     ORDER BY timestamp DESC
     LIMIT ?2`
  )
    .bind(userId, limit)
    .all<{
      id: string;
      user_id: string;
      event_type: string;
      privacy_scope: string;
      timestamp: number;
      payload_json: string;
      payload_preview: string;
    }>();

  // Map to GatewayEvent structure
  const events: GatewayEvent[] = (rows.results || []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    eventType: r.event_type,
    privacyScope: r.privacy_scope,
    occurredAtMs: r.timestamp,
    payload: safeParseJson(r.payload_json) || {},
    payloadPreview: safeParseJson(r.payload_preview) || {},
  }));

  return json(events);
}

/**
 * Safe JSON parsing with fallback
 */
function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return null;
  }
}
