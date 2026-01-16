import { Env } from "../env";
import { sendToConvex } from "../fanout/convex";
import { sendToSocial, reduceToSocialSignal } from "../fanout/social";
import { forwardToBrain, shouldForwardToBrain } from "../fanout/brain";
import {
  d1MarkConvexDelivery,
  d1MarkSocialDelivery,
  d1SkipSocialDelivery,
  d1GetConsent,
  d1Audit,
  d1UpsertProfileSnapshot,
} from "../storage/d1";
import { createLogger } from "../utils/logger";
import { QueueEventEnvelope } from "../types/queue";

const logger = createLogger({ module: "queues/consumer" });

// Profile snapshot event types
const PROFILE_SNAPSHOT_EVENTS = [
  "profile.avatar_snapshot_updated",
  "profile.app_snapshot_updated",
];

/**
 * Check if an event is a profile snapshot event
 */
function isProfileSnapshotEvent(eventType: string): boolean {
  return PROFILE_SNAPSHOT_EVENTS.includes(eventType);
}

/**
 * Process profile snapshot events and store in D1.
 * Extracts questionnaire data from the event payload and upserts to profile_snapshots table.
 */
async function processProfileSnapshotEvent(env: Env, envelope: QueueEventEnvelope): Promise<void> {
  const payload = envelope.payload ?? {};

  // Extract questionnaire data from payload
  const questionnaireId = payload.questionnaireId as string | undefined;
  const questionnaireVersion = (payload.questionnaireVersion as number) ?? 1;
  const answers = (payload.answers as Record<string, unknown>) ?? {};
  const answerCount = (payload.answerCount as number) ?? Object.keys(answers).length;

  // For app-specific questionnaires, appId is in the payload
  // For avatar questionnaires, source app is the app that submitted it
  const sourceApp = (payload.appId as string) ?? envelope.sourceApp;

  if (!questionnaireId) {
    logger.warn("Missing questionnaireId in profile snapshot event", { eventId: envelope.eventId });
    return;
  }

  await d1UpsertProfileSnapshot(env, {
    userId: envelope.userId,
    questionnaireId,
    questionnaireVersion,
    answers,
    answerCount,
    sourceApp,
    updatedAtMs: envelope.timestamp ?? Date.now(),
    createdAtMs: Date.now(),
    eventId: envelope.eventId,
  });

  await d1Audit(
    env,
    "profile_snapshot_upserted",
    `${questionnaireId} v${questionnaireVersion} (${answerCount} answers)`,
    envelope.userId
  );
}

/**
 * Queue consumer for event fanout (Window 14 State Machine)
 *
 * Delivers to:
 * 1. Convex (always) - status: pending | delivered | failed | skipped
 * 2. Profile snapshots (for profile.* events) - stores in D1
 * 3. Brain (if brainEnabled) - status: pending | done | failed | skipped
 * 4. Social (opt-in + privacy scope) - status: skipped | pending | delivered | failed
 */
export async function handleFanoutBatch(batch: MessageBatch<QueueEventEnvelope>, env: Env): Promise<void> {
  const envelopes = batch.messages.map((m) => m.body);

  // =========================================================================
  // 1. Deliver to Convex as a batch (required for all events)
  // =========================================================================
  try {
    await sendToConvex(env, envelopes);

    for (const e of envelopes) {
      await d1MarkConvexDelivery(env, e.eventId, {
        success: true,
        httpStatus: 200, // Assume 200 on success
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Try to extract HTTP status from error message
    const statusMatch = msg.match(/(\d{3})/);
    const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

    for (const e of envelopes) {
      await d1MarkConvexDelivery(env, e.eventId, {
        success: false,
        error: msg,
        httpStatus,
      });
    }
    // Let CF retry entire batch
    for (const m of batch.messages) m.retry();
    await d1Audit(env, "fanout_convex_failed", msg);
    return;
  }

  // =========================================================================
  // 2. Process profile snapshot events (store in D1)
  // =========================================================================
  for (const e of envelopes) {
    if (isProfileSnapshotEvent(e.eventType)) {
      try {
        await processProfileSnapshotEvent(env, e);
      } catch (err: unknown) {
        // Log but don't fail the queue - snapshot storage is not critical path
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Failed to process profile snapshot", err instanceof Error ? err : null, { eventId: e.eventId });
        await d1Audit(env, "profile_snapshot_failed", `${e.eventId}: ${errMsg}`);
      }
    }
  }

  // =========================================================================
  // 3. Deliver to Brain (if brainEnabled for eventType)
  // NOTE: Brain delivery is logged via audit only - no D1 columns for brain status
  // =========================================================================
  for (const m of batch.messages) {
    const e = m.body;

    // Check if brain processing is enabled for this event type
    if (!shouldForwardToBrain(e.eventType)) {
      // Brain skipped - logged via audit only (no brain columns in D1)
      continue;
    }

    try {
      // Cast to EventEnvelopeT for brain forwarding (types are compatible at runtime)
      const result = await forwardToBrain(env, e as unknown as import("../types").EventEnvelopeT);

      if (result.forwarded) {
        await d1Audit(env, "fanout_brain_ok", `${e.eventId}: forwarded to brain`, e.userId);
      } else {
        // Not forwarded but not an error (e.g., BRAIN_INGEST_URL not configured)
        await d1Audit(env, "fanout_brain_skipped", `${e.eventId}: ${result.reason ?? 'brain forwarding disabled'}`, e.userId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Note: We don't retry here; Brain failures are tracked but don't block the queue
      await d1Audit(env, "fanout_brain_failed", `${e.eventId}: ${msg}`, e.userId);
    }
  }

  // =========================================================================
  // 4. Conditional social forwarding (opt-in + privacy scope)
  // =========================================================================
  for (const m of batch.messages) {
    const e = m.body;
    try {
      const scope = e.privacyScope;

      // Private events never go to social
      if (scope === "private") {
        await d1SkipSocialDelivery(env, e.eventId, "private scope");
        m.ack();
        continue;
      }

      // Require explicit opt-in consent
      const optedIn = await d1GetConsent(env, e.userId, "social_opt_in");
      if (!optedIn) {
        await d1SkipSocialDelivery(env, e.eventId, "user not opted in");
        m.ack();
        continue;
      }

      // Send reduced signal only
      const signal = reduceToSocialSignal(e);
      await sendToSocial(env, signal);

      await d1MarkSocialDelivery(env, e.eventId, {
        success: true,
        httpStatus: 200, // Assume 200 on success
      });
      m.ack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Extract HTTP status from error message if possible
      const statusMatch = msg.match(/(\d{3})/);
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

      await d1MarkSocialDelivery(env, e.eventId, {
        success: false,
        error: msg,
        httpStatus,
      });
      m.retry();
    }
  }
}
