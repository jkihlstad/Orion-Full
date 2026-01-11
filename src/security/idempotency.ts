import { Env } from "../env";

// Fast ephemeral cache to short-circuit repeats
export async function checkIdempotencyKV(env: Env, userId: string, idemKey: string) {
  const k = `idem:${userId}:${idemKey}`;
  const v = await env.KV.get(k);
  return v ? { hit: true, eventId: v } : { hit: false as const };
}

export async function storeIdempotencyKV(env: Env, userId: string, idemKey: string, eventId: string) {
  const k = `idem:${userId}:${idemKey}`;
  await env.KV.put(k, eventId, { expirationTtl: 60 * 60 * 24 }); // 24h
}
