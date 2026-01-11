import { Env } from "../env";
import { json } from "../utils/respond";

/**
 * Admin endpoint to list events (requires X-Admin-Key)
 */
export async function handleEventsList(req: Request, env: Env): Promise<Response> {
  const adminKey = req.headers.get("X-Admin-Key") || "";
  const expected = env.ADMIN_API_KEY;
  if (!expected || adminKey !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const eventType = url.searchParams.get("eventType");
  const sourceApp = url.searchParams.get("sourceApp");
  const since = Number(url.searchParams.get("since") || "0");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || "100")));

  const where: string[] = [];
  const binds: any[] = [];

  if (userId) { where.push("user_id = ?"); binds.push(userId); }
  if (eventType) { where.push("event_type = ?"); binds.push(eventType); }
  if (sourceApp) { where.push("source_app = ?"); binds.push(sourceApp); }
  if (since > 0) { where.push("timestamp_ms >= ?"); binds.push(since); }

  const sql = `
    SELECT id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
           consent_scope, consent_version, idempotency_key, payload_json, blob_refs_json,
           received_at_ms, delivered_to_convex_at_ms, convex_delivery_status,
           convex_delivery_error, social_forwarded_at_ms, social_delivery_status,
           social_delivery_error
    FROM events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY timestamp_ms DESC
    LIMIT ?
  `;
  binds.push(limit);

  const res = await env.DB.prepare(sql).bind(...binds).all();
  return json({ ok: true, count: res.results?.length ?? 0, events: res.results });
}
