/**
 * Blob Upload Handlers
 * Window 23 + Window 26: Safe R2 paths + registry-driven enforcement + consent checks
 *
 * Flow:
 *   1. iOS calls POST /v1/blobs/signUpload with purpose, contentType, sizeBytes
 *   2. Worker validates request, checks consent, generates safe R2 key, returns upload URL
 *   3. iOS uploads directly to R2 via PUT /v1/blobs/upload/{r2Key}
 *   4. iOS emits event with blobRefs[] referencing the uploaded blob
 *
 * Safety rules (Window 23):
 *   - Purpose whitelist (only known purposes allowed)
 *   - Content type restrictions per purpose
 *   - Size caps per purpose
 *   - Safe R2 key generation (userId from auth, UUID, date-based paths)
 *   - Never trust client-supplied keys or paths
 *
 * Window 26 Registry-Driven Enforcement:
 *   - All purpose policies come from registry.json blobPurposes
 *   - Consent scopes are enforced per purpose (requiredScopes)
 *   - No hardcoded rules in the worker
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { SignedUploadRequest } from "../types";
import {
  validateBlobRequest,
  getErrorStatusCode,
  deriveExtFromContentType,
} from "../validation/validateBlob";
import { createPresignedPutUrl } from "../storage/r2Presign";
import { getBlobPurposeScopes } from "../validation/registry";
import { d1GetConsent } from "../storage/d1";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "blobs/signedUpload" });

// ============================================================================
// Constants
// ============================================================================

/** Signed URL expiration in seconds */
const SIGNED_URL_EXPIRES_SECONDS = 10 * 60; // 10 minutes

/**
 * Upload mode configuration.
 *
 * Option A (PRESIGNED): iOS uploads directly to R2 via presigned URL
 *   - Recommended for production
 *   - No request size limits from Worker
 *   - Lower latency and cost
 *
 * Option B (PROXY): iOS uploads through Worker endpoint
 *   - Simpler setup (no S3 credentials needed)
 *   - Good for development/testing
 *   - Subject to Worker request size limits
 */
type UploadMode = "presigned" | "proxy";

/**
 * Determine upload mode based on environment.
 * Uses presigned URLs if R2 S3 credentials are configured.
 */
function getUploadMode(env: Env): UploadMode {
  if (
    env.R2_ACCOUNT_ID &&
    env.R2_BUCKET_NAME &&
    env.R2_S3_ACCESS_KEY_ID &&
    env.R2_S3_SECRET_ACCESS_KEY
  ) {
    return "presigned";
  }
  return "proxy";
}

// ============================================================================
// POST /v1/blobs/signUpload
// ============================================================================

/**
 * Generate a signed upload URL for R2.
 * Validates purpose, content type, and size against policy.
 */
export async function handleSignedUpload(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // Zod schema validation (basic structure)
  const zodResult = SignedUploadRequest.safeParse(body);
  if (!zodResult.success) {
    return json(
      { ok: false, error: "invalid_request", details: zodResult.error.issues },
      400
    );
  }

  // Purpose-based validation (Window 23 safety rules + Window 26 registry)
  const validation = validateBlobRequest(zodResult.data);
  if (!validation.ok) {
    const statusCode = getErrorStatusCode(validation.code);
    return json(
      {
        ok: false,
        error: validation.code.toLowerCase(),
        details: validation.errors,
      },
      statusCode
    );
  }

  const { purpose, contentType, sizeBytes, sha256Base64, extension } = validation.value;

  // ========================================================================
  // Window 26: Consent enforcement for blob purposes
  // Check that user has granted all required scopes for this purpose
  // ========================================================================
  const requiredScopes = getBlobPurposeScopes(purpose);
  if (requiredScopes.length > 0) {
    for (const scope of requiredScopes) {
      const hasConsent = await d1GetConsent(env, userId, scope);
      if (!hasConsent) {
        return json(
          {
            ok: false,
            error: "consent_required",
            scope,
            message: `Blob purpose "${purpose}" requires consent scope "${scope}"`,
          },
          403
        );
      }
    }
  }

  // ========================================================================
  // Generate safe R2 key
  // Format: users/<userId>/uploads/<yyyy>/<mm>/<uuid>.<ext>
  //
  // Safety:
  // - userId comes from authenticated Clerk JWT (cannot be spoofed)
  // - UUID is server-generated (prevents overwrites)
  // - Extension derived from contentType (not client filename)
  // - Date-based path for organization and lifecycle management
  // ========================================================================
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();

  const r2Key = `users/${userId}/uploads/${yyyy}/${mm}/${uuid}.${extension}`;

  // Calculate expiration
  const expiresAtMs = Date.now() + SIGNED_URL_EXPIRES_SECONDS * 1000;

  // ========================================================================
  // Generate upload URL
  //
  // Option A (PRESIGNED): Direct R2 upload via S3-compatible presigned URL
  //   - Client PUTs directly to R2
  //   - No request size limits from Worker
  //   - Recommended for production
  //
  // Option B (PROXY): Worker-proxied upload
  //   - Client PUTs to /v1/blobs/upload/{r2Key}
  //   - Worker validates and forwards to R2
  //   - Simpler, good for development
  // ========================================================================
  const uploadMode = getUploadMode(env);

  let uploadUrl: string;
  let headers: Record<string, string>;

  if (uploadMode === "presigned") {
    // Option A: Generate presigned URL for direct R2 upload
    try {
      const presigned = await createPresignedPutUrl(
        env,
        r2Key,
        contentType,
        SIGNED_URL_EXPIRES_SECONDS
      );
      uploadUrl = presigned.uploadUrl;
      headers = presigned.headers;
    } catch (e: unknown) {
      // Fallback to proxy mode if presign fails
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.warn("Presign failed, falling back to proxy", { error: errorMsg, r2Key, userId });
      uploadUrl = `/v1/blobs/upload/${r2Key}`;
      headers = { "Content-Type": contentType };
    }
  } else {
    // Option B: Use proxy upload endpoint
    uploadUrl = `/v1/blobs/upload/${r2Key}`;
    headers = { "Content-Type": contentType };
  }

  // Include content length if known
  if (sizeBytes > 0) {
    headers["Content-Length"] = String(sizeBytes);
  }

  // Include SHA256 header if provided (for integrity verification)
  if (sha256Base64) {
    headers["X-Content-SHA256"] = sha256Base64;
  }

  return json({
    ok: true,
    r2Key,
    uploadUrl,
    headers,
    expiresAtMs,
    purpose, // Echo back for client reference
    uploadMode, // Indicate which mode was used
  });
}

