/**
 * Twilio Token Minting
 * Generates access tokens for Twilio Conversations (chat) and Voice
 */

import { Env } from "../env";
import { json } from "../utils/respond";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "twilio/token" });

interface TokenRequest {
  capabilities: ("chat" | "voice")[];
  device?: {
    platform?: string;
    deviceId?: string;
  };
}

interface TokenResponse {
  ok: boolean;
  chat?: {
    token: string;
    identity: string;
    serviceSid: string;
    expiresAt: number;
  };
  voice?: {
    token: string;
    identity: string;
    expiresAt: number;
  };
}

/**
 * Generate a Twilio Access Token
 * Uses the Twilio helper library pattern but implemented manually for Cloudflare Workers
 */
async function generateAccessToken(
  env: Env,
  identity: string,
  grants: { chat?: boolean; voice?: boolean },
  ttlSeconds: number = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  // Build grants object - Twilio-specific JWT grant structure
  interface TwilioGrant {
    identity: string;
    chat?: { service_sid: string };
    voice?: { incoming: { allow: boolean }; outgoing: { application_sid: string } };
  }
  const grantsPayload: TwilioGrant = {
    identity,
  };

  if (grants.chat && env.TWILIO_CONVERSATIONS_SERVICE_SID) {
    grantsPayload.chat = {
      service_sid: env.TWILIO_CONVERSATIONS_SERVICE_SID,
    };
  }

  if (grants.voice) {
    grantsPayload.voice = {
      incoming: { allow: true },
      outgoing: {
        application_sid: env.TWILIO_TWIML_APP_SID || "",
      },
    };
  }

  // JWT header
  const header = {
    typ: "JWT",
    alg: "HS256",
    cty: "twilio-fpa;v=1",
  };

  // JWT payload
  const payload = {
    jti: `${env.TWILIO_API_KEY}-${now}`,
    iss: env.TWILIO_API_KEY,
    sub: env.TWILIO_ACCOUNT_SID,
    iat: now,
    exp,
    grants: grantsPayload,
  };

  // Encode JWT
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const signatureInput = `${headerB64}.${payloadB64}`;

  // Sign with HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.TWILIO_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signatureInput));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signatureInput}.${signatureB64}`;
}

export async function handleTwilioToken(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // Validate Twilio credentials are configured
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY || !env.TWILIO_API_SECRET) {
    return json({ ok: false, error: "twilio_not_configured" }, 503);
  }

  let body: TokenRequest;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const capabilities = body.capabilities || ["chat"];
  const wantsChat = capabilities.includes("chat");
  const wantsVoice = capabilities.includes("voice");

  if (!wantsChat && !wantsVoice) {
    return json({ ok: false, error: "no_capabilities_requested" }, 400);
  }

  // Use Clerk userId as Twilio identity
  const identity = userId;
  const ttlSeconds = 3600; // 1 hour
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  const response: TokenResponse = { ok: true };

  try {
    if (wantsChat) {
      const chatToken = await generateAccessToken(env, identity, { chat: true }, ttlSeconds);
      response.chat = {
        token: chatToken,
        identity,
        serviceSid: env.TWILIO_CONVERSATIONS_SERVICE_SID || "",
        expiresAt,
      };
    }

    if (wantsVoice) {
      const voiceToken = await generateAccessToken(env, identity, { voice: true }, ttlSeconds);
      response.voice = {
        token: voiceToken,
        identity,
        expiresAt,
      };
    }

    return json(response, 200);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("Twilio token generation failed", err instanceof Error ? err : null, { userId: identity });
    return json({ ok: false, error: "token_generation_failed", message: errorMsg }, 500);
  }
}
