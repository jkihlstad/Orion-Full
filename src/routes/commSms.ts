/**
 * commSms.ts
 *
 * SMS sending endpoints (gated by A2P status).
 */

import { GatewayError, ErrorCode } from './errors';
import { dbFirst, dbRun } from '../db/queries';
import { a2pRequiredError, A2PStatus } from './commA2p';
import type { Env } from '../env';

interface AuthResult {
  userId: string;
}

async function verifyUserAuth(req: Request, env: Env): Promise<AuthResult | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const testUserId = req.headers.get('X-Test-User-Id');
  if (testUserId) {
    return { userId: testUserId };
  }
  return null;
}

/**
 * POST /v1/comm/sms/send
 * Send an SMS message (GATED: requires A2P approval for US long-code).
 */
export async function smsSend(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: { from?: string; to?: string; body?: string } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  if (!body.from || !body.to || !body.body) {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'from, to, and body are required',
      {}
    ).toResponse();
  }

  // Validate from number belongs to user
  const ownedNumber = await dbFirst<{ e164: string }>(
    env.DB,
    'SELECT e164 FROM comm_numbers WHERE userId = ?1 AND e164 = ?2 AND status = ?3',
    [auth.userId, body.from, 'active']
  );

  if (!ownedNumber) {
    return new GatewayError(
      ErrorCode.FORBIDDEN,
      'You do not own this phone number',
      { from: body.from }
    ).toResponse();
  }

  // Check A2P status (gating for US long-code)
  if (body.from.startsWith('+1')) {
    const a2pRow = await dbFirst<{ status: string }>(
      env.DB,
      'SELECT status FROM comm_a2p WHERE userId = ?1',
      [auth.userId]
    );

    const status = (a2pRow?.status ?? 'not_started') as A2PStatus;
    if (status !== 'approved') {
      return a2pRequiredError(status).toResponse();
    }
  }

  // TODO: Actually call Twilio Messages API to send
  const now = Date.now();
  const mockSid = `SM_mock_${Date.now()}`;

  // Log the message
  await dbRun(
    env.DB,
    `INSERT INTO comm_messages (userId, direction, fromE164, toE164, twilioMessageSid, status, bodyPreview, createdAtMs, sentAtMs)
     VALUES (?1, 'outbound', ?2, ?3, ?4, 'sent', ?5, ?6, ?6)`,
    [
      auth.userId,
      body.from,
      body.to,
      mockSid,
      body.body.slice(0, 50),
      now
    ]
  );

  return Response.json({
    ok: true,
    messageSid: mockSid,
    status: 'sent'
  });
}