// ============================================================================
// PUT /v1/blobs/upload/{r2Key}
// ============================================================================

/**
 * Handle direct blob upload to R2.
 * Validates that the r2Key belongs to the authenticated user.
 */
export async function handleBlobUpload(
  req: Request,
  env: Env,
  userId: string,
  r2Key: string
): Promise<Response> {
  // ========================================================================
  // Security: Verify the key belongs to this user
  // This prevents users from overwriting other users' files
  // ========================================================================
  const expectedPrefix = `users/${userId}/uploads/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    return json(
      { ok: false, error: "forbidden", message: "r2Key does not belong to user" },
      403
    );
  }

  // Validate key format (prevent path traversal)
  if (r2Key.includes("..") || r2Key.includes("//")) {
    return json(
      { ok: false, error: "invalid_key", message: "invalid r2Key format" },
      400
    );
  }

  // Get content type from request
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";

  // Validate content type is allowed (derive from key extension)
  const keyExt = r2Key.split(".").pop()?.toLowerCase();
  const expectedExt = deriveExtFromContentType(contentType);
  if (expectedExt && keyExt !== expectedExt) {
    return json(
      {
        ok: false,
        error: "content_type_mismatch",
        message: `Content-Type ${contentType} does not match key extension .${keyExt}`,
      },
      400
    );
  }

  // Read body
  const body = await req.arrayBuffer();

  // Optional: Verify SHA256 if provided
  const expectedSha256 = req.headers.get("X-Content-SHA256");
  if (expectedSha256) {
    const actualHash = await computeSha256Base64(body);
    if (actualHash !== expectedSha256) {
      return json(
        {
          ok: false,
          error: "integrity_check_failed",
          message: "SHA256 hash mismatch",
        },
        400
      );
    }
  }

  // Store in R2 with metadata
  try {
    await env.BLOBS.put(r2Key, body, {
      httpMetadata: { contentType },
      customMetadata: {
        userId,
        uploadedAt: new Date().toISOString(),
        sizeBytes: String(body.byteLength),
      },
    });
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : "R2 put failed";
    return json(
      { ok: false, error: "upload_failed", message: errorMsg },
      500
    );
  }

  return json({
    ok: true,
    r2Key,
    sizeBytes: body.byteLength,
    contentType,
  });
}

// ============================================================================
// GET /v1/blobs/{r2Key} (optional: retrieve blob)
// ============================================================================

/**
 * Retrieve a blob from R2.
 * Only allows access to user's own blobs.
 */
export async function handleBlobGet(
  req: Request,
  env: Env,
  userId: string,
  r2Key: string
): Promise<Response> {
  // Security: Verify ownership
  const expectedPrefix = `users/${userId}/uploads/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    return json(
      { ok: false, error: "forbidden", message: "r2Key does not belong to user" },
      403
    );
  }

  // Fetch from R2
  const object = await env.BLOBS.get(r2Key);
  if (!object) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  // Return blob with proper content type
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.etag);

  return new Response(object.body, { headers });
}

// ============================================================================
// DELETE /v1/blobs/{r2Key} (optional: delete blob)
// ============================================================================

/**
 * Delete a blob from R2.
 * Only allows deletion of user's own blobs.
 */
export async function handleBlobDelete(
  req: Request,
  env: Env,
  userId: string,
  r2Key: string
): Promise<Response> {
  // Security: Verify ownership
  const expectedPrefix = `users/${userId}/uploads/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    return json(
      { ok: false, error: "forbidden", message: "r2Key does not belong to user" },
      403
    );
  }

  // Delete from R2
  await env.BLOBS.delete(r2Key);

  return json({ ok: true, r2Key, deleted: true });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute SHA256 hash of data and return as base64.
 */
async function computeSha256Base64(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = "";
  for (let i = 0; i < hashArray.byteLength; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary);
}
