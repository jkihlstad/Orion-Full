/**
 * Brain Platform Proxy with HMAC Service Auth
 *
 * Window H.9.7: Secure proxy to brain-platform using HMAC signing.
 *
 * Flow:
 * 1. Gateway verifies user via Clerk JWT
 * 2. Gateway adds x-orion-user-id header
 * 3. Gateway signs request with HMAC for brain to verify
 * 4. Brain trusts request came from gateway
 */

import type { Env } from "../env";

/**
 * Proxy a request to brain-platform with HMAC service auth.
 *
 * The gateway adds:
 * - x-orion-user-id: The authenticated user's Clerk ID
 * - x-orion-ts: Current timestamp for replay protection
 * - x-orion-sig: HMAC-SHA256 signature of "{ts}.{userId}.{path}"
 *
 * @param req - Original request
 * @param env - Environment bindings
 * @param userId - Authenticated user ID (from Clerk JWT)
 * @param path - Target path on brain-platform (e.g., "/v1/brain/search")
 * @returns Proxied response from brain-platform
 */
export async function proxyToBrain(
  req: Request,
  env: Env,
  userId: string,
  path: string
): Promise<Response> {
  // Check brain is configured
  if (!env.BRAIN_BASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "BRAIN_BASE_URL not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!env.BRAIN_SERVICE_SHARED_SECRET) {
    return new Response(
      JSON.stringify({ ok: false, error: "BRAIN_SERVICE_SHARED_SECRET not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Build target URL
  const url = new URL(env.BRAIN_BASE_URL);
  url.pathname = path;

  // Preserve querystring if present on incoming request and path didn't include it
  const inUrl = new URL(req.url);
  if (!path.includes("?") && inUrl.search) {
    url.search = inUrl.search;
  }

  // Get request body (for non-GET/HEAD methods)
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  // Generate HMAC signature
  const ts = Date.now().toString();
  const signature = await hmacSign(
    env.BRAIN_SERVICE_SHARED_SECRET,
    `${ts}.${userId}.${path}`
  );

  // Build headers
  const headers = new Headers(req.headers);
  headers.set("x-orion-user-id", userId);
  headers.set("x-orion-ts", ts);
  headers.set("x-orion-sig", signature);

  // Remove user's Bearer token - brain trusts gateway signature instead
  headers.delete("authorization");

  // Forward to brain
  const brainResp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
  });

  // Pass through response (preserve status, headers, body)
  return new Response(brainResp.body, {
    status: brainResp.status,
    headers: brainResp.headers,
  });
}

/**
 * Proxy to brain with fallback to existing X-Gateway-Key auth.
 *
 * Uses HMAC auth if BRAIN_SERVICE_SHARED_SECRET is configured,
 * otherwise falls back to X-Gateway-Key header.
 *
 * @param req - Original request
 * @param env - Environment bindings
 * @param userId - Authenticated user ID
 * @param path - Target path on brain-platform
 * @returns Proxied response
 */
export async function proxyToBrainWithFallback(
  req: Request,
  env: Env,
  userId: string,
  path: string
): Promise<Response> {
  // Use HMAC auth if configured
  if (env.BRAIN_SERVICE_SHARED_SECRET && env.BRAIN_BASE_URL) {
    return proxyToBrain(req, env, userId, path);
  }

  // Fallback to existing X-Gateway-Key pattern
  const targetUrl = env.BRAIN_ANSWER_URL || env.BRAIN_QUERY_URL;
  if (!targetUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "Brain not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(targetUrl);
  url.pathname = path;

  const inUrl = new URL(req.url);
  if (!path.includes("?") && inUrl.search) {
    url.search = inUrl.search;
  }

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  const headers = new Headers(req.headers);
  headers.set("X-Gateway-Key", env.GATEWAY_INTERNAL_KEY || "");
  headers.delete("authorization");

  const brainResp = await fetch(url.toString(), {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
  });

  return new Response(brainResp.body, {
    status: brainResp.status,
    headers: brainResp.headers,
  });
}

// =============================================================================
// HMAC Utilities
// =============================================================================

/**
 * Generate HMAC-SHA256 signature using Web Crypto API.
 *
 * @param secret - Shared secret
 * @param message - Message to sign
 * @returns Base64URL-encoded signature
 */
async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return base64UrlEncode(new Uint8Array(sig));
}

/**
 * Encode bytes to Base64URL (no padding).
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
