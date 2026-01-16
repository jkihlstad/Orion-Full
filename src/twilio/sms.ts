/**
 * SMS Webhook Handlers
 * Handles inbound SMS messages and outbound SMS status callbacks from Twilio
 */

import { Env } from "../env";
import { createLogger } from "../utils/logger";

const logger = createLogger({ module: "twilio/sms" });

/**
 * Parsed inbound SMS message from Twilio webhook
 */
interface InboundSmsMessage {
  messageSid: string;
  accountSid: string;
  from: string;
  to: string;
  body: string;
  numMedia: number;
  mediaUrls: string[];
  mediaContentTypes: string[];
  fromCity?: string;
  fromState?: string;
  fromZip?: string;
  fromCountry?: string;
  toCity?: string;
  toState?: string;
  toZip?: string;
  toCountry?: string;
}

/**
 * Parsed outbound SMS status update from Twilio webhook
 */
interface SmsStatusUpdate {
  messageSid: string;
  accountSid: string;
  messageStatus: "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed";
  to: string;
  from?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Parse application/x-www-form-urlencoded body from Twilio webhook
 */
async function parseFormBody(req: Request): Promise<URLSearchParams> {
  const text = await req.text();
  return new URLSearchParams(text);
}

/**
 * Generate TwiML XML response
 */
function twiml(content: string = ""): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${content}</Response>`;
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml",
    },
  });
}

/**
 * Parse inbound SMS data from form parameters
 */
function parseInboundSms(params: URLSearchParams): InboundSmsMessage {
  const numMedia = parseInt(params.get("NumMedia") || "0", 10);
  const mediaUrls: string[] = [];
  const mediaContentTypes: string[] = [];

  // Parse media attachments (MMS)
  for (let i = 0; i < numMedia; i++) {
    const url = params.get(`MediaUrl${i}`);
    const contentType = params.get(`MediaContentType${i}`);
    if (url) mediaUrls.push(url);
    if (contentType) mediaContentTypes.push(contentType);
  }

  return {
    messageSid: params.get("MessageSid") || "",
    accountSid: params.get("AccountSid") || "",
    from: params.get("From") || "",
    to: params.get("To") || "",
    body: params.get("Body") || "",
    numMedia,
    mediaUrls,
    mediaContentTypes,
    fromCity: params.get("FromCity") || undefined,
    fromState: params.get("FromState") || undefined,
    fromZip: params.get("FromZip") || undefined,
    fromCountry: params.get("FromCountry") || undefined,
    toCity: params.get("ToCity") || undefined,
    toState: params.get("ToState") || undefined,
    toZip: params.get("ToZip") || undefined,
    toCountry: params.get("ToCountry") || undefined,
  };
}

/**
 * Parse outbound SMS status update from form parameters
 */
function parseSmsStatus(params: URLSearchParams): SmsStatusUpdate {
  return {
    messageSid: params.get("MessageSid") || "",
    accountSid: params.get("AccountSid") || "",
    messageStatus: (params.get("MessageStatus") || "sent") as SmsStatusUpdate["messageStatus"],
    to: params.get("To") || "",
    from: params.get("From") || undefined,
    errorCode: params.get("ErrorCode") || undefined,
    errorMessage: params.get("ErrorMessage") || undefined,
  };
}

/**
 * Handle inbound SMS webhook from Twilio
 * POST /twilio/sms/inbound
 *
 * Called when an SMS is received on a purchased Twilio number.
 * Parses the message data and acknowledges receipt with empty TwiML.
 *
 * TODO: Integrate with Twilio Conversations or emit events to backend
 */
export async function handleSmsInbound(
  req: Request,
  env: Env
): Promise<Response> {
  try {
    const params = await parseFormBody(req);
    const message = parseInboundSms(params);

    // Log the inbound message for debugging
    logger.info("Inbound SMS received", {
      messageSid: message.messageSid,
      from: message.from,
      to: message.to,
      bodyLength: message.body.length,
      numMedia: message.numMedia,
    });

    // TODO: Future integrations:
    // 1. Look up the user associated with the 'to' number
    // 2. Create or update a Twilio Conversation
    // 3. Emit event to Convex for message storage and processing
    // 4. Trigger any automated responses or AI processing

    // Return empty TwiML to acknowledge receipt without auto-reply
    return twiml();
  } catch (err: unknown) {
    logger.error("Error processing inbound SMS", err instanceof Error ? err : null);
    // Still return 200 with empty TwiML to prevent Twilio retries
    return twiml();
  }
}

/**
 * Handle outbound SMS status callback from Twilio
 * POST /twilio/sms/status
 *
 * Called when an outbound SMS status changes (sent, delivered, failed, etc.).
 * Logs the status update and returns 200 OK.
 *
 * TODO: Update message status in database, emit events for failed deliveries
 */
export async function handleSmsStatus(
  req: Request,
  env: Env
): Promise<Response> {
  try {
    const params = await parseFormBody(req);
    const status = parseSmsStatus(params);

    // Log the status update
    logger.info("SMS status update received", {
      messageSid: status.messageSid,
      status: status.messageStatus,
      to: status.to,
      errorCode: status.errorCode,
      errorMessage: status.errorMessage,
    });

    // Handle failed messages
    if (status.messageStatus === "failed" || status.messageStatus === "undelivered") {
      logger.error("SMS delivery failed", null, {
        messageSid: status.messageSid,
        to: status.to,
        errorCode: status.errorCode,
        errorMessage: status.errorMessage,
      });

      // TODO: Future integrations:
      // 1. Update message status in database
      // 2. Emit failure event to backend
      // 3. Notify user of delivery failure
    }

    // TODO: Future integrations for successful delivery:
    // 1. Update message status in database
    // 2. Emit delivery confirmation event

    // Return 200 OK
    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (err: unknown) {
    logger.error("Error processing SMS status", err instanceof Error ? err : null);
    // Still return 200 to prevent Twilio retries
    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
}
