/**
 * Service-to-service authentication (Window E)
 *
 * Used for internal service endpoints that require X-Orion-Service-Token
 * instead of user JWT authentication.
 */

import { json } from "../utils/respond";

/**
 * Validate service token from X-Orion-Service-Token header.
 * Throws a Response(401) if invalid.
 *
 * @param req - Incoming request
 * @param expected - Expected token value from environment
 */
export function requireServiceToken(req: Request, expected: string): void {
  const token = req.headers.get("X-Orion-Service-Token") || "";
  if (!token || token !== expected) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Validate service token and return result (non-throwing version).
 * Useful when you want to handle auth failure differently.
 *
 * @param req - Incoming request
 * @param expected - Expected token value from environment
 * @returns Object with ok status and optional error
 */
export function validateServiceToken(
  req: Request,
  expected: string
): { ok: true } | { ok: false; error: string } {
  const token = req.headers.get("X-Orion-Service-Token") || "";
  if (!token) {
    return { ok: false, error: "Missing X-Orion-Service-Token header" };
  }
  if (token !== expected) {
    return { ok: false, error: "Invalid service token" };
  }
  return { ok: true };
}

/**
 * Check if request has valid X-Gateway-Key header.
 * This is the existing pattern used by brain forwarding.
 *
 * @param req - Incoming request
 * @param expected - Expected key value from GATEWAY_INTERNAL_KEY
 */
export function requireGatewayKey(req: Request, expected: string | undefined): void {
  const key = req.headers.get("X-Gateway-Key") || "";
  if (!expected || !key || key !== expected) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}
