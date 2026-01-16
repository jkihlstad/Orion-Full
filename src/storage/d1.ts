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
      id, userId, sourceApp, eventType, timestampMs, privacyScope,
      consentScope, consentVersion, idempotencyKey, payloadJson, blobRefsJson,
      receivedAtMs, toConvexStatus, toSocialStatus
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

/**
 * Insert event with traceId for golden flow tests
 * The traceId column allows tracking events through the entire pipeline
 */
export async function d1InsertEventWithTrace(env: Env, row: {
  event: EventEnvelopeT;
  payloadJson: string;
  blobRefsJson: string | null;
  traceId: string;
}) {
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO events (
      id, userId, sourceApp, eventType, timestampMs, privacyScope,
      consentScope, consentVersion, idempotencyKey, payloadJson, blobRefsJson,
      receivedAtMs, toConvexStatus, toSocialStatus, traceId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?)`
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
      now,
      row.traceId
    )
    .run();
}

/**
 * Get events by traceId (for golden flow test verification)
 */
export async function d1GetEventsByTraceId(env: Env, traceId: string, userId?: string, limit?: number) {
  const maxLimit = limit ?? 100;

  if (userId) {
    // User-scoped query (for Dashboard search - security enforced)
    const res = await env.DB.prepare(
      `SELECT * FROM events WHERE traceId = ? AND userId = ? ORDER BY timestampMs DESC LIMIT ?`
    )
      .bind(traceId, userId, maxLimit)
      .all();
    return res.results ?? [];
  } else {
    // Admin query (no user filter)
    const res = await env.DB.prepare(
      `SELECT * FROM events WHERE traceId = ? ORDER BY timestampMs DESC LIMIT ?`
    )
      .bind(traceId, maxLimit)
      .all();
    return res.results ?? [];
  }
}

export async function d1GetEventById(env: Env, eventId: string, userId?: string) {
  if (userId) {
    // User-scoped query (for Dashboard search - security enforced)
    return await env.DB.prepare(
      `SELECT * FROM events WHERE id = ? AND userId = ?`
    ).bind(eventId, userId).first();
  } else {
    // Admin query (no user filter)
    return await env.DB.prepare(
      `SELECT * FROM events WHERE id = ?`
    ).bind(eventId).first();
  }
}

export async function d1ListEventsForUser(
  env: Env,
  userId: string,
  sinceMs: number | null,
  limit: number
) {
  const sql = sinceMs
    ? `SELECT * FROM events WHERE userId = ? AND timestampMs >= ? ORDER BY timestampMs DESC LIMIT ?`
    : `SELECT * FROM events WHERE userId = ? ORDER BY timestampMs DESC LIMIT ?`;

  const binds = sinceMs ? [userId, sinceMs, limit] : [userId, limit];
  const res = await env.DB.prepare(sql).bind(...binds).all();
  return res.results ?? [];
}

export async function d1CountUserEvents7d(env: Env, userId: string) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const r = await env.DB.prepare(
    `SELECT COUNT(1) as c FROM events WHERE userId = ? AND timestampMs >= ?`
  )
    .bind(userId, since)
    .first<{ c: number }>();
  return Number(r?.c ?? 0);
}

// ============================================================================
// Window H.9: Admin/Internal Event Listing
// ============================================================================

/**
 * List events with optional filters (for admin/internal use).
 * Window H.9.6: Supports eventType, userId, and limit filters.
 *
 * @param env - Environment bindings
 * @param args - Filter arguments
 * @returns Array of event rows
 */
export async function d1ListEventsFiltered(
  env: Env,
  args: {
    eventType?: string;
    userId?: string;
    limit: number;
    sinceMs?: number;
  }
) {
  const where: string[] = [];
  const binds: (string | number)[] = [];

  if (args.eventType) {
    where.push("eventType = ?");
    binds.push(args.eventType);
  }
  if (args.userId) {
    where.push("userId = ?");
    binds.push(args.userId);
  }
  if (args.sinceMs) {
    where.push("timestampMs >= ?");
    binds.push(args.sinceMs);
  }

  const sql = `
    SELECT id, userId, sourceApp, eventType, timestampMs, privacyScope,
           consentScope, consentVersion, idempotencyKey, payloadJson,
           blobRefsJson, receivedAtMs, traceId
    FROM events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY receivedAtMs DESC
    LIMIT ?;
  `;
  binds.push(Math.min(500, Math.max(1, args.limit)));

  const res = await env.DB.prepare(sql).bind(...binds).all();
  return res.results ?? [];
}

/**
 * Insert event with deduplication support.
 * Uses the idempotency table for proper deduplication.
 *
 * @param env - Environment bindings
 * @param userId - User ID
 * @param eventType - Event type
 * @param privacyScope - Privacy scope
 * @param tsMs - Client timestamp
 * @param payload - Event payload
 * @param payloadPreview - Optional preview payload (stored in payload_preview_json)
 * @param dedupeKey - Optional deduplication key (uses generated UUID if not provided)
 * @returns InsertResult with ok, id, and deduped status
 */
export async function d1InsertEventWithDedupe(
  env: Env,
  userId: string,
  eventType: string,
  privacyScope: string,
  tsMs: number,
  payload: Record<string, unknown>,
  payloadPreview?: Record<string, unknown>,
  dedupeKey?: string
): Promise<{ ok: true; id: string; deduped: boolean } | { ok: false; error: string }> {
  const eventId = crypto.randomUUID();
  const now = Date.now();
  const idempotencyKey = dedupeKey || eventId;

  // Check idempotency table first - if key exists, return existing event ID
  const existingEventId = await d1UpsertIdempotency(env, userId, idempotencyKey, eventId);
  if (existingEventId && existingEventId !== eventId) {
    return { ok: true, id: existingEventId, deduped: true };
  }

  const sourceApp = eventType.split(".")[0] || "system";
  const payloadJson = JSON.stringify(payload);
  const previewJson = payloadPreview ? JSON.stringify(payloadPreview) : null;

  try {
    await env.DB.prepare(
      `INSERT INTO events (
        id, userId, sourceApp, eventType, timestampMs, privacyScope,
        consentScope, consentVersion, idempotencyKey, payloadJson,
        blobRefsJson, payloadPreviewJson, receivedAtMs, toConvexStatus, toSocialStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')`
    )
      .bind(
        eventId,
        userId,
        sourceApp,
        eventType,
        Math.floor(tsMs),
        privacyScope,
        null,           // consentScope (internal events can set null)
        "internal",     // consentVersion
        idempotencyKey,
        payloadJson,
        null,           // blobRefsJson
        previewJson,    // payloadPreviewJson
        now
      )
      .run();

    return { ok: true, id: eventId, deduped: false };
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    return { ok: false, error: msg };
  }
}

