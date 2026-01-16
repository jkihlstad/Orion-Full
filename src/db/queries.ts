/**
 * D1 Database Query Helpers
 */

import type { EventRow, ConsentStateRow, DeliveryLogRow } from './schema';

/**
 * Execute a query and return all results
 */
export async function dbAll<T = unknown>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.all();
  return (res.results ?? []) as T[];
}

/**
 * Execute a query and return first result
 */
export async function dbFirst<T = unknown>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.first();
  return res as T | null;
}

/**
 * Execute a write query and return changes
 */
export async function dbRun(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<{ changes: number; lastRowId: number }> {
  const stmt = db.prepare(sql).bind(...params);
  const res = await stmt.run();
  return {
    changes: res.meta.changes ?? 0,
    lastRowId: res.meta.last_row_id ?? 0,
  };
}

// ============================================
// Event Queries
// ============================================

export async function insertEvent(
  db: D1Database,
  event: {
    id: string;
    user_id: string;
    source_app: string;
    event_type: string;
    timestamp_ms: number;
    privacy_scope: string;
    consent_version: string;
    contracts_version?: string | null;
    trace_id?: string | null;
    payload_json: string;
    payload_sha256?: string | null;
    blob_refs_json?: string | null;
    client_meta_json?: string | null;
    idempotency_key: string;
    status?: string;
    received_at_ms: number;
  }
): Promise<number> {
  const result = await dbRun(
    db,
    `INSERT INTO events (
      id, user_id, source_app, event_type, timestamp_ms,
      privacy_scope, consent_version, contracts_version, trace_id,
      payload_json, payload_sha256, blob_refs_json, client_meta_json,
      idempotency_key, status, received_at_ms
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5,
      ?6, ?7, ?8, ?9,
      ?10, ?11, ?12, ?13,
      ?14, ?15, ?16
    )`,
    [
      event.id,
      event.user_id,
      event.source_app,
      event.event_type,
      event.timestamp_ms,
      event.privacy_scope,
      event.consent_version,
      event.contracts_version ?? null,
      event.trace_id ?? null,
      event.payload_json,
      event.payload_sha256 ?? null,
      event.blob_refs_json ?? null,
      event.client_meta_json ?? null,
      event.idempotency_key,
      event.status ?? 'accepted',
      event.received_at_ms,
    ]
  );
  return result.lastRowId;
}

export async function getEventById(
  db: D1Database,
  eventId: string
): Promise<EventRow | null> {
  return dbFirst<EventRow>(
    db,
    'SELECT * FROM events WHERE id = ?1',
    [eventId]
  );
}

export async function getEventsByUser(
  db: D1Database,
  userId: string,
  options: {
    since?: number;
    eventType?: string;
    traceId?: string;
    limit?: number;
  } = {}
): Promise<EventRow[]> {
  const { since, eventType, traceId, limit = 100 } = options;

  return dbAll<EventRow>(
    db,
    `SELECT * FROM events
     WHERE user_id = ?1
       AND (?2 IS NULL OR timestamp_ms >= ?2)
       AND (?3 IS NULL OR event_type = ?3)
       AND (?4 IS NULL OR trace_id = ?4)
     ORDER BY timestamp_ms DESC
     LIMIT ?5`,
    [userId, since ?? null, eventType ?? null, traceId ?? null, limit]
  );
}

export async function updateEventStatus(
  db: D1Database,
  eventId: string,
  status: string,
  error?: string
): Promise<void> {
  const now = Date.now();

  if (status === 'delivered') {
    await dbRun(
      db,
      `UPDATE events
       SET status = ?1, delivered_to_convex_at_ms = ?2, convex_delivery_status = 'ok', convex_delivery_error = NULL
       WHERE id = ?3`,
      [status, now, eventId]
    );
  } else if (status === 'failed') {
    await dbRun(
      db,
      `UPDATE events
       SET status = ?1, convex_delivery_status = 'failed', convex_delivery_error = ?2
       WHERE id = ?3`,
      [status, error ?? null, eventId]
    );
  } else {
    await dbRun(
      db,
      `UPDATE events SET status = ?1 WHERE id = ?2`,
      [status, eventId]
    );
  }
}

// ============================================
// Consent State Queries
// ============================================

export async function getConsentState(
  db: D1Database,
  userId: string
): Promise<ConsentStateRow | null> {
  return dbFirst<ConsentStateRow>(
    db,
    'SELECT * FROM consent_state WHERE user_id = ?1',
    [userId]
  );
}

export async function upsertConsentState(
  db: D1Database,
  userId: string,
  consentVersion: string,
  scopes: Record<string, boolean>,
  ultraConsentAcknowledged: boolean
): Promise<void> {
  const now = Date.now();
  const scopesJson = JSON.stringify(scopes);

  await dbRun(
    db,
    `INSERT INTO consent_state (user_id, consent_version, scopes_json, ultra_consent_ack, updated_at_ms)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET
       consent_version = ?2,
       scopes_json = ?3,
       ultra_consent_ack = ?4,
       updated_at_ms = ?5`,
    [userId, consentVersion, scopesJson, ultraConsentAcknowledged ? 1 : 0, now]
  );
}

// ============================================
// Delivery Log Queries
// ============================================

export async function insertDeliveryLog(
  db: D1Database,
  log: {
    event_id: string;
    destination: string;
    status: string;
    attempt_number: number;
    response_code?: number | null;
    response_body?: string | null;
    error_message?: string | null;
    duration_ms?: number | null;
    created_at_ms: number;
  }
): Promise<void> {
  await dbRun(
    db,
    `INSERT INTO delivery_log (
      event_id, destination, status, attempt_number,
      response_code, response_body, error_message, duration_ms, created_at_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    [
      log.event_id,
      log.destination,
      log.status,
      log.attempt_number,
      log.response_code ?? null,
      log.response_body ?? null,
      log.error_message ?? null,
      log.duration_ms ?? null,
      log.created_at_ms,
    ]
  );
}

export async function getDeliveryLogs(
  db: D1Database,
  eventId: string
): Promise<DeliveryLogRow[]> {
  return dbAll<DeliveryLogRow>(
    db,
    'SELECT * FROM delivery_log WHERE event_id = ?1 ORDER BY created_at_ms DESC',
    [eventId]
  );
}

// ============================================
// Admin Queries
// ============================================

export async function getFailedEvents(
  db: D1Database,
  limit: number = 200
): Promise<EventRow[]> {
  return dbAll<EventRow>(
    db,
    `SELECT * FROM events
     WHERE status = 'failed'
     ORDER BY timestamp_ms DESC
     LIMIT ?1`,
    [limit]
  );
}

export async function getEventCountsByType(
  db: D1Database,
  sinceMs: number
): Promise<Array<{ event_type: string; count: number }>> {
  return dbAll<{ event_type: string; count: number }>(
    db,
    `SELECT event_type, COUNT(*) as count
     FROM events
     WHERE timestamp_ms >= ?1
     GROUP BY event_type
     ORDER BY count DESC`,
    [sinceMs]
  );
}

/**
 * Cleanup expired events.
 * Note: This function uses expiresAtMs which was added in migration 0002_add_tier_columns.
 * If your D1 database doesn't have this column, this function will fail.
 */
export async function cleanupExpiredEvents(
  db: D1Database
): Promise<number> {
  const now = Date.now();
  const result = await dbRun(
    db,
    'DELETE FROM events WHERE expiresAtMs IS NOT NULL AND expiresAtMs < ?1',
    [now]
  );
  return result.changes;
}

/**
 * Cleanup expired idempotency keys.
 * Deletes keys older than the specified max age (default: 24 hours).
 */
export async function cleanupExpiredIdempotencyKeys(
  db: D1Database,
  maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const result = await dbRun(
    db,
    'DELETE FROM idempotency WHERE created_at_ms < ?1',
    [cutoff]
  );
  return result.changes;
}
