/**
 * Environment bindings for edge-gateway-worker
 */

interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace
  KV: KVNamespace;

  // R2 Bucket
  BLOBS: R2Bucket;

  // Queue (must match wrangler.toml binding name)
  FANOUT_QUEUE: Queue;

  // Admin API key
  ADMIN_API_KEY: string;

  // Environment identifier
  ENVIRONMENT?: 'local' | 'staging' | 'production';

  // Contracts version
  CONTRACTS_VERSION?: string;

  // Twilio secrets
  TWILIO_ACCOUNT_SID: string;
  TWILIO_API_KEY_SID: string;
  TWILIO_API_KEY_SECRET: string;
  TWILIO_CONVERSATIONS_SERVICE_SID: string;
  TWILIO_TWIML_APP_SID: string;
  TWILIO_PUSH_CREDENTIAL_SID?: string;
  TWILIO_PHONE_NUMBER?: string;

  // Clerk
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
}