/**
 * Batch insert events with deduplication.
 * Window H.9.6: Sequential inserts with dedupe handling.
 *
 * @param env - Environment bindings
 * @param userId - User ID
 * @param events - Array of events to insert
 * @returns Array of InsertResults
 */
export async function d1InsertEventsBatch(
  env: Env,
  userId: string,
  events: Array<{
    eventType: string;
    privacyScope: string;
    tsMs: number;
    payload: Record<string, unknown>;
    payloadPreview?: Record<string, unknown>;
    dedupeKey?: string;
  }>
): Promise<Array<{ ok: true; id: string; deduped: boolean } | { ok: false; error: string }>> {
  const results: Array<{ ok: true; id: string; deduped: boolean } | { ok: false; error: string }> = [];

  for (const e of events) {
    const result = await d1InsertEventWithDedupe(
      env,
      userId,
      e.eventType,
      e.privacyScope,
      e.tsMs,
      e.payload,
      e.payloadPreview,
      e.dedupeKey
    );
    results.push(result);
  }

  return results;
}

// ============================================================================
// Idempotency
// ============================================================================

export async function d1UpsertIdempotency(env: Env, userId: string, idemKey: string, eventId: string) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO idempotency (userId, idempotencyKey, eventId, createdAtMs)
     VALUES (?, ?, ?, ?)`
  )
    .bind(userId, idemKey, eventId, now)
    .run();

  const r = await env.DB.prepare(
    `SELECT eventId FROM idempotency WHERE userId = ? AND idempotencyKey = ?`
  )
    .bind(userId, idemKey)
    .first<{ eventId: string }>();

  return r?.eventId ?? null;
}

// ============================================================================
// Delivery Status (compatible with 0001_d1.sql columns)
// ============================================================================

/**
 * Delivery status types matching actual schema:
 * - Convex: pending | ok | failed
 * - Social: pending | ok | failed | skipped
 */
export type ConvexDeliveryStatus = 'pending' | 'ok' | 'failed';
export type SocialDeliveryStatus = 'pending' | 'ok' | 'failed' | 'skipped';

export interface DeliveryResult {
  success: boolean;
  httpStatus?: number;
  error?: string;
  skipReason?: string;
}

/**
 * Convex delivery tracking columns (after migration 0008):
 * - toConvexAtMs
 * - toConvexStatus (pending|ok|failed)
 * - toConvexLastError
 */
export async function d1MarkConvexDelivery(
  env: Env,
  eventId: string,
  result: DeliveryResult
) {
  const now = Date.now();
  const status: ConvexDeliveryStatus = result.skipReason
    ? 'failed'  // Map skipped to failed for convex (schema doesn't have skipped)
    : result.success
      ? 'ok'
      : 'failed';

  await env.DB.prepare(
    `UPDATE events SET
      toConvexAtMs = CASE WHEN ? = 'ok' THEN ? ELSE toConvexAtMs END,
      toConvexStatus = ?,
      toConvexLastError = ?
     WHERE id = ?`
  )
    .bind(
      status,
      now,
      status,
      status === 'ok' ? null : (result.error ?? result.skipReason ?? 'unknown'),
      eventId
    )
    .run();
}

/**
 * Legacy wrapper for backward compatibility
 */
export async function d1MarkConvexDeliverySimple(
  env: Env,
  eventId: string,
  ok: boolean,
  error?: string
) {
  await d1MarkConvexDelivery(env, eventId, {
    success: ok,
    error: error,
  });
}

/**
 * Social delivery tracking columns (after migration 0008):
 * - toSocialAtMs
 * - toSocialStatus (pending|ok|failed|skipped)
 * - toSocialLastError
 */
export async function d1MarkSocialDelivery(
  env: Env,
  eventId: string,
  result: DeliveryResult
) {
  const now = Date.now();
  const status: SocialDeliveryStatus = result.skipReason
    ? 'skipped'
    : result.success
      ? 'ok'
      : 'failed';

  await env.DB.prepare(
    `UPDATE events SET
      toSocialAtMs = CASE WHEN ? = 'ok' THEN ? ELSE toSocialAtMs END,
      toSocialStatus = ?,
      toSocialLastError = ?
     WHERE id = ?`
  )
    .bind(
      status,
      now,
      status,
      status === 'ok' ? null : (result.error ?? result.skipReason ?? 'unknown'),
      eventId
    )
    .run();
}

/**
 * Legacy wrapper for backward compatibility
 */
export async function d1MarkSocialDeliverySimple(
  env: Env,
  eventId: string,
  ok: boolean,
  error?: string
) {
  await d1MarkSocialDelivery(env, eventId, {
    success: ok,
    error: error,
  });
}

/**
 * Mark Social delivery as skipped (default state or blocked by privacy)
 */
export async function d1SkipSocialDelivery(
  env: Env,
  eventId: string,
  reason: string
) {
  await env.DB.prepare(
    `UPDATE events SET
      toSocialStatus = 'skipped',
      toSocialLastError = ?
     WHERE id = ?`
  )
    .bind(reason, eventId)
    .run();
}

/**
 * Get events with failed delivery status for a given target
 */
export async function d1GetFailedDeliveries(
  env: Env,
  target: 'convex' | 'social',
  limit: number = 100
) {
  const statusCol = target === 'convex'
    ? 'toConvexStatus'
    : 'toSocialStatus';

  const res = await env.DB.prepare(
    `SELECT * FROM events WHERE ${statusCol} = 'failed' ORDER BY receivedAtMs DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return res.results ?? [];
}

