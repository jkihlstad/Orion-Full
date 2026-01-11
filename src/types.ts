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
  payload: z.record(z.any()),
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

export const SignedUploadRequest = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type SignedUploadRequestT = z.infer<typeof SignedUploadRequest>;
