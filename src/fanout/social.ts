import { Env } from "../env";

/**
 * Reduce event to minimal social signal (never send raw amounts, receipts, etc)
 */
export function reduceToSocialSignal(envelope: any) {
  const { userId, eventType, timestamp, privacyScope } = envelope;

  return {
    userId,
    eventType,
    timestamp,
    privacyScope,
    // Only include coarse category if present
    category: envelope?.payload?.category ?? null,
  };
}

/**
 * Forward reduced signal to social-backend (opt-in only)
 */
export async function sendToSocial(env: Env, signal: any) {
  if (!env.SOCIAL_SIGNAL_URL) throw new Error("Missing SOCIAL_SIGNAL_URL");

  const resp = await fetch(env.SOCIAL_SIGNAL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
    },
    body: JSON.stringify(signal),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Social signal failed: ${resp.status} ${t}`);
  }
}
