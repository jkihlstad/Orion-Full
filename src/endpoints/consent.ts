/**
 * Consent Endpoints
 * Window 25: Full consent management with versioning and event emission
 *
 * Endpoints:
 * - GET /v1/consent/get - Get current consent scopes
 * - POST /v1/consent/set - Set a single consent scope (legacy)
 * - POST /v1/consent/update - Update multiple consent scopes
 * - GET /v1/consent/scopes - List all available scopes (public)
 */

import { z } from "zod";
import { Env } from "../env";
import { json } from "../utils/respond";
import {
  d1ListConsents,
  d1SetConsent,
  d1GetUserConsents,
  d1SetUserConsents,
} from "../storage/d1";
import {
  CONSENT_SCOPES,
  isValidScope,
  getDefaultConsents,
} from "../consent/scopes";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/consent" });

// ============================================================================
// Current Consent Version
// ============================================================================

/**
 * Current consent version.
 * Increment this when consent policies change significantly.
 */
const CURRENT_CONSENT_VERSION = "2026-01-11";

// ============================================================================
// GET /v1/consent/get
// ============================================================================

/**
 * Get current consent scopes for the authenticated user.
 *
 * Response:
 * {
 *   "ok": true,
 *   "userId": "clerk_...",
 *   "consentVersion": "2026-01-11",
 *   "scopes": {
 *     "consent.browser.history": true,
 *     "consent.location.precise": false,
 *     ...
 *   }
 * }
 */
export async function handleConsentGet(
  _req: Request,
  env: Env,
  clerkUserId: string
): Promise<Response> {
  try {
    // Get user's stored consents
    const stored = await d1GetUserConsents(env, clerkUserId);

    // If user has no stored consents, return defaults
    const scopes = stored?.scopes ?? getDefaultConsents();
    const consentVersion = stored?.consentVersion ?? CURRENT_CONSENT_VERSION;

    return json({
      ok: true,
      userId: clerkUserId,
      consentVersion,
      scopes,
    });
  } catch (error) {
    logger.error("Consent get endpoint error", error instanceof Error ? error : null, { userId: clerkUserId });
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

// ============================================================================
// POST /v1/consent/set (Legacy - single scope)
// ============================================================================

const ConsentSetBody = z.object({
  scope: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Set a single consent scope.
 * Legacy endpoint - use /v1/consent/update for bulk updates.
 */
export async function handleConsentSet(
  req: Request,
  env: Env,
  clerkUserId: string
): Promise<Response> {
  try {
    const raw = await req.json().catch(() => null);
    if (!raw) return json({ ok: false, error: "invalid_json" }, 400);

    const parsed = ConsentSetBody.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "invalid_request", details: parsed.error.issues },
        400
      );
    }

    const { scope, enabled } = parsed.data;

    // Validate scope
    if (!isValidScope(scope)) {
      return json(
        { ok: false, error: "invalid_scope", message: `Unknown scope: ${scope}` },
        400
      );
    }

    // Update consent
    await d1SetConsent(env, clerkUserId, scope, enabled);

    // Emit consent.updated event
    await emitConsentUpdatedEvent(env, clerkUserId, { [scope]: enabled });

    return json({ ok: true });
  } catch (error) {
    logger.error("Consent set endpoint error", error instanceof Error ? error : null, { userId: clerkUserId });
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

// ============================================================================
// POST /v1/consent/update (Bulk update)
// ============================================================================

const ConsentUpdateBody = z.object({
  consentVersion: z.string().optional(),
  updates: z.record(z.boolean()),
});

/**
 * Update multiple consent scopes at once.
 *
 * Request:
 * {
 *   "consentVersion": "2026-01-11",
 *   "updates": {
 *     "consent.browser.history": true,
 *     "consent.location.precise": true
 *   }
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "updated": ["consent.browser.history", "consent.location.precise"],
 *   "consentVersion": "2026-01-11"
 * }
 */
export async function handleConsentUpdate(
  req: Request,
  env: Env,
  clerkUserId: string
): Promise<Response> {
  try {
    const raw = await req.json().catch(() => null);
    if (!raw) return json({ ok: false, error: "invalid_json" }, 400);

    const parsed = ConsentUpdateBody.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "invalid_request", details: parsed.error.issues },
        400
      );
    }

    const { updates } = parsed.data;
    const consentVersion = parsed.data.consentVersion ?? CURRENT_CONSENT_VERSION;

    // Validate all scopes
    const invalidScopes: string[] = [];
    for (const scope of Object.keys(updates)) {
      if (!isValidScope(scope)) {
        invalidScopes.push(scope);
      }
    }

    if (invalidScopes.length > 0) {
      return json(
        {
          ok: false,
          error: "invalid_scopes",
          message: `Unknown scopes: ${invalidScopes.join(", ")}`,
        },
        400
      );
    }

    // Get current consents
    const stored = await d1GetUserConsents(env, clerkUserId);
    const currentScopes = stored?.scopes ?? getDefaultConsents();

    // Merge updates
    const newScopes = { ...currentScopes, ...updates };

    // Save to D1
    await d1SetUserConsents(env, clerkUserId, consentVersion, newScopes);

    // Emit consent.updated event
    await emitConsentUpdatedEvent(env, clerkUserId, updates);

    return json({
      ok: true,
      updated: Object.keys(updates),
      consentVersion,
    });
  } catch (error) {
    logger.error("Consent update endpoint error", error instanceof Error ? error : null, { userId: clerkUserId });
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

// ============================================================================
// GET /v1/consent/scopes (Public - list available scopes)
// ============================================================================

/**
 * List all available consent scopes.
 * Useful for building consent UI.
 *
 * Response:
 * {
 *   "ok": true,
 *   "scopes": [
 *     { "key": "consent.browser.history", "label": "Browsing History", "risk": "med" },
 *     ...
 *   ]
 * }
 */
export async function handleConsentScopes(
  _req: Request,
  _env: Env
): Promise<Response> {
  try {
    const scopes = CONSENT_SCOPES.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      risk: s.risk,
      apps: s.apps,
      defaultEnabled: s.defaultEnabled,
    }));

    return json({
      ok: true,
      consentVersion: CURRENT_CONSENT_VERSION,
      scopes,
    });
  } catch (error) {
    logger.error("Consent scopes endpoint error", error instanceof Error ? error : null);
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

// ============================================================================
// Consent Event Emission
// ============================================================================

/**
 * Emit a consent.updated event when consent changes.
 * This allows Convex and Brain to know about consent changes.
 */
async function emitConsentUpdatedEvent(
  env: Env,
  userId: string,
  changes: Record<string, boolean>
): Promise<void> {
  const eventId = crypto.randomUUID();
  const now = Date.now();

  // Create event envelope
  const envelope = {
    eventId,
    userId,
    sourceApp: "dashboard",
    eventType: "consent.updated",
    timestamp: now,
    privacyScope: "private",
    consentVersion: CURRENT_CONSENT_VERSION,
    idempotencyKey: eventId,
    payload: {
      changes,
      updatedAt: new Date().toISOString(),
    },
  };

  // Enqueue for fanout (Convex, Brain)
  try {
    await env.FANOUT_QUEUE.send(envelope);
  } catch (e) {
    // Log but don't fail the consent update
    logger.error("Failed to emit consent.updated event", e instanceof Error ? e : null, { userId, eventId });
  }
}
