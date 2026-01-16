/**
 * R2 Presigned URL Generation (SigV4)
 * Window 24: S3-compatible presigned PUT URLs for direct R2 uploads
 *
 * This allows iOS to upload directly to R2 without proxying through the Worker.
 * Benefits:
 * - No request size limits from Worker
 * - Lower latency (direct to R2)
 * - Lower cost (no Worker invocation for upload)
 *
 * Requirements:
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_BUCKET_NAME: R2 bucket name
 * - R2_S3_ACCESS_KEY_ID: R2 S3 API access key
 * - R2_S3_SECRET_ACCESS_KEY: R2 S3 API secret key
 */

// ============================================================================
// Types
// ============================================================================

export interface PresignArgs {
  /** Cloudflare account ID */
  accountId: string;
  /** R2 bucket name */
  bucket: string;
  /** Object key (path within bucket) */
  key: string;
  /** Content-Type header value */
  contentType: string;
  /** URL expiration in seconds (e.g., 600 for 10 minutes) */
  expiresSeconds: number;
  /** R2 S3 API access key ID */
  accessKeyId: string;
  /** R2 S3 API secret access key */
  secretAccessKey: string;
}

export interface PresignResult {
  /** Presigned PUT URL for direct upload */
  uploadUrl: string;
  /** Expiration timestamp in milliseconds */
  expiresAtMs: number;
  /** Headers the client must include in the PUT request */
  headers: Record<string, string>;
}

// ============================================================================
// Main Presign Function
// ============================================================================

/**
 * Generate an S3-compatible presigned PUT URL for R2.
 *
 * The client can PUT directly to this URL with the file body.
 * The URL is valid for `expiresSeconds` seconds.
 *
 * IMPORTANT: The client MUST include the same Content-Type header
 * that was used when generating the presigned URL.
 */
export async function presignR2PutUrl(args: PresignArgs): Promise<PresignResult> {
  const method = "PUT";
  const service = "s3";
  const region = "auto"; // Cloudflare R2 accepts "auto"

  const now = new Date();
  const amzDate = toAmzDate(now); // YYYYMMDD'T'HHMMSS'Z'
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

  // R2 S3-compatible endpoint
  const host = `${args.accountId}.r2.cloudflarestorage.com`;

  // Path-style URL: /<bucket>/<key>
  const canonicalUri = `/${encodePathSegment(args.bucket)}/${encodeKey(args.key)}`;

  // Required signed headers for PUT
  const signedHeaders = "content-type;host";
  const canonicalHeaders =
    `content-type:${args.contentType}\n` +
    `host:${host}\n`;

  // Credential scope
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const algorithm = "AWS4-HMAC-SHA256";

  // For presigned URLs, payload is unsigned (client sends actual content)
  const payloadHash = "UNSIGNED-PAYLOAD";

  // Query parameters for presigned URL
  const query: Record<string, string> = {
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": `${args.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(args.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };

  const canonicalQueryString = toCanonicalQueryString(query);

  // Build canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // Hash the canonical request
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  // Build string to sign
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  // Derive signing key
  const signingKey = await getSignatureKey(
    args.secretAccessKey,
    dateStamp,
    region,
    service
  );

  // Sign the string
  const signature = await hmacHex(signingKey, stringToSign);

  // Build final URL with signature
  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const uploadUrl = `https://${host}${canonicalUri}?${finalQuery}`;

  return {
    uploadUrl,
    expiresAtMs: now.getTime() + args.expiresSeconds * 1000,
    headers: {
      "Content-Type": args.contentType,
    },
  };
}

// ============================================================================
// Helper: Generate Presigned GET URL (for blob retrieval)
// ============================================================================

/**
 * Generate an S3-compatible presigned GET URL for R2.
 * Useful for generating temporary download links.
 */
export async function presignR2GetUrl(args: Omit<PresignArgs, "contentType">): Promise<PresignResult> {
  const method = "GET";
  const service = "s3";
  const region = "auto";

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const host = `${args.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePathSegment(args.bucket)}/${encodeKey(args.key)}`;

  const signedHeaders = "host";
  const canonicalHeaders = `host:${host}\n`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const algorithm = "AWS4-HMAC-SHA256";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const query: Record<string, string> = {
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": `${args.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(args.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };

  const canonicalQueryString = toCanonicalQueryString(query);

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const signingKey = await getSignatureKey(
    args.secretAccessKey,
    dateStamp,
    region,
    service
  );

  const signature = await hmacHex(signingKey, stringToSign);

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const downloadUrl = `https://${host}${canonicalUri}?${finalQuery}`;

  return {
    uploadUrl: downloadUrl, // Reusing the same structure
    expiresAtMs: now.getTime() + args.expiresSeconds * 1000,
    headers: {},
  };
}

// ============================================================================
// Cryptographic Helpers
// ============================================================================

/**
 * Format date as AWS-style: YYYYMMDD'T'HHMMSS'Z'
 */
function toAmzDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Encode a single path segment (bucket name).
 */
function encodePathSegment(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Encode the object key, preserving forward slashes.
 */
function encodeKey(key: string): string {
  // Encode each segment, keeping slashes
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Build canonical query string (sorted, encoded).
 */
function toCanonicalQueryString(q: Record<string, string>): string {
  const pairs = Object.entries(q)
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * Compute SHA-256 hash and return as hex string.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(hash);
}

/**
 * Compute HMAC-SHA256 and return raw ArrayBuffer.
 */
async function hmacRaw(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(msg)
  );
}

/**
 * Compute HMAC-SHA256 and return as hex string.
 */
async function hmacHex(key: ArrayBuffer, msg: string): Promise<string> {
  const sig = await hmacRaw(key, msg);
  return bufToHex(sig);
}

/**
 * Convert ArrayBuffer to hex string.
 */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Derive the SigV4 signing key.
 *
 * kSecret = "AWS4" + secretAccessKey
 * kDate = HMAC(kSecret, dateStamp)
 * kRegion = HMAC(kDate, region)
 * kService = HMAC(kRegion, service)
 * kSigning = HMAC(kService, "aws4_request")
 */
async function getSignatureKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode("AWS4" + secretAccessKey);
  const kDate = await hmacRaw(kSecret.buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  const kSigning = await hmacRaw(kService, "aws4_request");
  return kSigning;
}

// ============================================================================
// Convenience Function for Worker Usage
// ============================================================================

/**
 * Create a presigned PUT URL using environment bindings.
 * This is the function to call from your route handlers.
 */
export async function createPresignedPutUrl(
  env: {
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    R2_S3_ACCESS_KEY_ID: string;
    R2_S3_SECRET_ACCESS_KEY: string;
  },
  key: string,
  contentType: string,
  expiresSeconds: number = 600
): Promise<PresignResult> {
  return presignR2PutUrl({
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET_NAME,
    key,
    contentType,
    expiresSeconds,
    accessKeyId: env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
  });
}

/**
 * Create a presigned GET URL using environment bindings.
 */
export async function createPresignedGetUrl(
  env: {
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    R2_S3_ACCESS_KEY_ID: string;
    R2_S3_SECRET_ACCESS_KEY: string;
  },
  key: string,
  expiresSeconds: number = 600
): Promise<PresignResult> {
  return presignR2GetUrl({
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET_NAME,
    key,
    expiresSeconds,
    accessKeyId: env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
  });
}
