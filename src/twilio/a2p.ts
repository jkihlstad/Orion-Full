/**
 * A2P 10DLC Registration Status
 * Returns the current A2P registration status for the user
 */

import { Env } from "../env";
import { json } from "../utils/respond";

interface A2PStatus {
  ok: boolean;
  status: "not_started" | "pending" | "approved" | "rejected" | "not_required";
  brandStatus?: string;
  campaignStatus?: string;
  submittedAt?: number;
  approvedAt?: number;
  rejectionReason?: string;
}

export async function handleA2PStatus(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // TODO: Query Twilio A2P API or internal database for registration status
  // For now, return a stub response indicating not started

  const status: A2PStatus = {
    ok: true,
    status: "not_started",
  };

  // In production, you would:
  // 1. Check if user has submitted A2P registration
  // 2. Query Twilio's Trust Hub API for brand/campaign status
  // 3. Return the combined status

  return json(status, 200);
}

export async function handleA2PSubmit(
  req: Request,
  env: Env,
  userId: string
): Promise<Response> {
  // This is a placeholder - A2P submission requires careful implementation
  // with proper KYC data handling
  return json({
    ok: false,
    error: "not_implemented",
    message: "A2P submission requires manual setup. Contact support."
  }, 501);
}
