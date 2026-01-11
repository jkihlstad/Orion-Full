import { Env, must } from "../env";

/**
 * Forward events to Convex ingestion store
 */
export async function sendToConvex(env: Env, batch: any[]) {
  const url = must(env.CONVEX_INGEST_URL, "Missing CONVEX_INGEST_URL");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Key": env.GATEWAY_INTERNAL_KEY ?? "",
    },
    body: JSON.stringify({ events: batch }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Convex ingest failed: ${resp.status} ${t}`);
  }
}
