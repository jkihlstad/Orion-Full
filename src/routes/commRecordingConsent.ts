/**
 * commRecordingConsent.ts
 *
 * Endpoints for managing call recording consent.
 */

import { GatewayError, ErrorCode } from './errors';
import { dbFirst, dbRun } from '../db/queries';
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
 * GET /v1/comm/recording/consent
 * Get current recording consent status.
 */
export async function getRecordingConsent(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  const row = await dbFirst<{
    callRecordingEnabled: number;
    transcriptionEnabled: number;
    consentVersion: string | null;
    updatedAtMs: number;
  }>(
    env.DB,
    'SELECT callRecordingEnabled, transcriptionEnabled, consentVersion, updatedAtMs FROM comm_recording_consent WHERE userId = ?1',
    [auth.userId]
  );

  if (!row) {
    return Response.json({
      ok: true,
      callRecordingEnabled: false,
      transcriptionEnabled: false,
      consentVersion: null
    });
  }

  return Response.json({
    ok: true,
    callRecordingEnabled: row.callRecordingEnabled === 1,
    transcriptionEnabled: row.transcriptionEnabled === 1,
    consentVersion: row.consentVersion,
    updatedAtMs: row.updatedAtMs
  });
}

/**
 * POST /v1/comm/recording/consent
 * Update recording consent.
 */
export async function updateRecordingConsent(req: Request, env: Env): Promise<Response> {
  const auth = await verifyUserAuth(req, env);
  if (!auth) {
    return new GatewayError(ErrorCode.UNAUTHORIZED, 'Bearer token required', {}).toResponse();
  }

  let body: {
    callRecordingEnabled?: boolean;
    transcriptionEnabled?: boolean;
    consentVersion?: string;
  } = {};
  try {
    body = await req.json() as typeof body;
  } catch {}

  const now = Date.now();
  const callRecordingEnabled = body.callRecordingEnabled === true ? 1 : 0;
  const transcriptionEnabled = body.transcriptionEnabled === true ? 1 : 0;
  const consentVersion = body.consentVersion ?? '1.0.0';

  await dbRun(
    env.DB,
    `INSERT INTO comm_recording_consent (userId, callRecordingEnabled, transcriptionEnabled, consentVersion, updatedAtMs, enabledAtMs)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(userId) DO UPDATE SET
       callRecordingEnabled = ?2,
       transcriptionEnabled = ?3,
       consentVersion = ?4,
       updatedAtMs = ?5,
       enabledAtMs = CASE WHEN ?2 = 1 AND callRecordingEnabled = 0 THEN ?5 ELSE enabledAtMs END,
       disabledAtMs = CASE WHEN ?2 = 0 AND callRecordingEnabled = 1 THEN ?5 ELSE disabledAtMs END`,
    [auth.userId, callRecordingEnabled, transcriptionEnabled, consentVersion, now, callRecordingEnabled === 1 ? now : null]
  );

  return Response.json({
    ok: true,
    callRecordingEnabled: callRecordingEnabled === 1,
    transcriptionEnabled: transcriptionEnabled === 1,
    consentVersion,
    updatedAtMs: now
  });
}
