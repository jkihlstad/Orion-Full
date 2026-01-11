/**
 * Environment bindings for Orion Edge Gateway
 */
export interface Env {
  ENV: string;

  // Storage bindings
  DB: D1Database;
  BLOBS: R2Bucket;
  KV: KVNamespace;

  // Queue binding
  FANOUT_QUEUE: Queue;

  // Secrets / vars
  ADMIN_API_KEY?: string;
  GATEWAY_INTERNAL_KEY?: string;
  CLERK_ISSUER: string;
  CLERK_JWKS_URL: string;

  // Optional: request signature
  REQUEST_HMAC_SECRET?: string;

  // Backend fanout endpoints
  CONVEX_INGEST_URL: string;
  BRAIN_QUERY_URL?: string;
  SOCIAL_SIGNAL_URL?: string;
  CALENDAR_API_URL?: string;

  // Twilio
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY?: string;
  TWILIO_API_SECRET?: string;
  TWILIO_CONVERSATIONS_SERVICE_SID?: string;
  TWILIO_TWIML_APP_SID?: string;
}

export function must<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null || (typeof v === "string" && v.length === 0)) {
    throw new Error(msg);
  }
  return v;
}
