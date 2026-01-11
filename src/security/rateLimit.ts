import { Env } from "../env";

export async function rateLimitKV(env: Env, key: string, limit: number, windowSec: number) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = `${key}:${Math.floor(now / windowSec)}`;

  const current = await env.KV.get(bucket);
  const n = current ? Number(current) : 0;

  if (n >= limit) return { ok: false, remaining: 0 };

  // best-effort increment (KV isn't atomic; ok for lightweight throttling)
  await env.KV.put(bucket, String(n + 1), { expirationTtl: windowSec + 5 });
  return { ok: true, remaining: Math.max(0, limit - (n + 1)) };
}
