/**
 * Phone Numbers Management
 * List and manage user's Twilio phone numbers
 */

import { Env } from "../env";
import { json } from "../utils/respond";

interface PhoneNumber {
  id: string;
  e164Last4: string;
  friendlyName: string;
  capabilities: {
    sms: boolean;
    mms: boolean;
    voice: boolean;
  };
  isDefault: boolean;
  purchasedAt?: number;
}

interface NumbersListResponse {
  ok: boolean;
  numbers: PhoneNumber[];
  defaultNumberId?: string;
}

export async function handleNumbersList(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // TODO: Query database or Twilio API for user's phone numbers
  // For now, return empty list

  const response: NumbersListResponse = {
    ok: true,
    numbers: [],
    defaultNumberId: undefined,
  };

  // In production, you would:
  // 1. Query your database for numbers associated with this user
  // 2. Optionally sync with Twilio's API
  // 3. Return the list with redacted phone numbers (last 4 only)

  return json(response, 200);
}

export async function handleNumberPurchase(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // Phone number purchase requires billing integration
  return json({
    ok: false,
    error: "not_implemented",
    message: "Number purchase requires billing setup. Contact support."
  }, 501);
}

export async function handleNumberSetDefault(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  let body: { numberId: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!body.numberId) {
    return json({ ok: false, error: "missing_number_id" }, 400);
  }

  // TODO: Update default number in database
  // For now, return success stub
  return json({ ok: true, defaultNumberId: body.numberId }, 200);
}
