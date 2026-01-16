/**
 * commA2p.ts
 *
 * A2P 10DLC compliance endpoints for the Communication app.
 * Handles brand/campaign registration status and gating.
 */

import { GatewayError, ErrorCode } from './errors';
import { dbFirst, dbRun, dbAll } from '../db/queries';
import type { Env } from '../env';

interface AuthResult {
  userId: string;
}

// Placeholder - replace with actual Clerk JWT verification
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

// A2P Status types
export type A2PStatus = 'not_started' | 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected';
type NextAction = 'start' | 'submit' | 'wait' | 'fix_and_resubmit' | 'none';

interface A2PRow {
  userId: string;
  status: A2PStatus;
  brandType: string | null;
  dataJson: string;
  twilioBrandSid: string | null;
  twilioCampaignSid: string | null;
  rejectionReason: string | null;
  lastCheckedAtMs: number | null;
  submittedAtMs: number | null;
  approvedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

function getNextAction(status: A2PStatus): NextAction {
  switch (status) {
    case 'not_started': return 'start';
    case 'draft': return 'submit';
    case 'submitted':
    case 'in_review': return 'wait';
    case 'rejected': return 'fix_and_resubmit';
    case 'approved': return 'none';
    default: return 'start';
  }
}

/**
 * GET /v1/comm/a2p/status
 * Returns current A2P status and what's required next.
 */
export async function a2pStatus(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const row = await dbFirst<A2PRow>(
    env.DB,
    'SELECT * FROM comm_a2p WHERE userId = ?1',
    [auth.userId]
  );

  if (!row) {
    return Response.json({
      ok: true,
      status: 'not_started',
      lastCheckedAtMs: null,
      nextAction: 'start',
      rejectionReason: null,
      summary: {
        brandType: null,
        hasDraft: false,
        submittedAtMs: null
      }
    });
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.dataJson);
  } catch {}

  return Response.json({
    ok: true,
    status: row.status,
    lastCheckedAtMs: row.lastCheckedAtMs,
    nextAction: getNextAction(row.status),
    rejectionReason: row.rejectionReason,
    summary: {
      brandType: row.brandType,
      hasDraft: Object.keys(data).length > 0,
      submittedAtMs: row.submittedAtMs
    }
  });
}

/**
 * POST /v1/comm/a2p/start
 * Creates or resets a draft.
 */
export async function a2pStart(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: { brandType?: string } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  const brandType = body.brandType === 'business' ? 'business' : 'individual';
  const now = Date.now();

  await dbRun(
    env.DB,
    `INSERT INTO comm_a2p (userId, status, brandType, dataJson, createdAtMs, updatedAtMs)
     VALUES (?1, 'draft', ?2, '{}', ?3, ?3)
     ON CONFLICT(userId) DO UPDATE SET
       status = 'draft',
       brandType = ?2,
       dataJson = '{}',
       rejectionReason = NULL,
       twilioBrandSid = NULL,
       twilioCampaignSid = NULL,
       updatedAtMs = ?3`,
    [auth.userId, brandType, now]
  );

  return Response.json({ ok: true, status: 'draft', brandType });
}

/**
 * POST /v1/comm/a2p/saveDraft
 * Idempotent save of wizard fields.
 */
export async function a2pSaveDraft(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: { draft?: Record<string, unknown> } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  if (!body.draft || typeof body.draft !== 'object') {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'draft object required',
      {}
    ).toResponse();
  }

  const now = Date.now();
  const dataJson = JSON.stringify(body.draft);

  // Check if record exists
  const existing = await dbFirst<A2PRow>(
    env.DB,
    'SELECT status FROM comm_a2p WHERE userId = ?1',
    [auth.userId]
  );

  if (!existing) {
    // Create new draft
    await dbRun(
      env.DB,
      `INSERT INTO comm_a2p (userId, status, brandType, dataJson, createdAtMs, updatedAtMs)
       VALUES (?1, 'draft', 'individual', ?2, ?3, ?3)`,
      [auth.userId, dataJson, now]
    );
  } else if (existing.status === 'draft' || existing.status === 'rejected') {
    // Update existing draft
    await dbRun(
      env.DB,
      `UPDATE comm_a2p SET dataJson = ?1, updatedAtMs = ?2, status = 'draft' WHERE userId = ?3`,
      [dataJson, now, auth.userId]
    );
  } else {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'Cannot modify draft in current status',
      { status: existing.status }
    ).toResponse();
  }

  return Response.json({ ok: true, status: 'draft', updatedAtMs: now });
}

