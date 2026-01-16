/**
 * Profile Snapshot endpoints for Orion Edge Gateway
 *
 * GET /v1/me/profile-snapshot - Retrieve user's profile snapshots (questionnaire data)
 *
 * These snapshots contain questionnaire answers synced from iOS apps:
 * - Avatar questionnaires (avatar.core.v1, etc.) - shared across all apps
 * - App-specific questionnaires (email.prefs.v1, finance.prefs.v1, etc.)
 *
 * Profile snapshots are used for Brain personalization and cross-app sync.
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import {
  d1ListProfileSnapshots,
  d1GetProfileSnapshot,
  d1GetAvatarSnapshot,
  d1GetAppSnapshots,
  ProfileSnapshotRow,
} from "../storage/d1";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "endpoints/profileSnapshot" });

// ============================================================================
// Response Types
// ============================================================================

interface ProfileSnapshotListResponse {
  ok: true;
  userId: string;
  avatarSnapshot: ProfileSnapshotRow | null;
  appSnapshots: ProfileSnapshotRow[];
  totalSnapshots: number;
}

interface ProfileSnapshotDetailResponse {
  ok: true;
  snapshot: ProfileSnapshotRow;
}

interface ProfileSnapshotErrorResponse {
  ok: false;
  error: string;
  message: string;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /v1/me/profile-snapshot
 *
 * Retrieves the authenticated user's profile snapshots.
 * Query params:
 *   - questionnaireId: Get a specific questionnaire snapshot
 *   - appId: Filter app snapshots by source app
 *
 * Response (list all):
 * {
 *   "ok": true,
 *   "userId": "user_xxx",
 *   "avatarSnapshot": { ... } | null,
 *   "appSnapshots": [ ... ],
 *   "totalSnapshots": 5
 * }
 *
 * Response (specific questionnaire):
 * {
 *   "ok": true,
 *   "snapshot": { ... }
 * }
 */
export async function handleProfileSnapshotGet(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const url = new URL(req.url);
  const questionnaireId = url.searchParams.get("questionnaireId");
  const appId = url.searchParams.get("appId");

  try {
    // If specific questionnaire requested, return just that one
    if (questionnaireId) {
      const snapshot = await d1GetProfileSnapshot(env, userId, questionnaireId);

      if (!snapshot) {
        const response: ProfileSnapshotErrorResponse = {
          ok: false,
          error: "snapshot_not_found",
          message: `No snapshot found for questionnaire: ${questionnaireId}`,
        };
        return json(response, 404);
      }

      const response: ProfileSnapshotDetailResponse = {
        ok: true,
        snapshot,
      };
      return json(response, 200);
    }

    // Get avatar snapshot
    const avatarSnapshot = await d1GetAvatarSnapshot(env, userId);

    // Get app snapshots (optionally filtered by appId)
    const appSnapshots = await d1GetAppSnapshots(env, userId, appId ?? undefined);

    const totalSnapshots = (avatarSnapshot ? 1 : 0) + appSnapshots.length;

    const response: ProfileSnapshotListResponse = {
      ok: true,
      userId,
      avatarSnapshot,
      appSnapshots,
      totalSnapshots,
    };

    return json(response, 200);
  } catch (e) {
    logger.error("Profile snapshot get error", e instanceof Error ? e : null, { userId });
    const response: ProfileSnapshotErrorResponse = {
      ok: false,
      error: "internal_error",
      message: "Failed to retrieve profile snapshots",
    };
    return json(response, 500);
  }
}

/**
 * GET /v1/me/profile-snapshot/avatar
 *
 * Convenience endpoint to get just the avatar snapshot.
 *
 * Response:
 * {
 *   "ok": true,
 *   "snapshot": { ... }
 * }
 */
export async function handleAvatarSnapshotGet(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  try {
    const snapshot = await d1GetAvatarSnapshot(env, userId);

    if (!snapshot) {
      const response: ProfileSnapshotErrorResponse = {
        ok: false,
        error: "avatar_not_found",
        message: "No avatar snapshot found. Complete the avatar questionnaire in any Orion app.",
      };
      return json(response, 404);
    }

    const response: ProfileSnapshotDetailResponse = {
      ok: true,
      snapshot,
    };
    return json(response, 200);
  } catch (e) {
    logger.error("Avatar snapshot get error", e instanceof Error ? e : null, { userId });
    const response: ProfileSnapshotErrorResponse = {
      ok: false,
      error: "internal_error",
      message: "Failed to retrieve avatar snapshot",
    };
    return json(response, 500);
  }
}