/**
 * Get pending deliveries for a given target (for retry scanning)
 */
export async function d1GetPendingDeliveries(
  env: Env,
  target: 'convex' | 'social',
  olderThanMs: number,
  limit: number = 100
) {
  const statusCol = target === 'convex'
    ? 'toConvexStatus'
    : 'toSocialStatus';

  const res = await env.DB.prepare(
    `SELECT * FROM events
     WHERE ${statusCol} = 'pending'
       AND receivedAtMs < ?
     ORDER BY receivedAtMs ASC
     LIMIT ?`
  )
    .bind(olderThanMs, limit)
    .all();
  return res.results ?? [];
}

// ============================================================================
// Consents (Legacy - per-scope storage)
// ============================================================================

export async function d1GetConsent(env: Env, userId: string, scope: string) {
  // First check legacy consents table
  const r = await env.DB.prepare(
    `SELECT enabled FROM consents WHERE userId = ? AND scope = ?`
  )
    .bind(userId, scope)
    .first<{ enabled: number }>();

  if (r) {
    return r.enabled === 1;
  }

  // Fall back to user_consents table (Window 25 bulk storage)
  const userConsents = await d1GetUserConsents(env, userId);
  if (userConsents && userConsents.scopes[scope] !== undefined) {
    return userConsents.scopes[scope] === true;
  }

  return false;
}

