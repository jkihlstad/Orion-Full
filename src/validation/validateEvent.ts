/**
 * Enhanced event validation with registry integration
 * Validates events against the suite-contracts registry
 */

import { EventEnvelopeT } from "../types";
import {
  isValidEventType,
  isEventTypeEnabled,
  getPolicy,
  getRequiredConsentScope,
  requiresBlob,
} from "./registry";

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  expected?: unknown;
  received?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// Error codes for fast programmatic handling
export const ValidationErrorCodes = {
  UNKNOWN_EVENT_TYPE: "UNKNOWN_EVENT_TYPE",
  EVENT_TYPE_DISABLED: "EVENT_TYPE_DISABLED",
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  MISSING_BLOB_REF: "MISSING_BLOB_REF",
  CONSENT_SCOPE_MISMATCH: "CONSENT_SCOPE_MISMATCH",
} as const;

// ============================================================================
// Schema Validation (optional JSON schema support)
// ============================================================================

// Schema cache for performance
const schemaCache = new Map<string, object>();

/**
 * Load a JSON schema for an event type (if available)
 * Schemas are loaded from vendor/suite-contracts/schemas/
 */
async function loadSchema(eventType: string): Promise<object | null> {
  // Check cache first
  if (schemaCache.has(eventType)) {
    return schemaCache.get(eventType) ?? null;
  }

  try {
    // Convert eventType to filename: "browser.page_viewed" -> "browser.page_viewed.json"
    const schemaPath = `../../vendor/suite-contracts/schemas/${eventType}.json`;

    // Dynamic import for optional schemas
    // In Cloudflare Workers, this would need to be bundled at build time
    // For now, schemas are optional and this is a placeholder
    const schema = await import(schemaPath).catch(() => null);

    if (schema) {
      schemaCache.set(eventType, schema);
      return schema;
    }
  } catch {
    // Schema not found, which is fine - schemas are optional
  }

  schemaCache.set(eventType, null as unknown as object);
  return null;
}

/**
 * Validate payload against JSON schema (if available)
 */
async function validatePayloadSchema(
  eventType: string,
  payload: Record<string, unknown>
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  const schema = await loadSchema(eventType);
  if (!schema) {
    // No schema available, skip validation
    return errors;
  }

  // Basic JSON schema validation
  // For production, use a proper JSON schema validator like Ajv
  // This is a simplified implementation for now
  try {
    // Placeholder for actual schema validation
    // In production, you would use:
    // import Ajv from "ajv";
    // const ajv = new Ajv();
    // const validate = ajv.compile(schema);
    // if (!validate(payload)) {
    //   for (const error of validate.errors ?? []) {
    //     errors.push({
    //       code: ValidationErrorCodes.SCHEMA_VALIDATION_FAILED,
    //       message: error.message ?? "Schema validation failed",
    //       field: error.instancePath,
    //     });
    //   }
    // }
  } catch (e) {
    errors.push({
      code: ValidationErrorCodes.SCHEMA_VALIDATION_FAILED,
      message: `Schema validation error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return errors;
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate an event envelope against the registry
 *
 * @param envelope - The event envelope to validate
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 */
export async function validateEvent(
  envelope: EventEnvelopeT,
  options: {
    validateSchema?: boolean;
    strictConsentScope?: boolean;
  } = {}
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const { eventType } = envelope;

  // 1. Check if eventType exists in registry
  if (!isValidEventType(eventType)) {
    errors.push({
      code: ValidationErrorCodes.UNKNOWN_EVENT_TYPE,
      message: `Unknown event type: ${eventType}. This event type is not registered in suite-contracts.`,
      field: "eventType",
      received: eventType,
    });

    // Early return - can't validate further without a valid eventType
    return { valid: false, errors, warnings };
  }

  // 2. Check if eventType is enabled
  if (!isEventTypeEnabled(eventType)) {
    errors.push({
      code: ValidationErrorCodes.EVENT_TYPE_DISABLED,
      message: `Event type is disabled: ${eventType}. This event type is registered but currently disabled.`,
      field: "eventType",
      received: eventType,
    });

    return { valid: false, errors, warnings };
  }

  // 3. Get the policy for additional validations
  const policy = getPolicy(eventType);
  if (!policy) {
    // This shouldn't happen if isValidEventType returned true
    errors.push({
      code: ValidationErrorCodes.UNKNOWN_EVENT_TYPE,
      message: `Failed to load policy for event type: ${eventType}`,
      field: "eventType",
    });
    return { valid: false, errors, warnings };
  }

  // 4. Validate consent scope (optional strict mode)
  if (options.strictConsentScope) {
    const requiredScope = getRequiredConsentScope(eventType);
    if (requiredScope && envelope.consentScope !== requiredScope) {
      warnings.push({
        code: ValidationErrorCodes.CONSENT_SCOPE_MISMATCH,
        message: `Consent scope mismatch. Expected: ${requiredScope}, received: ${envelope.consentScope ?? "(none)"}`,
        field: "consentScope",
        expected: requiredScope,
        received: envelope.consentScope,
      });
    }
  }

  // 5. Validate blob requirement
  if (requiresBlob(eventType)) {
    const hasBlobRefs = envelope.blobRefs && envelope.blobRefs.length > 0;
    if (!hasBlobRefs) {
      errors.push({
        code: ValidationErrorCodes.MISSING_BLOB_REF,
        message: `Event type ${eventType} requires blob attachment(s), but none were provided.`,
        field: "blobRefs",
      });
    }
  }

  // 6. Validate payload schema (if enabled)
  if (options.validateSchema !== false) {
    const schemaErrors = await validatePayloadSchema(eventType, envelope.payload);
    errors.push(...schemaErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Synchronous validation for fast-path checks
 * Only validates eventType existence and enabled status
 */
export function validateEventSync(envelope: EventEnvelopeT): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const { eventType } = envelope;

  // 1. Check if eventType exists in registry
  if (!isValidEventType(eventType)) {
    errors.push({
      code: ValidationErrorCodes.UNKNOWN_EVENT_TYPE,
      message: `Unknown event type: ${eventType}`,
      field: "eventType",
      received: eventType,
    });
    return { valid: false, errors, warnings };
  }

  // 2. Check if eventType is enabled
  if (!isEventTypeEnabled(eventType)) {
    errors.push({
      code: ValidationErrorCodes.EVENT_TYPE_DISABLED,
      message: `Event type is disabled: ${eventType}`,
      field: "eventType",
      received: eventType,
    });
    return { valid: false, errors, warnings };
  }

  // 3. Validate blob requirement
  if (requiresBlob(eventType)) {
    const hasBlobRefs = envelope.blobRefs && envelope.blobRefs.length > 0;
    if (!hasBlobRefs) {
      errors.push({
        code: ValidationErrorCodes.MISSING_BLOB_REF,
        message: `Event type ${eventType} requires blob attachment(s)`,
        field: "blobRefs",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for API response
 */
export function formatValidationErrors(result: ValidationResult): {
  error: string;
  code: string;
  details: ValidationError[];
} {
  const primaryError = result.errors[0];
  return {
    error: primaryError?.message ?? "Validation failed",
    code: primaryError?.code ?? "VALIDATION_FAILED",
    details: result.errors,
  };
}
