/**
 * Twilio Voice Webhooks
 * Handles inbound/outbound calls, status callbacks, and recording events
 */

import { Env } from "../env";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "twilio/voice" });

// Base URL for recording status callback
const GATEWAY_BASE_URL = "https://gateway.orionsuite.app";

/**
 * Parse application/x-www-form-urlencoded body
 */
async function parseFormBody(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  return new URLSearchParams(text);
}

/**
 * Return a TwiML response with proper XML content type
 */
function twiml(xml: string, status = 200): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

/**
 * Handle outbound voice calls from the iOS app
 * POST /twilio/voice/outbound
 *
 * Called when making outbound calls via the Twilio Client SDK
 * Returns TwiML to dial either a client identity or PSTN number
 */
export async function handleVoiceOutbound(
  req: Request,
  env: Env
): Promise<Response> {
  const form = await parseFormBody(req);

  const to = form.get("To") || "";
  const from = form.get("From") || "";
  const callSid = form.get("CallSid") || "";
  const userId = form.get("userId") || "";

  logger.info("Voice outbound request received", {
    to,
    from,
    callSid,
    userId,
  });

  // Check if dialing a Twilio Client identity (e.g., client:user_123)
  if (to.startsWith("client:")) {
    const clientIdentity = to.replace("client:", "");
    return twiml(`<Response>
  <Dial callerId="${escapeXml(from)}">
    <Client>${escapeXml(clientIdentity)}</Client>
  </Dial>
</Response>`);
  }

  // Dialing a PSTN number - enable recording
  const recordingCallback = `${GATEWAY_BASE_URL}/twilio/voice/recording`;

  return twiml(`<Response>
  <Dial callerId="${escapeXml(from)}" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}">
    <Number>${escapeXml(to)}</Number>
  </Dial>
</Response>`);
}

/**
 * Handle voice fallback (called if main voice URL fails)
 * POST /twilio/voice/fallback
 *
 * Returns a simple error message and hangs up
 */
export async function handleVoiceFallback(
  req: Request,
  env: Env
): Promise<Response> {
  logger.error("Voice fallback triggered - main voice URL failed", null);

  return twiml(`<Response>
  <Say>We're sorry, an error occurred. Please try again later.</Say>
  <Hangup/>
</Response>`);
}

/**
 * Handle voice status events
 * POST /twilio/voice/status
 *
 * Receives call status events: initiated, ringing, answered, completed
 * Currently just logs the event; in the future could emit to event ingest
 */
export async function handleVoiceStatus(
  req: Request,
  env: Env
): Promise<Response> {
  const form = await parseFormBody(req);

  const callSid = form.get("CallSid") || "";
  const callStatus = form.get("CallStatus") || "";
  const duration = form.get("CallDuration") || form.get("Duration") || "";
  const from = form.get("From") || "";
  const to = form.get("To") || "";
  const direction = form.get("Direction") || "";
  const timestamp = form.get("Timestamp") || new Date().toISOString();

  logger.info("Voice status event received", {
    callSid,
    callStatus,
    duration,
    from,
    to,
    direction,
    timestamp,
  });

  // TODO: In the future, emit this to the event ingest system
  // await env.FANOUT_QUEUE.send({
  //   eventType: "voice.call.status",
  //   callSid,
  //   callStatus,
  //   duration,
  //   ...
  // });

  // Return 200 OK with empty body
  return new Response(null, { status: 200 });
}

/**
 * Handle recording status events
 * POST /twilio/voice/recording
 *
 * Called when a recording is ready for download
 * Currently logs the event; would trigger archiving in production
 */
export async function handleRecordingStatus(
  req: Request,
  env: Env
): Promise<Response> {
  const form = await parseFormBody(req);

  const recordingSid = form.get("RecordingSid") || "";
  const recordingUrl = form.get("RecordingUrl") || "";
  const recordingDuration = form.get("RecordingDuration") || "";
  const callSid = form.get("CallSid") || "";
  const recordingStatus = form.get("RecordingStatus") || "";

  logger.info("Recording status event received", {
    recordingSid,
    recordingUrl,
    recordingDuration,
    callSid,
    recordingStatus,
  });

  // TODO: Trigger archiving of the recording
  // - Download from recordingUrl (add .mp3 or .wav extension)
  // - Upload to R2 storage
  // - Create event record linking recording to call
  // - Delete from Twilio after successful archive

  // Return 200 OK with empty body
  return new Response(null, { status: 200 });
}

/**
 * Handle inbound voice calls to purchased numbers
 * POST /twilio/voice/inbound
 *
 * Routes inbound calls to the user's Twilio Client identity
 */
export async function handleVoiceInbound(
  req: Request,
  env: Env
): Promise<Response> {
  const form = await parseFormBody(req);

  const from = form.get("From") || "";
  const to = form.get("To") || "";
  const callSid = form.get("CallSid") || "";

  logger.info("Voice inbound request received", {
    from,
    to,
    callSid,
  });

  // TODO: Look up which user owns this phone number
  // For now, we need the userId to be passed or looked up from the To number
  // This would query D1 or another store to find the user who owns this number

  // Placeholder: In production, look up the userId from the To number
  // const userId = await lookupUserByPhoneNumber(env, to);
  const userId = form.get("userId") || "";

  if (!userId) {
    logger.error("No userId found for inbound call", null, { to });
    return twiml(`<Response>
  <Say>We're sorry, this number is not configured. Please try again later.</Say>
  <Hangup/>
</Response>`);
  }

  // Dial the user's Twilio Client identity
  return twiml(`<Response>
  <Dial>
    <Client>user_${escapeXml(userId)}</Client>
  </Dial>
</Response>`);
}

/**
 * Escape special XML characters to prevent injection
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