export async function d1SetConsent(env: Env, userId: string, scope: string, enabled: boolean) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO consents (userId, scope, enabled, updatedAtMs)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, scope) DO UPDATE SET enabled = ?, updatedAtMs = ?`
  )
    .bind(userId, scope, enabled ? 1 : 0, now, enabled ? 1 : 0, now)
    .run();
}

export async function d1ListConsents(env: Env, userId: string) {
  const r = await env.DB.prepare(
    `SELECT scope, enabled, updatedAtMs FROM consents WHERE userId = ?`
  )
    .bind(userId)
    .all<{ scope: string; enabled: number; updatedAtMs: number }>();

  return (r.results ?? []).map((c) => ({
    scope: c.scope,
    enabled: c.enabled === 1,
    updatedAt: c.updatedAtMs,
  }));
}

// ============================================================================
// User Consents (Window 25 - full consent object storage)
// ============================================================================

/**
 * User consent data with version and all scopes.
 */
export interface UserConsentsRow {
  consentVersion: string;
  scopes: Record<string, boolean>;
  updatedAtMs: number;
}

/**
 * Get user's full consent object.
 * Returns null if user has no stored consents.
 *
 * Table schema (add to db/schema.sql):
 * ```sql
 * CREATE TABLE IF NOT EXISTS user_consents (
 *   userId TEXT PRIMARY KEY,
 *   consentVersion TEXT NOT NULL,
 *   scopesJson TEXT NOT NULL,
 *   updatedAtMs INTEGER NOT NULL
 * );
 * ```
 */
export async function d1GetUserConsents(
  env: Env,
  userId: string
): Promise<UserConsentsRow | null> {
  const row = await env.DB.prepare(
    `SELECT consentVersion, scopesJson, updatedAtMs FROM user_consents WHERE userId = ?`
  )
    .bind(userId)
    .first<{ consentVersion: string; scopesJson: string; updatedAtMs: number }>();

  if (!row) return null;

  return {
    consentVersion: row.consentVersion,
    scopes: JSON.parse(row.scopesJson),
    updatedAtMs: row.updatedAtMs,
  };
}

/**
 * Set user's full consent object.
 * Upserts the entire consent state.
 */
export async function d1SetUserConsents(
  env: Env,
  userId: string,
  consentVersion: string,
  scopes: Record<string, boolean>
): Promise<void> {
  const now = Date.now();
  const scopesJson = JSON.stringify(scopes);

  await env.DB.prepare(
    `INSERT INTO user_consents (userId, consentVersion, scopesJson, updatedAtMs)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       consentVersion = ?,
       scopesJson = ?,
       updatedAtMs = ?`
  )
    .bind(userId, consentVersion, scopesJson, now, consentVersion, scopesJson, now)
    .run();
}

/**
 * Check if user has a specific consent scope enabled.
 * Uses the new user_consents table.
 */
export async function d1CheckUserConsent(
  env: Env,
  userId: string,
  scope: string
): Promise<boolean> {
  const consents = await d1GetUserConsents(env, userId);
  if (!consents) return false;
  return consents.scopes[scope] === true;
}

/**
 * Check multiple consent scopes for a user.
 * Returns true only if ALL specified scopes are enabled.
 */
export async function d1CheckUserConsents(
  env: Env,
  userId: string,
  scopes: string[]
): Promise<boolean> {
  if (scopes.length === 0) return true;

  const consents = await d1GetUserConsents(env, userId);
  if (!consents) return false;

  return scopes.every((scope) => consents.scopes[scope] === true);
}

// ============================================================================
// Audit Log
// ============================================================================

export async function d1Audit(env: Env, action: string, detail: string, userId?: string) {
  await env.DB.prepare(
    `INSERT INTO audit_log (atMs, userId, action, detail) VALUES (?, ?, ?, ?)`
  )
    .bind(Date.now(), userId ?? null, action, detail)
    .run();
}

// ============================================================================
// Event Blobs (Window 23)
// ============================================================================

/**
 * Blob reference as stored in D1
 */
export interface BlobRefRow {
  r2Key: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Insert blob references for an event.
 * Called when an event with blobRefs[] is ingested.
 * This creates the audit trail linking events to blobs.
 *
 * Table schema (add to db/schema.sql):
 * ```sql
 * CREATE TABLE IF NOT EXISTS event_blobs (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   event_id TEXT NOT NULL,
 *   r2_key TEXT NOT NULL,
 *   content_type TEXT NOT NULL,
 *   size_bytes INTEGER NOT NULL,
 *   created_at_ms INTEGER NOT NULL,
 *   FOREIGN KEY (event_id) REFERENCES events(id)
 * );
 * CREATE INDEX idx_event_blobs_event ON event_blobs(event_id);
 * CREATE INDEX idx_event_blobs_r2key ON event_blobs(r2_key);
 * ```
 */
export async function d1InsertEventBlobs(
  env: Env,
  eventId: string,
  blobRefs: BlobRefRow[]
) {
  if (blobRefs.length === 0) return;

  const now = Date.now();

  // Insert each blob reference
  for (const blob of blobRefs) {
    await env.DB.prepare(
      `INSERT INTO event_blobs (eventId, r2Key, contentType, sizeBytes, createdAtMs)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(eventId, blob.r2Key, blob.contentType, blob.sizeBytes, now)
      .run();
  }
}

