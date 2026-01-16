/**
 * Environment bindings for Orion Edge Gateway
 */
export interface Env {
  // Environment name (matches wrangler.toml ENVIRONMENT var)
  ENVIRONMENT: string;

  // Storage bindings
  DB: D1Database;
  BLOBS: R2Bucket;
  KV: KVNamespace;

  // Queue binding (matches wrangler.toml binding name)
  FANOUT_QUEUE: Queue;

  // Secrets / vars
  ADMIN_API_KEY?: string;
  GATEWAY_INTERNAL_KEY?: string;
  CLERK_ISSUER: string;
  CLERK_JWKS_URL: string;

  // Optional: request signature
  REQUEST_HMAC_SECRET?: string;

  // HMAC shared secret for Convex (Window C)
  ORION_HMAC_SHARED_SECRET?: string;

  // Backend fanout endpoints
  CONVEX_INGEST_URL: string;
  BRAIN_QUERY_URL?: string;
  BRAIN_INGEST_URL?: string;
  BRAIN_ANSWER_URL?: string; // Window G: brain /v1/answer endpoint
  SOCIAL_SIGNAL_URL?: string;

  // Window H.9: Brain service auth (HMAC)
  BRAIN_SERVICE_SHARED_SECRET?: string; // HMAC shared secret for gateway ↔ brain auth
  BRAIN_BASE_URL?: string; // Base URL for brain-platform (e.g., https://brain-platform.workers.dev)

  // Admin token for gateway admin endpoints
  GATEWAY_ADMIN_TOKEN?: string;

  // Window E: Ingestion store proxy
  INGESTION_URL?: string; // URL for convex-ingestion-store
  INGESTION_SERVICE_TOKEN?: string; // X-Orion-Service-Token for ingestion auth
  CALENDAR_API_URL?: string;

  // R2 S3-compatible API credentials (Window 24)
  // Used for generating presigned upload URLs
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_S3_ACCESS_KEY_ID: string;
  R2_S3_SECRET_ACCESS_KEY: string;

  // Twilio
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY?: string;
  TWILIO_API_SECRET?: string;
  TWILIO_API_KEY_SID?: string;        // Alias for API key ID
  TWILIO_API_KEY_SECRET?: string;     // Alias for API key secret
  TWILIO_AUTH_TOKEN?: string;         // Auth token for webhook validation
  TWILIO_CONVERSATIONS_SERVICE_SID?: string;
  TWILIO_TWIML_APP_SID?: string;
  TWILIO_PUSH_CREDENTIAL_SID?: string;
  TWILIO_WEBHOOK_BYPASS_KEY?: string; // Dev bypass for webhook validation

  // Ops proxy endpoints (Window 111)
  CONVEX_OPS_BASE_URL?: string;
  CONVEX_OPS_KEY?: string;
  BRAIN_OPS_BASE_URL?: string;
  BRAIN_OPS_KEY?: string;
  NEO4J_OPS_BASE_URL?: string;
  NEO4J_OPS_KEY?: string;
}

export function must<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null || (typeof v === "string" && v.length === 0)) {
    throw new Error(msg);
  }
  return v;
}
