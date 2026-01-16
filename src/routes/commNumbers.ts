/**
 * commNumbers.ts
 *
 * Phone number management endpoints (gated by A2P status).
 */

import { GatewayError, ErrorCode } from './errors';
import { dbFirst, dbRun, dbAll } from '../db/queries';
import { isA2PApproved, a2pRequiredError, A2PStatus } from './commA2p';
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
 * GET /v1/comm/number/search
 * Search available numbers (not gated, but can only buy if approved).
 */
export async function numberSearch(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const url = new URL(req.url);
  const country = url.searchParams.get('country') ?? 'US';
  const areaCode = url.searchParams.get('area');
  const limitRaw = url.searchParams.get('limit') ?? '10';
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 20);

  // TODO: Actually call Twilio AvailablePhoneNumbers API
  // For now, return mock numbers
  const mockNumbers = [];
  for (let i = 0; i < limit; i++) {
    const area = areaCode ?? '541';
    const num = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
    mockNumbers.push({
      e164: `+1${area}${num}`,
      friendlyName: `(${area}) ${num.slice(0, 3)}-${num.slice(3)}`,
      capabilities: { voice: true, sms: true, mms: false }
    });
  }

  return Response.json({
    ok: true,
    country,
    numbers: mockNumbers
  });
}

/**
 * POST /v1/comm/number/buy
 * Purchase a number (GATED: requires A2P approval for US SMS numbers).
 */
export async function numberBuy(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: { e164?: string } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  if (!body.e164 || typeof body.e164 !== 'string') {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'e164 phone number required',
      {}
    ).toResponse();
  }

  // Check A2P status (gating)
  const row = await dbFirst<{ status: string }>(
    env.DB,
    'SELECT status FROM comm_a2p WHERE userId = ?1',
    [auth.userId]
  );

  const status = (row?.status ?? 'not_started') as A2PStatus;

  // For US numbers, require A2P approval
  if (body.e164.startsWith('+1') && status !== 'approved') {
    return a2pRequiredError(status).toResponse();
  }

  // TODO: Actually call Twilio IncomingPhoneNumbers API to purchase
  const now = Date.now();
  const mockSid = `PN_mock_${Date.now()}`;

  await dbRun(
    env.DB,
    `INSERT INTO comm_numbers (userId, e164, friendlyName, twilioIncomingPhoneNumberSid, capabilities, status, createdAtMs)
     VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)`,
    [
      auth.userId,
      body.e164,
      body.e164,
      mockSid,
      JSON.stringify({ voice: true, sms: true }),
      now
    ]
  );

  return Response.json({
    ok: true,
    e164: body.e164,
    status: 'active',
    twilioSid: mockSid
  });
}

/**
 * GET /v1/comm/number/list
 * List user's owned numbers.
 */
export async function numberList(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const rows = await dbAll<{
    e164: string;
    friendlyName: string;
    capabilities: string;
    status: string;
    createdAtMs: number;
  }>(
    env.DB,
    `SELECT e164, friendlyName, capabilities, status, createdAtMs
     FROM comm_numbers
     WHERE userId = ?1 AND status = 'active'
     ORDER BY createdAtMs DESC`,
    [auth.userId]
  );

  const numbers = rows.map(r => ({
    e164: r.e164,
    friendlyName: r.friendlyName,
    capabilities: JSON.parse(r.capabilities || '{}'),
    status: r.status,
    createdAtMs: r.createdAtMs
  }));

  return Response.json({
    ok: true,
    count: numbers.length,
    numbers
  });
}

/**
 * POST /v1/comm/number/release
 * Release a number.
 */
export async function numberRelease(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: { e164?: string } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  if (!body.e164) {
    return new GatewayError(ErrorCode.INVALID_SCHEMA, 'e164 required', {}).toResponse();
  }

  const now = Date.now();

  // TODO: Actually call Twilio API to release the number
  const result = await dbRun(
    env.DB,
    `UPDATE comm_numbers SET status = 'released', releasedAtMs = ?1
     WHERE userId = ?2 AND e164 = ?3 AND status = 'active'`,
    [now, auth.userId, body.e164]
  );

  if (result.changes === 0) {
    return new GatewayError(
      ErrorCode.UNKNOWN_EVENT_TYPE,
      'Number not found or already released',
      { e164: body.e164 }
    ).toResponse();
  }

  return Response.json({ ok: true, e164: body.e164, status: 'released' });
}
