import { Env, must } from "../env";
import { QueueEventEnvelope } from "../types/queue";

/**
 * Compute HMAC-SHA256 signature and return as hex string.
 * Uses Web Crypto API for Cloudflare Workers compatibility.
 */
async function computeHmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the X-Orion-Signature header value.
 */
async function buildSignatureHeader(secret: string, body: string): Promise<string> {
  const sigHex = await computeHmacSha256(secret, body);
  return `sha256=${sigHex}`;
}

/**
 * Forward events to Convex ingestion store.
 *
 * If ORION_HMAC_SHARED_SECRET is configured, uses the Window C /ingest/queueBatch
 * endpoint with HMAC-SHA256 signing. Otherwise falls back to legacy endpoint.
 */
export async function sendToConvex(env: Env, batch: QueueEventEnvelope[]): Promise<void> {
  const baseUrl = must(env.CONVEX_INGEST_URL, "Missing CONVEX_INGEST_URL");

  // Check if HMAC signing is enabled (Window C)
  const hmacSecret = env.ORION_HMAC_SHARED_SECRET;

  if (hmacSecret) {
    // Use new /ingest/queueBatch endpoint with HMAC signing
    // Transform batch into messages format expected by Window C
    const messages = batch.map((envelope) => ({
      envelope,
      userId: envelope.userId ?? envelope.clerkUserId,
      tenantId: envelope.tenantId ?? "default",
    }));

    const body = JSON.stringify({ messages });
    const signature = await buildSignatureHeader(hmacSecret, body);

    // Build URL for queueBatch endpoint
    // If CONVEX_INGEST_URL ends with /insertBatch, replace with /ingest/queueBatch
    // Otherwise append /ingest/queueBatch
    let url = baseUrl;
    if (url.endsWith("/insertBatch")) {
      url = url.replace("/insertBatch", "/ingest/queueBatch");
    } else if (!url.endsWith("/ingest/queueBatch")) {
      // Remove trailing slash if present and append path
      url = url.replace(/\/$/, "") + "/ingest/queueBatch";
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orion-Signature": signature,
      },
      body,
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Convex queueBatch ingest failed: ${resp.status} ${t}`);
    }

    // Parse response to check for errors
    const result = await resp.json().catch(() => null) as {
      success?: boolean;
      summary?: { errors?: number };
    } | null;

    if (result && result.success === false) {
      throw new Error(`Convex queueBatch returned errors: ${result.summary?.errors ?? "unknown"} failed`);
    }
  } else {
    // Legacy: Use old endpoint with X-Gateway-Key
    const resp = await fetch(baseUrl, {
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
}
