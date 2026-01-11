import { Env } from "../env";
import { EventEnvelopeT } from "../types";

// ============================================================================
// Events
// ============================================================================

export async function d1InsertEvent(env: Env, row: {
  event: EventEnvelopeT;
  payloadJson: string;
  blobRefsJson: string | null;
}) {
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO events (
      id, user_id, source_app, event_type, timestamp_ms, privacy_scope,
      consent_scope, consent_version, idempotency_key, payload_json, blob_refs_json,
      received_at_ms, convex_delivery_status, social_delivery_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')`
  )
    .bind(
      row.event.eventId,
      row.event.userId,
      row.event.sourceApp,
      row.event.eventType,
      row.event.timestamp,
      row.event.privacyScope,
      row.event.consentScope ?? null,
      row.event.consentVersion,
      row.event.idempotencyKey,
      row.payloadJson,
      row.blobRefsJson,
      now
    )
    .run();
}

export async function d1GetEventById(env: Env, eventId: string) {
  return await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(eventId).first();
}

export async function d1ListEventsForUser(
  env: Env,
  userId: string,
  sinceMs: number | null,
  limit: number
) {
  const sql = sinceMs
    ? `SELECT * FROM events WHERE user_id = ? AND timestamp_ms >= ? ORDER BY timestamp_ms DESC LIMIT ?`
    : `SELECT * FROM events WHERE user_id = ? ORDER BY timestamp_ms DESC LIMIT ?`;

  const binds = sinceMs ? [userId, sinceMs, limit] : [userId, limit];
  const res = await env.DB.prepare(sql).bind(...binds).all();
  return res.results ?? [];
}

export async function d1CountUserEvents7d(env: Env, userId: string) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const r = await env.DB.prepare(
    `SELECT COUNT(1) as c FROM events WHERE user_id = ? AND timestamp_ms >= ?`
  )
    .bind(userId, since)
    .first<{ c: number }>();
  return Number(r?.c ?? 0);
}

// ============================================================================
// Idempotency
// ============================================================================

export async function d1UpsertIdempotency(env: Env, userId: string, idemKey: string, eventId: string) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO idempotency (user_id, idempotency_key, event_id, created_at_ms)
     VALUES (?, ?, ?, ?)`
  )
    .bind(userId, idemKey, eventId, now)
    .run();

  const r = await env.DB.prepare(
    `SELECT event_id FROM idempotency WHERE user_id = ? AND idempotency_key = ?`
  )
    .bind(userId, idemKey)
    .first<{ event_id: string }>();

  return r?.event_id ?? null;
}

// ============================================================================
// Delivery Status
// ============================================================================

export async function d1MarkConvexDelivery(env: Env, eventId: string, ok: boolean, error?: string) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE events
     SET delivered_to_convex_at_ms = ?, convex_delivery_status = ?, convex_delivery_error = ?
     WHERE id = ?`
  )
    .bind(now, ok ? "ok" : "failed", ok ? null : (error ?? "unknown"), eventId)
    .run();
}

export async function d1MarkSocialDelivery(env: Env, eventId: string, ok: boolean, error?: string) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE events
     SET social_forwarded_at_ms = ?, social_delivery_status = ?, social_delivery_error = ?
     WHERE id = ?`
  )
    .bind(now, ok ? "ok" : "failed", ok ? null : (error ?? "unknown"), eventId)
    .run();
}

// ============================================================================
// Consents
// ============================================================================

export async function d1GetConsent(env: Env, userId: string, scope: string) {
  const r = await env.DB.prepare(
    `SELECT enabled FROM consents WHERE user_id = ? AND scope = ?`
  )
    .bind(userId, scope)
    .first<{ enabled: number }>();

  return r ? r.enabled === 1 : false;
}

export async function d1SetConsent(env: Env, userId: string, scope: string, enabled: boolean) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO consents (user_id, scope, enabled, updated_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, scope) DO UPDATE SET enabled = ?, updated_at_ms = ?`
  )
    .bind(userId, scope, enabled ? 1 : 0, now, enabled ? 1 : 0, now)
    .run();
}

export async function d1ListConsents(env: Env, userId: string) {
  const r = await env.DB.prepare(
    `SELECT scope, enabled, updated_at_ms FROM consents WHERE user_id = ?`
  )
    .bind(userId)
    .all<{ scope: string; enabled: number; updated_at_ms: number }>();

  return (r.results ?? []).map((c) => ({
    scope: c.scope,
    enabled: c.enabled === 1,
    updatedAt: c.updated_at_ms,
  }));
}

// ============================================================================
// Audit Log
// ============================================================================

export async function d1Audit(env: Env, action: string, detail: string, userId?: string) {
  await env.DB.prepare(
    `INSERT INTO audit_log (at_ms, user_id, action, detail) VALUES (?, ?, ?, ?)`
  )
    .bind(Date.now(), userId ?? null, action, detail)
    .run();
}