/**
 * POST /v1/comm/a2p/submit
 * Validates draft and submits to Twilio.
 */
export async function a2pSubmit(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const row = await dbFirst<A2PRow>(
    env.DB,
    'SELECT * FROM comm_a2p WHERE userId = ?1',
    [auth.userId]
  );

  if (!row || (row.status !== 'draft' && row.status !== 'rejected')) {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'No draft to submit',
      { currentStatus: row?.status ?? 'not_started' }
    ).toResponse();
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.dataJson);
  } catch {}

  // Validate required fields
  const errors: string[] = [];

  if (!data.contact || typeof data.contact !== 'object') {
    errors.push('contact information required');
  }
  if (!data.address || typeof data.address !== 'object') {
    errors.push('address required');
  }
  if (!data.useCase || typeof data.useCase !== 'object') {
    errors.push('use case information required');
  }
  if (row.brandType === 'business' && (!data.business || typeof data.business !== 'object')) {
    errors.push('business information required for business registration');
  }

  if (errors.length > 0) {
    return new GatewayError(
      ErrorCode.INVALID_SCHEMA,
      'Validation failed',
      { errors }
    ).toResponse();
  }

  const now = Date.now();

  // TODO: Call Twilio TrustHub API here to create brand/campaign
  // For now, just move to submitted status
  const twilioBrandSid = `BN_mock_${auth.userId}`;
  const twilioCampaignSid = `CP_mock_${auth.userId}`;

  await dbRun(
    env.DB,
    `UPDATE comm_a2p SET
       status = 'submitted',
       twilioBrandSid = ?1,
       twilioCampaignSid = ?2,
       submittedAtMs = ?3,
       updatedAtMs = ?3,
       rejectionReason = NULL
     WHERE userId = ?4`,
    [twilioBrandSid, twilioCampaignSid, now, auth.userId]
  );

  return Response.json({
    ok: true,
    status: 'submitted',
    twilio: {
      brandSid: twilioBrandSid,
      campaignSid: twilioCampaignSid
    }
  });
}

/**
 * POST /v1/comm/a2p/refresh
 * Polls Twilio status and updates state.
 */
export async function a2pRefresh(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const row = await dbFirst<A2PRow>(
    env.DB,
    'SELECT * FROM comm_a2p WHERE userId = ?1',
    [auth.userId]
  );

  if (!row) {
    return Response.json({
      ok: true,
      status: 'not_started',
      rejectionReason: null
    });
  }

  const now = Date.now();

  // TODO: Actually poll Twilio TrustHub API for status
  // For now, simulate progression: submitted -> in_review -> approved
  let newStatus = row.status;

  if (row.status === 'submitted') {
    // Simulate moving to in_review after some time
    if (row.submittedAtMs && now - row.submittedAtMs > 5000) {
      newStatus = 'in_review';
    }
  } else if (row.status === 'in_review') {
    // Simulate approval after more time (for testing, use very short time)
    if (row.submittedAtMs && now - row.submittedAtMs > 30000) {
      newStatus = 'approved';
    }
  }

  if (newStatus !== row.status) {
    const updateFields: string[] = ['status = ?1', 'lastCheckedAtMs = ?2', 'updatedAtMs = ?2'];
    const params: unknown[] = [newStatus, now];

    if (newStatus === 'approved') {
      updateFields.push('approvedAtMs = ?2');
    }

    params.push(auth.userId);

    await dbRun(
      env.DB,
      `UPDATE comm_a2p SET ${updateFields.join(', ')} WHERE userId = ?${params.length}`,
      params
    );
  } else {
    await dbRun(
      env.DB,
      'UPDATE comm_a2p SET lastCheckedAtMs = ?1 WHERE userId = ?2',
      [now, auth.userId]
    );
  }

  return Response.json({
    ok: true,
    status: newStatus,
    rejectionReason: row.rejectionReason
  });
}

/**
 * Check if user has A2P approval (utility for gating)
 */
export async function isA2PApproved(db: D1Database, userId: string): Promise<boolean> {
  const row = await dbFirst<{ status: string }>(
    db,
    'SELECT status FROM comm_a2p WHERE userId = ?1',
    [userId]
  );
  return row?.status === 'approved';
}

/**
 * A2P Required error response
 */
export function a2pRequiredError(status: A2PStatus): GatewayError {
  return new GatewayError(
    'A2P_REQUIRED' as ErrorCode,
    'Messaging compliance required before buying numbers or sending SMS.',
    {
      status,
      nextAction: getNextAction(status)
    }
  );
}
