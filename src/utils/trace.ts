/**
 * Trace ID utilities for Gateway traceId guarantee
 *
 * Window 93: Provides consistent traceId generation and enforcement
 * to enable end-to-end tracking of events through the pipeline.
 */

/**
 * Generate a new traceId with the format: {prefix}_YYYYMMDD_HHMMSS_{random}
 *
 * @param prefix - Optional prefix for the traceId (default: "trace")
 * @returns A new traceId string
 *
 * @example
 * newTraceId()           // "trace_20260111_143022_a1b2c3d4"
 * newTraceId("test")     // "test_20260111_143022_e5f6g7h8"
 * newTraceId("golden")   // "golden_20260111_143022_i9j0k1l2"
 */
export function newTraceId(prefix: string = "trace"): string {
  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");

  const datePart = `${year}${month}${day}`;
  const timePart = `${hours}${minutes}${seconds}`;

  // Generate 8 random hex characters
  const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return `${prefix}_${datePart}_${timePart}_${randomPart}`;
}

/**
 * Ensure a traceId exists in the body, generating one if missing.
 * This is the Gateway traceId guarantee - every event will have a traceId.
 *
 * @param body - The request body (event envelope or object with optional traceId)
 * @returns The traceId (existing or newly generated)
 *
 * @example
 * // Body without traceId - generates new one
 * const id = ensureTraceId({ eventId: "abc", payload: {} });
 * // Returns: "trace_20260111_143022_a1b2c3d4"
 *
 * // Body with existing traceId - returns existing
 * const id = ensureTraceId({ eventId: "abc", traceId: "test_123", payload: {} });
 * // Returns: "test_123"
 */
export function ensureTraceId(body: { traceId?: string } | unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "traceId" in body &&
    typeof (body as { traceId?: unknown }).traceId === "string" &&
    (body as { traceId: string }).traceId.length > 0
  ) {
    return (body as { traceId: string }).traceId;
  }

  return newTraceId();
}

/**
 * Extract traceId from request headers (X-Trace-Id) or body.
 * Headers take precedence over body.
 *
 * @param req - The incoming request
 * @param body - The parsed request body (optional)
 * @returns The traceId if found, undefined otherwise
 */
export function extractTraceId(
  req: Request,
  body?: { traceId?: string } | unknown
): string | undefined {
  // Check header first (takes precedence)
  const headerTraceId = req.headers.get("X-Trace-Id");
  if (headerTraceId && headerTraceId.length > 0) {
    return headerTraceId;
  }

  // Check body
  if (
    body &&
    typeof body === "object" &&
    "traceId" in body &&
    typeof (body as { traceId?: unknown }).traceId === "string" &&
    (body as { traceId: string }).traceId.length > 0
  ) {
    return (body as { traceId: string }).traceId;
  }

  return undefined;
}

/**
 * Validate traceId format.
 * Accepts any non-empty string, but logs a warning if it doesn't match expected format.
 *
 * @param traceId - The traceId to validate
 * @returns true if valid (non-empty string)
 */
export function isValidTraceId(traceId: unknown): traceId is string {
  return typeof traceId === "string" && traceId.length > 0;
}

/**
 * Check if traceId matches the standard format: {prefix}_{YYYYMMDD}_{HHMMSS}_{random}
 *
 * @param traceId - The traceId to check
 * @returns true if matches standard format
 */
export function isStandardTraceIdFormat(traceId: string): boolean {
  // Pattern: prefix_YYYYMMDD_HHMMSS_hexchars
  const pattern = /^[a-z]+_\d{8}_\d{6}_[a-f0-9]{8}$/;
  return pattern.test(traceId);
}
