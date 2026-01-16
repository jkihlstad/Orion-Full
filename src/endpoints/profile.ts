/**
 * Profile endpoints for Orion Edge Gateway
 *
 * GET /v1/profile/get - Retrieve user's profile snapshot
 * POST /v1/profile/update - Update profile from Dashboard
 *
 * Profile snapshots are cached in KV for fast retrieval with a 60s TTL.
 * Updates invalidate the cache and send events to Convex.
 */

import { Env, must } from "../env";
import { json } from "../utils/respond";
import {
  ProfileSnapshot,
  ProfileSnapshotResponse,
  ProfileUpdateResponse,
} from "../types/profile";
import {
  validateProfileUpdateRequest,
  ProfileUpdateRequestT,
} from "../validation/questionnaire";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/profile" });

// ============================================================================
// KV Cache Configuration
// ============================================================================

const PROFILE_CACHE_TTL = 60; // 60 seconds
const PROFILE_CACHE_PREFIX = "profile:";

/**
 * Generate cache key for a user's profile
 */
function getProfileCacheKey(userId: string): string {
  return `${PROFILE_CACHE_PREFIX}${userId}`;
}

// ============================================================================
// Profile Snapshot Retrieval
// ============================================================================

interface CachedProfile {
  profileSnapshot: ProfileSnapshot;
  updatedAt: number;
}

/**
 * Get profile from KV cache
 */
async function getProfileFromCache(
  env: Env,
  userId: string
): Promise<CachedProfile | null> {
  const cacheKey = getProfileCacheKey(userId);
  const cached = await env.KV.get(cacheKey, "json");

  if (cached) {
    return cached as CachedProfile;
  }

  return null;
}

/**
 * Store profile in KV cache
 */
async function cacheProfile(
  env: Env,
  userId: string,
  profileSnapshot: ProfileSnapshot,
  updatedAt: number
): Promise<void> {
  const cacheKey = getProfileCacheKey(userId);
  const cacheData: CachedProfile = { profileSnapshot, updatedAt };

  await env.KV.put(cacheKey, JSON.stringify(cacheData), {
    expirationTtl: PROFILE_CACHE_TTL,
  });
}

/**
 * Invalidate profile cache
 */
async function invalidateProfileCache(env: Env, userId: string): Promise<void> {
  const cacheKey = getProfileCacheKey(userId);
  await env.KV.delete(cacheKey);
}

/**
 * Fetch profile snapshot from Convex
 * Returns null if Convex is unavailable or not configured (graceful degradation)
 */
async function fetchProfileFromConvex(
  env: Env,
  userId: string
): Promise<{ profileSnapshot: ProfileSnapshot; updatedAt: number } | null> {
  // Return null if Convex is not configured (graceful degradation for local dev)
  if (!env.CONVEX_INGEST_URL) {
    logger.info("CONVEX_INGEST_URL not configured, returning null profile", { userId });
    return null;
  }

  // Construct the profile fetch URL (assumes Convex has a profile query endpoint)
  // The exact URL pattern depends on your Convex setup
  const profileUrl = env.CONVEX_INGEST_URL.replace("/ingest", "/profile/get");

  try {
    const resp = await fetch(profileUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
      },
      body: JSON.stringify({ userId }),
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return null;
      }
      const errorText = await resp.text().catch(() => "");
      logger.error("Convex profile fetch failed", null, { status: resp.status, errorText, userId });
      return null; // Graceful degradation instead of throwing
    }

    const data = await resp.json() as {
      profileSnapshot: ProfileSnapshot;
      updatedAt: number;
    };

    return data;
  } catch (e) {
    // Graceful degradation - return null if Convex is unreachable
    logger.error("Failed to fetch profile from Convex (service may be unavailable)", e instanceof Error ? e : null, { userId });
    return null;
  }
}

/**
 * Send profile update event to Convex
 */
