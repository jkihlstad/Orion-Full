/**
 * adminEventsList.ts
 *
 * GET /v1/events/list - Admin endpoint for debugging event delivery
 * Requires X-Admin-Key header (dev) or admin JWT claim (prod)
 */

import { GatewayError, ErrorCode } from './errors';
import { dbAll } from '../db/queries';
import { payloadPreview } from '../policy/redactPreview';
import type { EventRow } from '../db/schema';
import type { Env } from '../env';

/**
 * Verify admin access
 */
function requireAdmin(req: Request, env: Env): GatewayError | null {
  const key = req.headers.get('X-Admin-Key');

  // In production, could also check for admin JWT claim
  if (!key || key !== env.ADMIN_API_KEY) {
    return new GatewayError(
      ErrorCode.UNAUTHORIZED,
      'Admin key required',
      { hint: 'Provide X-Admin-Key header' }
    );
  }

  return null;
}

export async function adminEventsList(req: Request, env: Env): Promise<Response> {
  // Auth check
  const authError = requireAdmin(req, env);
  if (authError) {
    return authError.toResponse();
  }

  // Parse query params
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  const eventType = url.searchParams.get('eventType');
  const traceId = url.searchParams.get('traceId');
  const status = url.searchParams.get('status');
  const since = url.searchParams.get('since');
  const limitRaw = url.searchParams.get('limit') ?? '100';

  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500);
  const sinceMs = since ? parseInt(since, 10) : null;

  // Build query
  const rows = await dbAll<EventRow>(
    env.DB,
    `
    SELECT id, user_id, source_app, event_type, timestamp_ms, trace_id,
           status, convex_delivery_status, social_delivery_status,
           payload_json, blob_refs_json, client_meta_json
    FROM events
    WHERE (?1 IS NULL OR user_id = ?1)
      AND (?2 IS NULL OR event_type = ?2)
      AND (?3 IS NULL OR trace_id = ?3)
      AND (?4 IS NULL OR status = ?4)
      AND (?5 IS NULL OR timestamp_ms >= ?5)
    ORDER BY timestamp_ms DESC
    LIMIT ?6
    `,
    [userId, eventType, traceId, status, sinceMs, limit]
  );

  // Build response with redacted previews
  const events = rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      // ignore
    }

    let blobRefs: unknown[] = [];
    try {
      blobRefs = r.blob_refs_json ? JSON.parse(r.blob_refs_json) : [];
    } catch {
      // ignore
    }

    return {
      eventId: r.id,
      userId: r.user_id,
      sourceApp: r.source_app,
      eventType: r.event_type,
      timestampMs: r.timestamp_ms,
      traceId: r.trace_id,
      status: r.status,
      convexDeliveryStatus: r.convex_delivery_status,
      socialDeliveryStatus: r.social_delivery_status,
      payloadPreview: payloadPreview(r.event_type, payload),
      blobRefCount: blobRefs.length,
    };
  });

  // Calculate next cursor
  const nextCursor = events.length > 0
    ? events[events.length - 1].timestampMs - 1
    : null;

  return Response.json({
    ok: true,
    count: events.length,
    events,
    nextCursor,
  });
}

/**
 * GET /v1/events/:eventId - Get single event details (admin only)
 */
export async function adminEventDetail(
  req: Request,
  env: Env,
  eventId: string
): Promise<Response> {
  const authError = requireAdmin(req, env);
  if (authError) {
    return authError.toResponse();
  }

  const row = await dbAll<EventRow>(
    env.DB,
    'SELECT * FROM events WHERE id = ?1',
    [eventId]
  );

  if (row.length === 0) {
    return new GatewayError(
      ErrorCode.UNKNOWN_EVENT_TYPE,
      'Event not found',
      { eventId }
    ).toResponse();
  }

  const r = row[0];
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload_json);
  } catch {
    // ignore
  }

  return Response.json({
    ok: true,
    event: {
      ...r,
      // Still redact the payload preview even in detail view
      payloadPreview: payloadPreview(r.event_type, payload),
      // Include payload hash for verification
      payloadSha256: r.payload_sha256,
    },
  });
}

/**
 * GET /v1/events/stats - Event statistics (admin only)
 */
export async function adminEventStats(req: Request, env: Env): Promise<Response> {
  const authError = requireAdmin(req, env);
  if (authError) {
    return authError.toResponse();
  }

  const url = new URL(req.url);
  const hoursRaw = url.searchParams.get('hours') ?? '24';
  const hours = Math.min(Math.max(parseInt(hoursRaw, 10) || 24, 1), 168);
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;

  // Get counts by type
  const byType = await dbAll<{ event_type: string; count: number }>(
    env.DB,
    `SELECT event_type, COUNT(*) as count
     FROM events
     WHERE timestamp_ms >= ?1
     GROUP BY event_type
     ORDER BY count DESC
     LIMIT 50`,
    [sinceMs]
  );

  // Get counts by status
  const byStatus = await dbAll<{ status: string; count: number }>(
    env.DB,
    `SELECT status, COUNT(*) as count
     FROM events
     WHERE timestamp_ms >= ?1
     GROUP BY status`,
    [sinceMs]
  );

  // Get total count
  const total = await dbAll<{ count: number }>(
    env.DB,
    'SELECT COUNT(*) as count FROM events WHERE timestamp_ms >= ?1',
    [sinceMs]
  );

  return Response.json({
    ok: true,
    periodHours: hours,
    sinceMs,
    total: total[0]?.count ?? 0,
    byType,
    byStatus,
  });
}
