/**
 * dashboardSearch.ts
 *
 * GET /v1/dashboard/search - User endpoint for Dashboard recall
 * Used by Dashboard app and XCUITest GatewayAssert
 * Returns only the authenticated user's own events
 */

import { GatewayError, ErrorCode } from './errors';
import { dbAll } from '../db/queries';
import { payloadPreview } from '../policy/redactPreview';
import type { EventRow } from '../db/schema';
import type { Env } from '../env';

interface AuthResult {
  userId: string;
}

// Placeholder - replace with actual Clerk JWT verification
async function verifyUserAuth(req: Request, env: Env): Promise<AuthResult | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  // TODO: Implement actual Clerk JWT verification
  // For now, check for test header in development
  const testUserId = req.headers.get('X-Test-User-Id');
  if (testUserId) {
    return { userId: testUserId };
  }

  // In production, verify the JWT and extract userId
  // const token = authHeader.slice(7);
  // const claims = await verifyClerkJWT(token, env);
  // return { userId: claims.sub };

  return null;
}

export async function dashboardSearch(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'Method not allowed',
      { expected: 'GET' }
    ).toResponse();
  }

  // Authenticate user
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(
      ErrorCode.UNAUTHORIZED,
      'Bearer token required',
      {}
    ).toResponse();
  }

  const userId = auth.userId;

  // Parse query params
  const url = new URL(req.url);
  const traceId = url.searchParams.get('traceId');
  const eventType = url.searchParams.get('eventType');
  const sourceApp = url.searchParams.get('sourceApp');
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const limitRaw = url.searchParams.get('limit') ?? '200';

  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 200, 1), 500);
  const sinceMs = since ? parseInt(since, 10) : null;
  const untilMs = until ? parseInt(until, 10) : null;

  // Query events for this user only
  const rows = await dbAll<EventRow>(
    env.DB,
    `
    SELECT id, source_app, event_type, timestamp_ms, trace_id,
           payload_json, blob_refs_json
    FROM events
    WHERE user_id = ?1
      AND (?2 IS NULL OR trace_id = ?2)
      AND (?3 IS NULL OR event_type = ?3)
      AND (?4 IS NULL OR source_app = ?4)
      AND (?5 IS NULL OR timestamp_ms >= ?5)
      AND (?6 IS NULL OR timestamp_ms <= ?6)
    ORDER BY timestamp_ms DESC
    LIMIT ?7
    `,
    [userId, traceId, eventType, sourceApp, sinceMs, untilMs, limit]
  );

  // Build response
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
      eventType: r.event_type,
      sourceApp: r.source_app,
      timestampMs: r.timestamp_ms,
      traceId: r.trace_id,
      payloadPreview: payloadPreview(r.event_type, payload),
      blobRefs: blobRefs.map((b: unknown) => {
        const blob = b as Record<string, unknown>;
        return {
          contentType: blob.contentType,
          sizeBytes: blob.sizeBytes,
          // Don't expose r2Key or signed URLs in search results
        };
      }),
    };
  });

  // Calculate cursor
  const nextCursor = events.length > 0
    ? events[events.length - 1].timestampMs - 1
    : null;

  return Response.json({
    ok: true,
    userId,
    count: events.length,
    events,
    nextCursor,
  });
}

/**
 * GET /v1/dashboard/event/:eventId - Get single event for user
 */
export async function dashboardEventDetail(
  req: Request,
  env: Env,
  eventId: string
): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(
      ErrorCode.UNAUTHORIZED,
      'Bearer token required',
      {}
    ).toResponse();
  }

  const userId = auth.userId;

  const rows = await dbAll<EventRow>(
    env.DB,
    'SELECT * FROM events WHERE id = ?1 AND user_id = ?2',
    [eventId, userId]
  );

  if (rows.length === 0) {
    return new GatewayError(
      ErrorCode.UNKNOWN_EVENT_TYPE,
      'Event not found',
      { eventId }
    ).toResponse();
  }

  const r = rows[0];
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload_json);
  } catch {
    // ignore
  }

  return Response.json({
    ok: true,
    event: {
      eventId: r.id,
      eventType: r.event_type,
      sourceApp: r.source_app,
      timestampMs: r.timestamp_ms,
      traceId: r.trace_id,
      payloadPreview: payloadPreview(r.event_type, payload),
      status: r.status,
    },
  });
}

/**
 * GET /v1/dashboard/timeline - Timeline view for user
 */
export async function dashboardTimeline(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(
      ErrorCode.UNAUTHORIZED,
      'Bearer token required',
      {}
    ).toResponse();
  }

  const userId = auth.userId;
  const url = new URL(req.url);

  // Get events grouped by day
  const daysRaw = url.searchParams.get('days') ?? '7';
  const days = Math.min(Math.max(parseInt(daysRaw, 10) || 7, 1), 30);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // Get summary by day and app
  const summary = await dbAll<{
    day: string;
    source_app: string;
    count: number
  }>(
    env.DB,
    `SELECT
       date(timestamp_ms/1000, 'unixepoch') as day,
       source_app,
       COUNT(*) as count
     FROM events
     WHERE user_id = ?1 AND timestamp_ms >= ?2
     GROUP BY day, source_app
     ORDER BY day DESC, count DESC`,
    [userId, sinceMs]
  );

  // Group by day
  const timeline: Record<string, Record<string, number>> = {};
  for (const row of summary) {
    if (!timeline[row.day]) {
      timeline[row.day] = {};
    }
    timeline[row.day][row.source_app] = row.count;
  }

  return Response.json({
    ok: true,
    userId,
    days,
    timeline,
  });
}
