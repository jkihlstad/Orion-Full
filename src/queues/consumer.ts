import { Env } from "../env";
import { sendToConvex } from "../fanout/convex";
import { sendToSocial, reduceToSocialSignal } from "../fanout/social";
import { d1MarkConvexDelivery, d1MarkSocialDelivery, d1GetConsent, d1Audit } from "../storage/d1";

/**
 * Queue consumer for event fanout
 * Delivers to Convex (always) and Social (opt-in only)
 */
export async function handleFanoutBatch(batch: MessageBatch<any>, env: Env) {
  const envelopes = batch.messages.map((m) => m.body);

  // 1. Deliver to Convex as a batch
  try {
    await sendToConvex(env, envelopes);
    for (const e of envelopes) {
      await d1MarkConvexDelivery(env, e.eventId, true);
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    for (const e of envelopes) {
      await d1MarkConvexDelivery(env, e.eventId, false, msg);
    }
    // Let CF retry entire batch
    for (const m of batch.messages) m.retry();
    await d1Audit(env, "fanout_convex_failed", msg);
    return;
  }

  // 2. Conditional social forwarding (opt-in + privacy scope)
  for (const m of batch.messages) {
    const e = m.body;
    try {
      const scope = e.privacyScope;

      // Private events never go to social
      if (scope === "private") {
        await d1MarkSocialDelivery(env, e.eventId, true);
        m.ack();
        continue;
      }

      // Require explicit opt-in consent
      const optedIn = await d1GetConsent(env, e.userId, "social_opt_in");
      if (!optedIn) {
        await d1MarkSocialDelivery(env, e.eventId, true);
        m.ack();
        continue;
      }

      // Send reduced signal only
      const signal = reduceToSocialSignal(e);
      await sendToSocial(env, signal);
      await d1MarkSocialDelivery(env, e.eventId, true);
      m.ack();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      await d1MarkSocialDelivery(env, e.eventId, false, msg);
      m.retry();
    }
  }
}
