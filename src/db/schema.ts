/**
 * D1 Database Schema Types
 *
 * These interfaces represent the rows as stored in D1.
 * Uses snake_case to match actual D1 column names.
 */

/**
 * EventRow represents an event stored in the D1 events table.
 * Uses snake_case to match actual D1 column names.
 */
export interface EventRow {
  // Primary key
  id: string;

  // Core event metadata (snake_case matching D1)
  user_id: string;
  source_app: string;
  event_type: string;
  timestamp_ms: number;
  received_at_ms: number;

  // Privacy & consent
  privacy_scope: 'private' | 'social' | 'public';
  consent_scope: string | null;
  consent_version: string;

  // Provenance & tracing
  contracts_version: string | null;
  trace_id: string | null;
  payload_sha256: string | null;

  // Payload & blobs
  payload_json: string;
  payload_preview_json: string | null;
  blob_refs_json: string | null;
  client_meta_json: string | null;

  // Deduplication
  idempotency_key: string;

  // General status
  status: string | null;

  // Convex delivery (actual columns from 0001)
  delivered_to_convex_at_ms: number | null;
  convex_delivery_status: 'pending' | 'ok' | 'failed';
  convex_delivery_error: string | null;

  // Social delivery (actual columns from 0001)
  social_forwarded_at_ms: number | null;
  social_delivery_status: 'pending' | 'ok' | 'failed' | 'skipped';
  social_delivery_error: string | null;

  // Fanout tracking (from 0003)
  fanoutDestinations: string | null;
  fanoutCompletedAt: string | null;
}

export interface ConsentStateRow {
  user_id: string;
  consent_version: string;
  scopes_json: string;
  ultra_consent_ack: number;
  updated_at_ms: number;
}

export interface RateLimitRow {
  key: string;
  windowStartMs: number;
  count: number;
  lastUpdatedMs: number;
}

export interface IdempotencyKeyRow {
  key: string;
  userId: string;
  eventId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface DeliveryLogRow {
  id: number;
  event_id: string;
  destination: string;
  status: 'pending' | 'success' | 'failed';
  attempt_number: number;
  response_code: number | null;
  response_body: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at_ms: number;
}

// Parsed types (after JSON parsing)

export interface ParsedEvent extends Omit<EventRow, 'payload_json' | 'blob_refs_json' | 'client_meta_json' | 'fanoutDestinations' | 'fanoutCompletedAt'> {
  payload: Record<string, unknown>;
  blobRefs: BlobRef[];
  clientMeta: ClientMeta | null;
  fanoutDestinations: string[];
  fanoutCompletedAt: Record<string, number>;
}

export interface BlobRef {
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
}

export interface ClientMeta {
  isForeground: boolean;
  hasIndicator: boolean;
  capturedAt: string;
  appState?: string;
  batteryLevel?: number;
  networkType?: string;
}

export interface ConsentState {
  userId: string;
  consentVersion: string;
  scopes: Record<string, boolean>;
  ultraConsentAcknowledged: boolean;
  updatedAtMs: number;
}

/**
 * UserConsentsRow - bulk consent storage (Window 25)
 * Maps to the user_consents table.
 */
export interface UserConsentsRow {
  userId: string;
  consentVersion: string;
  scopesJson: string;           // JSON object: { "scope.key": true/false, ... }
  updatedAtMs: number;
}

/**
 * EventBlobRow - blob reference linking events to R2 objects
 * Maps to the event_blobs table.
 */
export interface EventBlobRow {
  id: number;
  eventId: string;
  r2Key: string;
  contentType: string;
  sizeBytes: number;
  createdAtMs: number;
}

/**
 * ProfileSnapshotRow - questionnaire snapshot from iOS apps
 * Maps to the profile_snapshots table.
 */
export interface ProfileSnapshotRow {
  userId: string;
  questionnaireId: string;
  questionnaireVersion: number;
  answersJson: string;          // JSON object of questionId -> AnswerValue
  answerCount: number;
  sourceApp: string;
  updatedAtMs: number;
  createdAtMs: number;
  eventId: string | null;
}

/**
 * Parsed types for ProfileSnapshot (after JSON parsing)
 */
export interface ParsedProfileSnapshot extends Omit<ProfileSnapshotRow, 'answersJson'> {
  answers: Record<string, unknown>;
}
