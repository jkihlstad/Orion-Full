/**
 * twilioToken.ts
 *
 * POST /v1/twilio/token - Mint Twilio Access Tokens safely
 *
 * This endpoint lives in edge-gateway-worker because:
 * - iOS must never have Twilio secrets
 * - Token minting is a classic "gateway responsibility"
 * - It binds Twilio identity to Clerk userId
 */

import { GatewayError, ErrorCode } from './errors';
import type { Env } from '../env';

interface TokenRequest {
  ttlSeconds?: number;
  allowIncoming?: boolean;
}

interface AuthResult {
  userId: string;
}

// Placeholder - replace with actual Clerk JWT verification
async function verifyUserAuth(req: Request, env: Env): Promise<AuthResult | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  // For testing, check X-Test-User-Id header
  const testUserId = req.headers.get('X-Test-User-Id');
  if (testUserId) {
    return { userId: testUserId };
  }

  // TODO: Implement actual Clerk JWT verification
  return null;
}

/**
 * Clamp an integer value between min and max
 */
function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Rate limit check using KV
 * Returns true if request should be allowed, false if rate limited
 */
async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  maxRequests: number = 20,
  windowMs: number = 3600000 // 1 hour
): Promise<boolean> {
  const key = `ratelimit:twilio_token:${userId}`;
  const now = Date.now();

  const stored = await kv.get(key);

  if (!stored) {
    // First request
    await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: Math.ceil(windowMs / 1000)
    });
    return true;
  }

  const data = JSON.parse(stored);

  // Check if window has expired
  if (now - data.windowStart > windowMs) {
    // New window
    await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: Math.ceil(windowMs / 1000)
    });
    return true;
  }

  // Within window
  if (data.count >= maxRequests) {
    return false;
  }

  // Increment
  await kv.put(key, JSON.stringify({ count: data.count + 1, windowStart: data.windowStart }), {
    expirationTtl: Math.ceil((windowMs - (now - data.windowStart)) / 1000)
  });

  return true;
}

/**
 * Build Twilio Access Token manually (no twilio SDK dependency for edge workers)
 */
function buildTwilioAccessToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  identity: string,
  ttlSeconds: number,
  grants: {
    conversations?: { serviceSid: string };
    voice?: {
      outgoingApplicationSid: string;
      incomingAllow: boolean;
      pushCredentialSid?: string;
    };
  }
): string {
  const header = {
    typ: 'JWT',
    alg: 'HS256',
    cty: 'twilio-fpa;v=1'
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const payload: Record<string, unknown> = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    exp: exp,
    nbf: now,
    grants: {
      identity: identity
    }
  };

  // Add conversation grant
  if (grants.conversations) {
    (payload.grants as Record<string, unknown>).chat = {
      service_sid: grants.conversations.serviceSid
    };
  }

  // Add voice grant
  if (grants.voice) {
    const voiceGrant: Record<string, unknown> = {
      outgoing: {
        application_sid: grants.voice.outgoingApplicationSid
      }
    };

    if (grants.voice.incomingAllow) {
      voiceGrant.incoming = { allow: true };
    }

    if (grants.voice.pushCredentialSid) {
      voiceGrant.push_credential_sid = grants.voice.pushCredentialSid;
    }

    (payload.grants as Record<string, unknown>).voice = voiceGrant;
  }

  // Base64url encode
  const base64url = (data: unknown): string => {
    const json = JSON.stringify(data);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerEncoded = base64url(header);
  const payloadEncoded = base64url(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  // HMAC-SHA256 signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiKeySecret);
  const messageData = encoder.encode(signingInput);

  // Use Web Crypto API for HMAC
  // This is async but we'll handle it in the caller
  return `${signingInput}.__SIGNATURE_PLACEHOLDER__`;
}

/**
 * Async version that properly signs the token
 */
async function buildTwilioAccessTokenAsync(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  identity: string,
  ttlSeconds: number,
  grants: {
    conversations?: { serviceSid: string };
    voice?: {
      outgoingApplicationSid: string;
      incomingAllow: boolean;
      pushCredentialSid?: string;
    };
  }
): Promise<string> {
  const header = {
    typ: 'JWT',
    alg: 'HS256',
    cty: 'twilio-fpa;v=1'
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const payload: Record<string, unknown> = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    exp: exp,
    nbf: now,
    grants: {
      identity: identity
    }
  };

  // Add conversation grant
  if (grants.conversations) {
    (payload.grants as Record<string, unknown>).chat = {
      service_sid: grants.conversations.serviceSid
    };
  }

  // Add voice grant
  if (grants.voice) {
    const voiceGrant: Record<string, unknown> = {
      outgoing: {
        application_sid: grants.voice.outgoingApplicationSid
      }
    };

    if (grants.voice.incomingAllow) {
      voiceGrant.incoming = { allow: true };
    }

    if (grants.voice.pushCredentialSid) {
      voiceGrant.push_credential_sid = grants.voice.pushCredentialSid;
    }

    (payload.grants as Record<string, unknown>).voice = voiceGrant;
  }

  // Base64url encode
  const base64url = (data: unknown): string => {
    const json = JSON.stringify(data);
    // Handle non-ASCII characters
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerEncoded = base64url(header);
  const payloadEncoded = base64url(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  // HMAC-SHA256 signature using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiKeySecret);
  const messageData = encoder.encode(signingInput);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
  const signatureArray = new Uint8Array(signatureBuffer);

  // Convert to base64url
  let signatureBinary = '';
  for (let i = 0; i < signatureArray.length; i++) {
    signatureBinary += String.fromCharCode(signatureArray[i]);
  }
  const signatureBase64 = btoa(signatureBinary);
  const signatureEncoded = signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${signingInput}.${signatureEncoded}`;
}

/**
 * POST /v1/twilio/token
 *
 * Mints a Twilio Access Token for the authenticated user.
 * Token is scoped to Conversations + Voice grants.
 */
export async function twilioToken(req: Request, env: Env): Promise<Response> {
  // Method check
  if (req.method !== 'POST') {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'Method not allowed',
      { expected: 'POST' }
    ).toResponse();
  }

  // Auth via Clerk JWT (bind token identity to your user)
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(
      ErrorCode.UNAUTHORIZED,
      'Bearer token required',
      {}
    ).toResponse();
  }

  const userId = auth.userId;
  const identity = `orion:${userId}`; // stable, namespaced

  // Rate limit check (20 tokens per hour per user)
  if (env.KV) {
    const allowed = await checkRateLimit(env.KV, userId, 20, 3600000);
    if (!allowed) {
      return new GatewayError(
        ErrorCode.RATE_LIMITED,
        'Too many token requests',
        { retryAfter: 3600 }
      ).toResponse();
    }
  }

  // Parse optional params
  let body: TokenRequest = {};
  try {
    body = await req.json() as TokenRequest;
  } catch {
    // Empty body is fine, use defaults
  }

  const ttlSeconds = clampInt(body.ttlSeconds ?? 3600, 300, 86400); // 5 min to 24h
  const allowIncoming = body.allowIncoming !== false; // default true

  // Validate required secrets
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY_SID || !env.TWILIO_API_KEY_SECRET) {
    return new GatewayError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Twilio not configured',
      {}
    ).toResponse();
  }

  // Build grants
  const grants: Parameters<typeof buildTwilioAccessTokenAsync>[5] = {};

  // Conversations grant (chat)
  if (env.TWILIO_CONVERSATIONS_SERVICE_SID) {
    grants.conversations = {
      serviceSid: env.TWILIO_CONVERSATIONS_SERVICE_SID
    };
  }

  // Voice grant (calls)
  if (env.TWILIO_TWIML_APP_SID) {
    grants.voice = {
      outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
      incomingAllow: allowIncoming,
      pushCredentialSid: env.TWILIO_PUSH_CREDENTIAL_SID
    };
  }

  // Build token
  const jwt = await buildTwilioAccessTokenAsync(
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_API_KEY_SID,
    env.TWILIO_API_KEY_SECRET,
    identity,
    ttlSeconds,
    grants
  );

  const expiresAtMs = Date.now() + ttlSeconds * 1000;

  // Optional: Log token mint event to D1
  // This would be implemented as a communication.twilio_token_minted event

  return Response.json({
    ok: true,
    identity,
    token: jwt,
    expiresAtMs,
    ttlSeconds,
    grants: {
      conversations: !!grants.conversations,
      voice: !!grants.voice
    }
  });
}