async function sendProfileUpdateToConvex(
  env: Env,
  userId: string,
  updates: ProfileUpdateRequestT
): Promise<{ updatedAt: number }> {
  const convexUrl = must(env.CONVEX_INGEST_URL, "Missing CONVEX_INGEST_URL");

  // Send as a dashboard.profile_updated event
  const eventPayload = {
    events: [
      {
        eventType: "dashboard.profile_updated",
        userId,
        timestamp: Date.now(),
        payload: {
          updates,
          source: "dashboard",
        },
      },
    ],
  };

  const resp = await fetch(convexUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
    },
    body: JSON.stringify(eventPayload),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    throw new Error(`Convex profile update failed: ${resp.status} ${errorText}`);
  }

  return { updatedAt: Date.now() };
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /v1/profile/get
 *
 * Retrieves the authenticated user's profile snapshot.
 * First checks KV cache, then falls back to Convex if not cached.
 *
 * Response:
 * {
 *   "ok": true,
 *   "updatedAt": 1234567890,
 *   "profileSnapshot": { ... }
 * }
 */
export async function handleProfileGet(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    // Check cache first
    const cached = await getProfileFromCache(env, userId);
    if (cached) {
      const response: ProfileSnapshotResponse = {
        ok: true,
        updatedAt: cached.updatedAt,
        profileSnapshot: cached.profileSnapshot,
      };
      return json(response, 200, { "X-Cache": "HIT" });
    }

    // Fetch from Convex (may return null if service unavailable or no profile exists)
    const profile = await fetchProfileFromConvex(env, userId);

    if (!profile) {
      // Return an empty profile with default values (graceful degradation)
      const emptyProfile: ProfileSnapshot = {
        profileVersion: "1.0",
        clerkUserId: userId,
        displayName: "",
        timezone: "UTC",
        personaSummary: {
          tone: "friendly",
          detailLevel: 5,
          coachingIntensity: "medium",
          topPriorities: [],
          do: [],
          dont: [],
        },
        notificationRules: {
          global: {
            mode: "normal",
            quietHours: null,
            interruptFor: [],
          },
          apps: {},
        },
        llmPolicy: {
          globalSystemStyle: {},
          appOverrides: {},
        },
      };
      const response: ProfileSnapshotResponse = {
        ok: true,
        updatedAt: 0,
        profileSnapshot: emptyProfile,
      };
      return json(response, 200, { "X-Cache": "EMPTY" });
    }

    // Cache the result
    await cacheProfile(env, userId, profile.profileSnapshot, profile.updatedAt);

    const response: ProfileSnapshotResponse = {
      ok: true,
      updatedAt: profile.updatedAt,
      profileSnapshot: profile.profileSnapshot,
    };

    return json(response, 200, { "X-Cache": "MISS" });
  } catch (e) {
    logger.error("Profile get error", e instanceof Error ? e : null, { userId });
    return json(
      {
        ok: false,
        error: "internal_error",
        message: "Failed to retrieve profile",
      },
      500
    );
  }
}

/**
 * POST /v1/profile/update
 *
 * Updates the authenticated user's profile from Dashboard.
 * Validates the update payload, sends event to Convex, and invalidates cache.
 *
 * Request body:
 * {
 *   "displayName": "New Name",
 *   "timezone": "America/New_York",
 *   "personaSummary": { ... },
 *   "notificationRules": { ... },
 *   "llmPolicy": { ... }
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "updatedAt": 1234567890
 * }
 */
export async function handleProfileUpdate(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        error: "invalid_json",
        message: "Request body must be valid JSON",
      },
      400
    );
  }

  // Validate the update payload
  const validation = validateProfileUpdateRequest(body);
  if (!validation.success) {
    return json(
      {
        ok: false,
        error: "validation_error",
        message: "Invalid update payload",
        details: validation.errors,
      },
      400
    );
  }

  const updates = validation.data!;

  try {
    // Invalidate cache before update (ensures fresh data on next read)
    await invalidateProfileCache(env, userId);

    // Send update to Convex
    const result = await sendProfileUpdateToConvex(env, userId, updates);

    const response: ProfileUpdateResponse = {
      ok: true,
      updatedAt: result.updatedAt,
    };

    return json(response, 200);
  } catch (e) {
    logger.error("Profile update error", e instanceof Error ? e : null, { userId });
    return json(
      {
        ok: false,
        error: "internal_error",
        message: "Failed to update profile",
      },
      500
    );
  }
}
