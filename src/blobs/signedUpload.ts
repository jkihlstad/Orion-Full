import { Env } from "../env";
import { json } from "../utils/respond";
import { SignedUploadRequest } from "../types";

/**
 * Generate a signed upload URL for R2
 */
export async function handleSignedUpload(req: Request, env: Env, userId: string): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = SignedUploadRequest.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_request", details: parsed.error.issues }, 400);
  }

  const { filename, contentType, sizeBytes } = parsed.data;

  // Generate unique R2 key
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const ext = filename.split(".").pop() || "bin";
  const r2Key = `uploads/${userId}/${timestamp}-${rand}.${ext}`;

  // Size limit (100MB)
  if (sizeBytes > 100 * 1024 * 1024) {
    return json({ ok: false, error: "file_too_large", maxBytes: 100 * 1024 * 1024 }, 400);
  }

  // Generate presigned URL (R2 multipart or direct PUT)
  // Note: CF Workers R2 binding doesn't have createPresignedPost
  // For now, return a direct upload endpoint the client can PUT to
  // In production, use R2 signed URLs via S3 API compatibility

  return json({
    ok: true,
    r2Key,
    uploadUrl: `/v1/blobs/upload/${r2Key}`,
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(sizeBytes),
    },
    expiresIn: 3600,
  });
}

/**
 * Handle direct blob upload to R2
 */
export async function handleBlobUpload(req: Request, env: Env, userId: string, r2Key: string): Promise<Response> {
  // Verify the key belongs to this user
  if (!r2Key.startsWith(`uploads/${userId}/`)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  const body = await req.arrayBuffer();

  await env.BLOBS.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { userId, uploadedAt: new Date().toISOString() },
  });

  return json({
    ok: true,
    r2Key,
    sizeBytes: body.byteLength,
    contentType,
  });
}
