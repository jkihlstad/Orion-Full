import { z } from "zod";

/**
 * Canonical types for Orion Edge Gateway
 * Aligned with suite-contracts
 */

export const PrivacyScope = z.enum(["private", "social", "public"]);
export type PrivacyScopeT = z.infer<typeof PrivacyScope>;

export const SourceApp = z.enum([
  "finance",
  "browser",
  "dating",
  "social",
  "tasks",
  "calendar",
  "email",
  "communication",
  "sleep",
  "workouts",
  "nutrition",
  "dashboard",
]);
export type SourceAppT = z.infer<typeof SourceApp>;

export const BlobRef = z.object({
  r2Key: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type BlobRefT = z.infer<typeof BlobRef>;

export const EventEnvelope = z.object({
  eventId: z.string().min(8),
  userId: z.string().min(2), // clerkUserId
  sourceApp: SourceApp,
  eventType: z.string().min(1),
  timestamp: z.number().int().nonnegative(), // ms
  privacyScope: PrivacyScope,
  consentScope: z.string().optional(), // from registry.json
  consentVersion: z.string().min(1),
  idempotencyKey: z.string().min(8),
  payload: z.record(z.unknown()),
  blobRefs: z.array(BlobRef).optional(),
});
export type EventEnvelopeT = z.infer<typeof EventEnvelope>;

export const BatchIngestRequest = z.object({
  events: z.array(EventEnvelope).min(1).max(100),
});
export type BatchIngestRequestT = z.infer<typeof BatchIngestRequest>;

export const BrainQueryRequest = z.object({
  query: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  since: z.number().int().optional(),
  until: z.number().int().optional(),
  granularity: z.enum(["summary", "detailed"]).optional(),
});
export type BrainQueryRequestT = z.infer<typeof BrainQueryRequest>;

export const ConsentSetRequest = z.object({
  scope: z.string().min(1),
  enabled: z.boolean(),
});
export type ConsentSetRequestT = z.infer<typeof ConsentSetRequest>;

/**
 * Signed upload request (Window 23 enhanced)
 * Purpose-based validation with content type and size restrictions
 */
export const SignedUploadRequest = z.object({
  /** Purpose of the upload (e.g., "finance.receipt", "browser.screenshot") */
  purpose: z.string().min(1),
  /** MIME content type (must be allowed for the purpose) */
  contentType: z.string().min(1),
  /** File size in bytes (must be within purpose limits) */
  sizeBytes: z.number().int().positive(),
  /** Optional SHA256 hash for integrity verification */
  sha256Base64: z.string().optional(),
  /** Optional original filename (used for reference only, not path) */
  fileName: z.string().optional(),
});
export type SignedUploadRequestT = z.infer<typeof SignedUploadRequest>;

/**
 * Signed upload response
 */
export const SignedUploadResponse = z.object({
  /** R2 object key where the file will be stored */
  r2Key: z.string(),
  /** Pre-signed PUT URL for uploading directly to R2 */
  uploadUrl: z.string(),
  /** Headers to include in the PUT request */
  headers: z.record(z.string()),
  /** Expiration timestamp in milliseconds */
  expiresAtMs: z.number().int(),
});
export type SignedUploadResponseT = z.infer<typeof SignedUploadResponse>;

// =============================================================================
// Window H.9: Insert Result Types (for emit/insertBatch responses)
// =============================================================================

/**
 * Result of inserting a single event.
 * Used by /v1/events/emit and /v1/events/insertBatch endpoints.
 */
export type InsertResult =
  | { ok: true; id: string; deduped: boolean }
  | { ok: false; error: string };

/**
 * Lightweight event envelope for H.9 emit/insertBatch endpoints.
 * This is a simpler format that doesn't require all fields upfront.
 * The gateway generates missing fields (id, timestamp if not provided).
 */
export const LiteEventEnvelope = z.object({
  id: z.string().optional(), // Optional; gateway can generate
  eventType: z.string().min(1),
  privacyScope: PrivacyScope,
  tsMs: z.number().int().positive(), // Client timestamp
  dedupeKey: z.string().optional(), // Optional idempotency key
  payload: z.record(z.unknown()),
  payloadPreview: z.record(z.unknown()).optional(),
});
export type LiteEventEnvelopeT = z.infer<typeof LiteEventEnvelope>;
