/**
 * twilioWebhooks.ts
 *
 * Twilio webhook handlers for:
 * - Voice call TwiML generation (outgoing calls)
 * - Call status callbacks
 * - Recording status callbacks
 *
 * These endpoints are called by Twilio, not by the iOS app directly.
 */

import { GatewayError, ErrorCode } from './errors';
import { dbFirst, dbRun, dbAll } from '../db/queries';
import type { Env } from '../env';

/**
 * Verify Twilio request signature
 * In production, this validates the X-Twilio-Signature header
 */
async function verifyTwilioSignature(req: Request, env: Env): Promise<boolean> {
  // Allow bypass in development/staging for testing
  if (env.ENVIRONMENT !== 'production') {
    const bypassKey = req.headers.get('X-Twilio-Test-Bypass');
    if (bypassKey && bypassKey === env.TWILIO_WEBHOOK_BYPASS_KEY) {
      return true;
    }
  }

  // TODO: Implement actual Twilio signature verification
  // https://www.twilio.com/docs/usage/security#validating-requests
  const signature = req.headers.get('X-Twilio-Signature');
  if (!signature) {
    return false;
  }

  // For now, accept if signature header is present
  // Real implementation would validate HMAC
  return true;
}

/**
 * Parse form-urlencoded body from Twilio
 */
async function parseFormBody(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const params: Record<string, string> = {};

  for (const pair of text.split('&')) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }

  return params;
}

/**
 * Extract userId from Twilio identity (orion:user_xxx)
 */
function extractUserId(identity: string | undefined): string | null {
  if (!identity) return null;
  if (identity.startsWith('orion:')) {
    return identity.slice(6);
  }
  return identity;
}

/**
 * POST /v1/twilio/voice/outgoing
 *
 * Webhook called by Twilio when an outgoing call is initiated.
 * Returns TwiML with recording announcement and dial instructions.
 */
