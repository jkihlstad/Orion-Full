/**
 * Debug Trace Endpoint for Window 93
 *
 * GET /v1/debug/trace?traceId=...
 *
 * Provides comprehensive debugging information for a traceId:
 * - Gateway (D1) events with delivery status
 * - Convex events (optional, via /eventsByTraceId)
 *
 * Requires X-Admin-Key header for authentication.
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { isValidTraceId } from "../utils/trace";
import { EventRow } from "../types/database";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "routes/debugTrace" });

// ============================================================================
// Types
// ============================================================================

interface GatewayRow {
  eventId: string;
  userId: string;
  sourceApp: string;
  eventType: string;
  timestampMs: number;
  privacyScope: string;
  consentScope: string | null;
  consentVersion: string;
  idempotencyKey: string;
  receivedAtMs: number | null;
  traceId: string | null;
  delivery: {
    convex: {
      status: string;
      deliveredAt: number | null;
      error: string | null;
    };
    brain: {
      status: string;
      deliveredAt: number | null;
      error: string | null;
    };
    social: {
      status: string;
      deliveredAt: number | null;
      error: string | null;
    };
  };
}

interface GatewayBlock {
  rows: GatewayRow[];
  count: number;
}

interface ConvexEvent {
  _id: string;
  eventId: string;
  userId: string;
  eventType: string;
  sourceApp: string;
  ingestedAt: number;
  brainStatus?: string;
  brainAttempts?: number;
  brainError?: string | null;
  traceId?: string;
}

interface ConvexBlock {
  events: ConvexEvent[];
  count: number;
}

interface DebugTraceResponse {
  ok: boolean;
  traceId: string;
  gateway: GatewayBlock;
  convex?: ConvexBlock;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Auth Helper
// ============================================================================

function verifyAdminAuth(req: Request, env: Env): { ok: true } | { ok: false; response: Response } {
  const adminKey = req.headers.get("X-Admin-Key") || "";
  const expected = env.ADMIN_API_KEY;

  if (!expected || adminKey !== expected) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: { code: "FORBIDDEN", message: "X-Admin-Key header required" },
        },
        403
      ),
    };
  }

  return { ok: true };
}

// ============================================================================
// D1 Query: Events by traceId
// ============================================================================

async function queryGatewayByTraceId(env: Env, traceId: string, limit: number = 100): Promise<GatewayRow[]> {
  const res = await env.DB.prepare(`
    SELECT
      id,
      user_id,
      source_app,
      event_type,
      timestamp_ms,
      privacy_scope,
      consent_scope,
      consent_version,
      idempotency_key,
      received_at_ms,
      trace_id,
      convex_delivery_status,
      delivered_to_convex_at_ms,
      convex_delivery_error,
      brain_delivery_status,
      brain_delivered_at_ms,
      brain_delivery_error,
      social_delivery_status,
      social_forwarded_at_ms,
      social_delivery_error
    FROM events
    WHERE trace_id = ?
    ORDER BY timestamp_ms DESC
    LIMIT ?
  `)
    .bind(traceId, limit)
    .all();

  const rows = (res.results ?? []) as unknown as EventRow[];

  return rows.map((row) => ({
    eventId: row.id,
    userId: row.user_id,
    sourceApp: row.source_app,
    eventType: row.event_type,
    timestampMs: row.timestamp_ms,
    privacyScope: row.privacy_scope,
    consentScope: row.consent_scope,
    consentVersion: row.consent_version,
    idempotencyKey: row.idempotency_key,
    receivedAtMs: row.received_at_ms,
    traceId: row.trace_id,
    delivery: {
      convex: {
        status: row.convex_delivery_status ?? "pending",
        deliveredAt: row.delivered_to_convex_at_ms ?? null,
        error: row.convex_delivery_error ?? null,
      },
      brain: {
        status: row.brain_delivery_status ?? "pending",
        deliveredAt: row.brain_delivered_at_ms ?? null,
        error: row.brain_delivery_error ?? null,
      },
      social: {
        status: row.social_delivery_status ?? "skipped",
        deliveredAt: row.social_forwarded_at_ms ?? null,
        error: row.social_delivery_error ?? null,
      },
    },
  }));
}

// ============================================================================
// Convex Query: Events by traceId (optional)
// ============================================================================

async function queryConvexByTraceId(
  env: Env,
  traceId: string
): Promise<ConvexBlock | null> {
  // Check if Convex URL is configured
  const convexUrl = env.CONVEX_INGEST_URL;
  if (!convexUrl) {
    return null;
  }

  try {
    // Derive the query URL from the ingest URL
    // e.g., https://xxx.convex.site/ingest -> https://xxx.convex.site/eventsByTraceId
    const baseUrl = convexUrl.replace(/\/ingest$/, "");
    const queryUrl = `${baseUrl}/eventsByTraceId?traceId=${encodeURIComponent(traceId)}`;

    const resp = await fetch(queryUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      },
    });

    if (!resp.ok) {
      // Convex query failed, but that's OK - we still have Gateway data
      logger.warn("Convex query failed", { status: resp.status, traceId });
      return null;
    }

    const data = await resp.json() as { events?: ConvexEvent[]; count?: number };

    return {
      events: data.events ?? [],
      count: data.count ?? (data.events?.length ?? 0),
    };
  } catch (err) {
    // Convex query error - log and continue
    logger.error("Convex query error", err instanceof Error ? err : null, { traceId });
    return null;
  }
}

// ============================================================================
// Handler: GET /v1/debug/trace
// ============================================================================

export async function handleDebugTrace(req: Request, env: Env): Promise<Response> {
  // Verify admin authentication
  const auth = verifyAdminAuth(req, env);
  if (!auth.ok) {
    return auth.response;
  }

  // Parse query parameters
  const url = new URL(req.url);
  const traceId = url.searchParams.get("traceId");
  const includeConvex = url.searchParams.get("includeConvex") !== "false"; // default true
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)));

  // Validate traceId
  if (!traceId || !isValidTraceId(traceId)) {
    return json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "traceId query parameter is required and must be non-empty",
        },
      },
      400
    );
  }

  // Minimum traceId length check
  if (traceId.length < 8) {
    return json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "traceId must be at least 8 characters",
        },
      },
      400
    );
  }

  try {
    // Query Gateway (D1)
    const gatewayRows = await queryGatewayByTraceId(env, traceId, limit);

    // Optionally query Convex
    let convexBlock: ConvexBlock | undefined;
    if (includeConvex) {
      const convexResult = await queryConvexByTraceId(env, traceId);
      if (convexResult) {
        convexBlock = convexResult;
      }
    }

    const response: DebugTraceResponse = {
      ok: true,
      traceId,
      gateway: {
        rows: gatewayRows,
        count: gatewayRows.length,
      },
    };

    if (convexBlock) {
      response.convex = convexBlock;
    }

    return json(response, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to query trace data";
    return json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message,
        },
      },
      500
    );
  }
}
