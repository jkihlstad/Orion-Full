import { Env } from "../env";

/**
 * Proxy queries to brain-platform
 */
export async function queryBrain(env: Env, body: any) {
  if (!env.BRAIN_QUERY_URL) throw new Error("Missing BRAIN_QUERY_URL");

  const resp = await fetch(env.BRAIN_QUERY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Brain query failed: ${resp.status} ${t}`);
  }

  return await resp.json();
}
