/**
 * /v1/auth/whoami endpoint
 *
 * Returns information about the authenticated user from the JWT claims.
 * Useful for debugging authentication issues and verifying identity
 * consistency across Orion Suite applications.
 *
 * Response:
 * {
 *   "userId": "user_xxx",
 *   "issuer": "https://clerk.orion.app",
 *   "audience": null | "...",
 *   "exp": 1234567890
 * }
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/whoami" });

/**
 * JWT payload structure from Clerk
 */
interface ClerkJwtPayload {
  sub: string;        // User ID
  iss: string;        // Issuer
  aud?: string;       // Audience (optional)
  azp?: string;       // Authorized party (optional)
  exp: number;        // Expiration timestamp
  iat: number;        // Issued at timestamp
  nbf?: number;       // Not before timestamp
}

/**
 * Base64URL decode helper
 */
function base64UrlDecode(input: string): string {
  // Replace URL-safe characters
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += "=".repeat(4 - padding);
  }

  // Decode
  const binary = atob(base64);
  return binary;
}

/**
 * Extract JWT payload without full verification
 * (Verification already done by verifyClerkJWT in the route handler)
 */
function extractJwtPayload(token: string): ClerkJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payloadJson = base64UrlDecode(parts[1]);
    return JSON.parse(payloadJson) as ClerkJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Handle GET /v1/auth/whoami
 *
 * Returns the authenticated user's identity information extracted from the JWT.
 * The JWT has already been verified by the time this handler is called.
 *
 * @param req - The incoming request
 * @param env - Cloudflare Worker environment bindings
 * @param userId - The verified userId from verifyClerkJWT
 * @returns Response with identity information
 */
export async function handleWhoami(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    // Extract the JWT from Authorization header to get additional claims
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      // Shouldn't happen since verifyClerkJWT would have failed, but handle gracefully
      return json(
        {
          userId,
          issuer: null,
          audience: null,
          exp: null,
        },
        200
      );
    }

    // Extract payload to get additional claims
    const payload = extractJwtPayload(token);

    if (!payload) {
      // Return what we have (userId from verification)
      return json(
        {
          userId,
          issuer: null,
          audience: null,
          exp: null,
        },
        200
      );
    }

    // Return identity information
    return json(
      {
        userId: payload.sub,
        issuer: payload.iss,
        audience: payload.aud ?? null,
        exp: payload.exp,
      },
      200
    );
  } catch (error) {
    logger.error("Whoami endpoint error", error instanceof Error ? error : null, { userId });
    return new Response(JSON.stringify({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