/**
 * Get blob references for an event.
 */
export async function d1GetEventBlobs(env: Env, eventId: string): Promise<BlobRefRow[]> {
  const res = await env.DB.prepare(
    `SELECT r2Key, contentType, sizeBytes FROM event_blobs WHERE eventId = ?`
  )
    .bind(eventId)
    .all<{ r2Key: string; contentType: string; sizeBytes: number }>();

  return (res.results ?? []).map((row) => ({
    r2Key: row.r2Key,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  }));
}

/**
 * Get events that reference a specific blob.
 * Useful for orphan detection and cleanup.
 */
export async function d1GetEventsByBlobKey(env: Env, r2Key: string) {
  const res = await env.DB.prepare(
    `SELECT e.* FROM events e
     INNER JOIN event_blobs eb ON e.id = eb.eventId
     WHERE eb.r2Key = ?`
  )
    .bind(r2Key)
    .all();
  return res.results ?? [];
}

/**
 * Count blob references for a user (for stats/quotas).
 */
export async function d1CountUserBlobs(env: Env, userId: string) {
  const res = await env.DB.prepare(
    `SELECT COUNT(*) as count, SUM(eb.sizeBytes) as totalBytes
     FROM event_blobs eb
     INNER JOIN events e ON eb.eventId = e.id
     WHERE e.userId = ?`
  )
    .bind(userId)
    .first<{ count: number; totalBytes: number }>();

  return {
    count: res?.count ?? 0,
    totalBytes: res?.totalBytes ?? 0,
  };
}