export async function twilioVoiceOutgoing(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verify Twilio signature
  const valid = await verifyTwilioSignature(req, env);
  if (!valid) {
    return new Response('Invalid signature', { status: 403 });
  }

  const params = await parseFormBody(req);

  const callSid = params.CallSid;
  const from = params.From;
  const to = params.To;
  const caller = params.Caller;
  const callerIdentity = extractUserId(caller);

  // Check if user has recording consent enabled
  let recordingEnabled = false;
  if (callerIdentity) {
    const consent = await dbFirst<{ callRecordingEnabled: number }>(
      env.DB,
      'SELECT callRecordingEnabled FROM comm_recording_consent WHERE userId = ?1',
      [callerIdentity]
    );
    recordingEnabled = consent?.callRecordingEnabled === 1;
  }

  // Build TwiML response
  const recordAttribute = recordingEnabled
    ? 'record="record-from-answer-dual"'
    : 'record="do-not-record"';

  const recordingCallback = recordingEnabled
    ? `recordingStatusCallback="${new URL('/v1/twilio/recording/status', req.url).toString()}"`
    : '';

  const statusCallback = `statusCallback="${new URL('/v1/twilio/call/status', req.url).toString()}"`;

  // Build announcement
  const announcement = recordingEnabled
    ? '<Say voice="alice">This call is being recorded for quality assurance.</Say>'
    : '';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${announcement}
  <Dial ${recordAttribute} ${recordingCallback} ${statusCallback} callerId="${from}">
    <Number>${to}</Number>
  </Dial>
</Response>`;

  // Log call initiation
  const now = Date.now();
  if (callerIdentity && callSid) {
    await dbRun(
      env.DB,
      `INSERT INTO comm_calls (userId, direction, fromE164, toE164, twilioCallSid, status, recordingEnabled, createdAtMs, startedAtMs)
       VALUES (?1, 'outbound', ?2, ?3, ?4, 'initiated', ?5, ?6, ?6)
       ON CONFLICT(twilioCallSid) DO NOTHING`,
      [callerIdentity, from, to, callSid, recordingEnabled ? 1 : 0, now]
    ).catch(() => {}); // Ignore errors, don't block TwiML
  }

  return new Response(twiml, {
    headers: { 'Content-Type': 'application/xml' }
  });
}

/**
 * POST /v1/twilio/call/status
 *
 * Webhook called by Twilio with call status updates.
 */
export async function twilioCallStatus(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const valid = await verifyTwilioSignature(req, env);
  if (!valid) {
    return new Response('Invalid signature', { status: 403 });
  }

  const params = await parseFormBody(req);

  const callSid = params.CallSid;
  const callStatus = params.CallStatus; // initiated|ringing|in-progress|completed|busy|failed|no-answer|canceled
  const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;
  const answeredBy = params.AnsweredBy; // human|machine|fax
  const from = params.From;
  const to = params.To;
  const caller = params.Caller;
  const callerIdentity = extractUserId(caller);

  const now = Date.now();

  // Update call record
  if (callSid) {
    const updateFields: string[] = ['status = ?1'];
    const updateParams: unknown[] = [callStatus];

    if (duration !== null) {
      updateFields.push('durationSeconds = ?2');
      updateParams.push(duration);
    }

    if (answeredBy) {
      updateFields.push('answeredBy = ?3');
      updateParams.push(answeredBy);
    }

    if (callStatus === 'in-progress') {
      updateFields.push('answeredAtMs = ?4');
      updateParams.push(now);
    }

    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      updateFields.push('endedAtMs = ?5');
      updateParams.push(now);
    }

    updateParams.push(callSid);

    await dbRun(
      env.DB,
      `UPDATE comm_calls SET ${updateFields.join(', ')} WHERE twilioCallSid = ?${updateParams.length}`,
      updateParams
    ).catch(() => {});

    // If no existing record, create one
    if (callerIdentity) {
      await dbRun(
        env.DB,
        `INSERT OR IGNORE INTO comm_calls (userId, direction, fromE164, toE164, twilioCallSid, status, createdAtMs)
         VALUES (?1, 'outbound', ?2, ?3, ?4, ?5, ?6)`,
        [callerIdentity, from, to, callSid, callStatus, now]
      ).catch(() => {});
    }
  }

  // Return empty TwiML (acknowledged)
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'application/xml' }
  });
}

/**
 * POST /v1/twilio/recording/status
 *
 * Webhook called by Twilio when recording status changes.
 */
export async function twilioRecordingStatus(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const valid = await verifyTwilioSignature(req, env);
  if (!valid) {
    return new Response('Invalid signature', { status: 403 });
  }

  const params = await parseFormBody(req);

  const recordingSid = params.RecordingSid;
  const recordingStatus = params.RecordingStatus; // in-progress|completed|absent|failed
  const recordingUrl = params.RecordingUrl;
  const recordingDuration = params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : null;
  const callSid = params.CallSid;

  const now = Date.now();

  if (!recordingSid || !callSid) {
    return new Response('Missing required parameters', { status: 400 });
  }

  // Update call record with recording info
  await dbRun(
    env.DB,
    `UPDATE comm_calls SET
       recordingSid = ?1,
       recordingDurationSeconds = ?2
     WHERE twilioCallSid = ?3`,
    [recordingSid, recordingDuration, callSid]
  ).catch(() => {});

  // If recording is complete, optionally download and store in R2
  if (recordingStatus === 'completed' && recordingUrl && env.BLOBS) {
    // Queue async download to R2 (don't block webhook response)
    // In production, you'd use a queue or durable object for this

    // For now, just store that recording is available
    // The actual download would be done by a separate process
    const r2Key = `recordings/${callSid}/${recordingSid}.wav`;

    await dbRun(
      env.DB,
      `UPDATE comm_calls SET recordingUrl = ?1 WHERE twilioCallSid = ?2`,
      [r2Key, callSid]
    ).catch(() => {});
  }

  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'application/xml' }
  });
}

/**
 * POST /v1/twilio/voice/incoming
 *
 * Webhook called by Twilio for incoming calls.
 */
export async function twilioVoiceIncoming(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const valid = await verifyTwilioSignature(req, env);
  if (!valid) {
    return new Response('Invalid signature', { status: 403 });
  }

  const params = await parseFormBody(req);

  const callSid = params.CallSid;
  const from = params.From;
  const to = params.To;
  const called = params.Called;

  // Look up which user owns this number
  const numberOwner = await dbFirst<{ userId: string }>(
    env.DB,
    'SELECT userId FROM comm_numbers WHERE e164 = ?1 AND status = ?2',
    [to, 'active']
  );

  if (!numberOwner) {
    // No owner found, reject call
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">The number you have called is not available.</Say>
  <Hangup/>
</Response>`, {
      headers: { 'Content-Type': 'application/xml' }
    });
  }

  const userId = numberOwner.userId;

  // Check recording consent
  const consent = await dbFirst<{ callRecordingEnabled: number }>(
    env.DB,
    'SELECT callRecordingEnabled FROM comm_recording_consent WHERE userId = ?1',
    [userId]
  );
  const recordingEnabled = consent?.callRecordingEnabled === 1;

  // Log incoming call
  const now = Date.now();
  await dbRun(
    env.DB,
    `INSERT INTO comm_calls (userId, direction, fromE164, toE164, twilioCallSid, status, recordingEnabled, createdAtMs)
     VALUES (?1, 'inbound', ?2, ?3, ?4, 'ringing', ?5, ?6)`,
    [userId, from, to, callSid, recordingEnabled ? 1 : 0, now]
  ).catch(() => {});

  // Build TwiML to forward to user's client
  const recordAttribute = recordingEnabled
    ? 'record="record-from-answer-dual"'
    : 'record="do-not-record"';

  const announcement = recordingEnabled
    ? '<Say voice="alice">This call is being recorded.</Say>'
    : '';

  // Connect to user's Twilio client
  const identity = `orion:${userId}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${announcement}
  <Dial ${recordAttribute} recordingStatusCallback="${new URL('/v1/twilio/recording/status', req.url).toString()}">
    <Client>${identity}</Client>
  </Dial>
</Response>`;

  return new Response(twiml, {
    headers: { 'Content-Type': 'application/xml' }
  });
}
