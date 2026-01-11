/**
 * Redact sensitive fields from event payloads before storage.
 * Uses registry.json redactKeys when available.
 */

// Default redact keys (conservative baseline)
const DEFAULT_REDACT_KEYS = [
  "pan",
  "cardNumber",
  "accountNumber",
  "routingNumber",
  "access_token",
  "public_token",
  "secret",
  "password",
  "ssn",
  "dob",
  "item_id",
  "phoneNumber",
  "messageBody",
  "transcription",
  "audioData",
  "formData",
  "inputValue",
  "keyData",
];

export function redactPayload(
  payload: Record<string, any>,
  additionalRedactKeys: string[] = []
): Record<string, any> {
  const clone = structuredClone(payload);
  const redactKeys = new Set([...DEFAULT_REDACT_KEYS, ...additionalRedactKeys]);

  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (redactKeys.has(k)) {
        obj[k] = "[REDACTED]";
      } else if (typeof v === "string" && k.toLowerCase().includes("account") && v.length > 6) {
        obj[k] = v.slice(-4).padStart(v.length, "*"); // keep last4
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  }

  walk(clone);
  return clone;
}