/**
 * Find orphaned blobs (blobs not referenced by any event).
 * Useful for cleanup jobs.
 * Note: This requires knowing what blobs exist in R2 separately.
 */
export async function d1GetReferencedBlobKeys(env: Env, limit: number = 1000) {
  const res = await env.DB.prepare(
    `SELECT DISTINCT r2Key FROM event_blobs ORDER BY createdAtMs DESC LIMIT ?`
  )
    .bind(limit)
    .all<{ r2Key: string }>();

  return (res.results ?? []).map((row) => row.r2Key);
}

// ============================================================================
// Profile Snapshots (Window B - Questionnaire Sync)
// ============================================================================

/**
 * Profile snapshot as stored in D1
 */
export interface ProfileSnapshotRow {
  userId: string;
  questionnaireId: string;
  questionnaireVersion: number;
  answers: Record<string, unknown>;
  answerCount: number;
  sourceApp: string;
  updatedAtMs: number;
  createdAtMs: number;
  eventId?: string;
}

/**
 * Upsert a profile snapshot from a questionnaire event.
 * Called when profile.avatar_snapshot_updated or profile.app_snapshot_updated events are received.
 *
 * @param env - Environment bindings
 * @param snapshot - The snapshot data to upsert
 */
export async function d1UpsertProfileSnapshot(
  env: Env,
  snapshot: ProfileSnapshotRow
): Promise<void> {
  const now = Date.now();
  const answersJson = JSON.stringify(snapshot.answers);

  // Check if record exists to determine createdAtMs
  const existing = await env.DB.prepare(
    `SELECT createdAtMs FROM profile_snapshots WHERE userId = ? AND questionnaireId = ?`
  )
    .bind(snapshot.userId, snapshot.questionnaireId)
    .first<{ createdAtMs: number }>();

  const createdAtMs = existing?.createdAtMs ?? now;

  // Upsert the snapshot
  await env.DB.prepare(
    `INSERT INTO profile_snapshots (
      userId, questionnaireId, questionnaireVersion, answersJson,
      answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, questionnaireId) DO UPDATE SET
      questionnaireVersion = ?,
      answersJson = ?,
      answerCount = ?,
      sourceApp = ?,
      updatedAtMs = ?,
      eventId = ?`
  )
    .bind(
      snapshot.userId,
      snapshot.questionnaireId,
      snapshot.questionnaireVersion,
      answersJson,
      snapshot.answerCount,
      snapshot.sourceApp,
      now,
      createdAtMs,
      snapshot.eventId ?? null,
      // ON CONFLICT update values
      snapshot.questionnaireVersion,
      answersJson,
      snapshot.answerCount,
      snapshot.sourceApp,
      now,
      snapshot.eventId ?? null
    )
    .run();

  // Also insert into history for audit trail
  await env.DB.prepare(
    `INSERT INTO profile_snapshot_history (
      userId, questionnaireId, questionnaireVersion, answersJson,
      answerCount, sourceApp, eventId, createdAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      snapshot.userId,
      snapshot.questionnaireId,
      snapshot.questionnaireVersion,
      answersJson,
      snapshot.answerCount,
      snapshot.sourceApp,
      snapshot.eventId ?? "",
      now
    )
    .run();
}

/**
 * Get a specific profile snapshot by questionnaire ID.
 *
 * @param env - Environment bindings
 * @param userId - The user's Clerk ID
 * @param questionnaireId - The questionnaire ID (e.g., "avatar.core.v1")
 * @returns The snapshot or null if not found
 */
export async function d1GetProfileSnapshot(
  env: Env,
  userId: string,
  questionnaireId: string
): Promise<ProfileSnapshotRow | null> {
  const row = await env.DB.prepare(
    `SELECT userId, questionnaireId, questionnaireVersion, answersJson,
            answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
     FROM profile_snapshots
     WHERE userId = ? AND questionnaireId = ?`
  )
    .bind(userId, questionnaireId)
    .first<{
      userId: string;
      questionnaireId: string;
      questionnaireVersion: number;
      answersJson: string;
      answerCount: number;
      sourceApp: string;
      updatedAtMs: number;
      createdAtMs: number;
      eventId: string | null;
    }>();

  if (!row) return null;

  return {
    userId: row.userId,
    questionnaireId: row.questionnaireId,
    questionnaireVersion: row.questionnaireVersion,
    answers: JSON.parse(row.answersJson),
    answerCount: row.answerCount,
    sourceApp: row.sourceApp,
    updatedAtMs: row.updatedAtMs,
    createdAtMs: row.createdAtMs,
    eventId: row.eventId ?? undefined,
  };
}

/**
 * Get all profile snapshots for a user.
 *
 * @param env - Environment bindings
 * @param userId - The user's Clerk ID
 * @returns Array of snapshots
 */
export async function d1ListProfileSnapshots(
  env: Env,
  userId: string
): Promise<ProfileSnapshotRow[]> {
  const res = await env.DB.prepare(
    `SELECT userId, questionnaireId, questionnaireVersion, answersJson,
            answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
     FROM profile_snapshots
     WHERE userId = ?
     ORDER BY updatedAtMs DESC`
  )
    .bind(userId)
    .all<{
      userId: string;
      questionnaireId: string;
      questionnaireVersion: number;
      answersJson: string;
      answerCount: number;
      sourceApp: string;
      updatedAtMs: number;
      createdAtMs: number;
      eventId: string | null;
    }>();

  return (res.results ?? []).map((row) => ({
    userId: row.userId,
    questionnaireId: row.questionnaireId,
    questionnaireVersion: row.questionnaireVersion,
    answers: JSON.parse(row.answersJson),
    answerCount: row.answerCount,
    sourceApp: row.sourceApp,
    updatedAtMs: row.updatedAtMs,
    createdAtMs: row.createdAtMs,
    eventId: row.eventId ?? undefined,
  }));
}

/**
 * Get avatar-specific profile snapshot.
 * Convenience function for getting the avatar.core questionnaire.
 *
 * @param env - Environment bindings
 * @param userId - The user's Clerk ID
 * @returns The avatar snapshot or null
 */
export async function d1GetAvatarSnapshot(
  env: Env,
  userId: string
): Promise<ProfileSnapshotRow | null> {
  // Try to find any avatar.* questionnaire
  const row = await env.DB.prepare(
    `SELECT userId, questionnaireId, questionnaireVersion, answersJson,
            answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
     FROM profile_snapshots
     WHERE userId = ? AND questionnaireId LIKE 'avatar.%'
     ORDER BY updatedAtMs DESC
     LIMIT 1`
  )
    .bind(userId)
    .first<{
      userId: string;
      questionnaireId: string;
      questionnaireVersion: number;
      answersJson: string;
      answerCount: number;
      sourceApp: string;
      updatedAtMs: number;
      createdAtMs: number;
      eventId: string | null;
    }>();

  if (!row) return null;

  return {
    userId: row.userId,
    questionnaireId: row.questionnaireId,
    questionnaireVersion: row.questionnaireVersion,
    answers: JSON.parse(row.answersJson),
    answerCount: row.answerCount,
    sourceApp: row.sourceApp,
    updatedAtMs: row.updatedAtMs,
    createdAtMs: row.createdAtMs,
    eventId: row.eventId ?? undefined,
  };
}

/**
 * Get app-specific profile snapshots for a user.
 *
 * @param env - Environment bindings
 * @param userId - The user's Clerk ID
 * @param appId - Optional app ID to filter by (e.g., "email", "calendar")
 * @returns Array of app-specific snapshots
 */
export async function d1GetAppSnapshots(
  env: Env,
  userId: string,
  appId?: string
): Promise<ProfileSnapshotRow[]> {
  const sql = appId
    ? `SELECT userId, questionnaireId, questionnaireVersion, answersJson,
              answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
       FROM profile_snapshots
       WHERE userId = ? AND questionnaireId NOT LIKE 'avatar.%' AND sourceApp = ?
       ORDER BY updatedAtMs DESC`
    : `SELECT userId, questionnaireId, questionnaireVersion, answersJson,
              answerCount, sourceApp, updatedAtMs, createdAtMs, eventId
       FROM profile_snapshots
       WHERE userId = ? AND questionnaireId NOT LIKE 'avatar.%'
       ORDER BY updatedAtMs DESC`;

  const binds = appId ? [userId, appId] : [userId];

  const res = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{
      userId: string;
      questionnaireId: string;
      questionnaireVersion: number;
      answersJson: string;
      answerCount: number;
      sourceApp: string;
      updatedAtMs: number;
      createdAtMs: number;
      eventId: string | null;
    }>();

  return (res.results ?? []).map((row) => ({
    userId: row.userId,
    questionnaireId: row.questionnaireId,
    questionnaireVersion: row.questionnaireVersion,
    answers: JSON.parse(row.answersJson),
    answerCount: row.answerCount,
    sourceApp: row.sourceApp,
    updatedAtMs: row.updatedAtMs,
    createdAtMs: row.createdAtMs,
    eventId: row.eventId ?? undefined,
  }));
}

/**
 * Get recent events for a user (Window B - /v1/events/recent).
 *
 * @param env - Environment bindings
 * @param userId - The user's Clerk ID
 * @param limit - Maximum number of events to return (default 50, max 200)
 * @param eventTypes - Optional array of event types to filter by
 * @returns Array of recent events
 */
export async function d1GetRecentEvents(
  env: Env,
  userId: string,
  limit: number = 50,
  eventTypes?: string[]
) {
  const maxLimit = Math.min(200, Math.max(1, limit));

  let sql: string;
  let binds: (string | number)[];

  if (eventTypes && eventTypes.length > 0) {
    const placeholders = eventTypes.map(() => "?").join(", ");
    sql = `SELECT id, userId, sourceApp, eventType, timestampMs, privacyScope,
                  consentScope, payloadJson, receivedAtMs
           FROM events
           WHERE userId = ? AND eventType IN (${placeholders})
           ORDER BY timestampMs DESC
           LIMIT ?`;
    binds = [userId, ...eventTypes, maxLimit];
  } else {
    sql = `SELECT id, userId, sourceApp, eventType, timestampMs, privacyScope,
                  consentScope, payloadJson, receivedAtMs
           FROM events
           WHERE userId = ?
           ORDER BY timestampMs DESC
           LIMIT ?`;
    binds = [userId, maxLimit];
  }

  const res = await env.DB.prepare(sql).bind(...binds).all();
  return res.results ?? [];
}
