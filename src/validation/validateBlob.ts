/**
 * Blob Upload Validation
 * Window 23 + Window 26: Purpose-based validation with content type and size restrictions
 *
 * Safety rules enforced:
 * - Whitelist of allowed purposes
 * - Content type restrictions per purpose
 * - Size caps per purpose
 * - Safe extension derivation from contentType (not filename)
 *
 * WINDOW 26 UPDATE:
 * - PURPOSE_RULES is now DEPRECATED
 * - Validation now uses registry.validateBlobRequest() as source of truth
 * - All blob purpose policies come from registry.json blobPurposes section
 */

// ============================================================================
// Purpose Rules Configuration
// ============================================================================

export interface PurposeRule {
  /** Allowed MIME types for this purpose */
  allowedTypes: string[];
  /** Maximum file size in bytes */
  maxBytes: number;
  /** Human-readable description */
  description: string;
}

/**
 * @deprecated WINDOW 26: This hardcoded PURPOSE_RULES is DEPRECATED.
 * Use registry.validateBlobRequest() instead, which reads from registry.json blobPurposes.
 * This map is kept ONLY for backwards compatibility during migration.
 *
 * DO NOT ADD NEW ENTRIES HERE. Add them to registry.json blobPurposes instead.
 */
export const PURPOSE_RULES: Record<string, PurposeRule> = {
  "finance.receipt": {
    allowedTypes: ["image/jpeg", "image/png", "image/heic", "application/pdf"],
    maxBytes: 10 * 1024 * 1024, // 10 MB
    description: "Receipt images and PDFs for finance tracking",
  },
  "browser.screenshot": {
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024, // 5 MB
    description: "Browser page screenshots",
  },
  "email.attachment": {
    allowedTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ],
    maxBytes: 25 * 1024 * 1024, // 25 MB
    description: "Email attachments",
  },
  "calendar.attachment": {
    allowedTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/calendar",
      "application/ics",
    ],
    maxBytes: 10 * 1024 * 1024, // 10 MB
    description: "Calendar event attachments and invites",
  },
  "tasks.attachment": {
    allowedTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "text/plain",
      "application/json",
    ],
    maxBytes: 15 * 1024 * 1024, // 15 MB
    description: "Task attachments",
  },
  "voice.recording": {
    allowedTypes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/m4a",
      "audio/wav",
      "audio/webm",
    ],
    maxBytes: 50 * 1024 * 1024, // 50 MB
    description: "Voice recordings and audio notes",
  },
};

// ============================================================================
// Content Type to Extension Mapping
// ============================================================================

/**
 * Derive file extension from content type.
 * Returns null for unsupported types.
 */
export function deriveExtFromContentType(contentType: string): string | null {
  const map: Record<string, string> = {
    // Images
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",

    // Documents
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/html": "html",
    "application/json": "json",
    "text/csv": "csv",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",

    // Calendar
    "text/calendar": "ics",
    "application/ics": "ics",

    // Audio
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",

    // Video
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };

  return map[contentType] ?? null;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface BlobValidationInput {
  purpose: string;
  contentType: string;
  sizeBytes: number;
  fileName?: string;
  sha256Base64?: string;
}

export interface BlobValidationSuccess {
  ok: true;
  value: {
    purpose: string;
    contentType: string;
    sizeBytes: number;
    fileName?: string;
    sha256Base64?: string;
    extension: string;
    rule: PurposeRule;
  };
}

export interface BlobValidationError {
  ok: false;
  errors: string[];
  code: "INVALID_REQUEST" | "UNSUPPORTED_PURPOSE" | "UNSUPPORTED_CONTENT_TYPE" | "FILE_TOO_LARGE";
}

export type BlobValidationResult = BlobValidationSuccess | BlobValidationError;

// ============================================================================
// Registry-Driven Validation (Window 26)
// ============================================================================

import {
  validateBlobRequest as registryValidateBlobRequest,
  getBlobPurpose,
  getAllBlobPurposes,
  type BlobValidationResult as RegistryBlobValidationResult,
} from "./registry";

/**
 * Validate purpose against registry.
 * This is the new registry-driven validation function.
 *
 * WINDOW 26: This function should be used instead of validateBlobRequest
 * for purpose/contentType/size validation.
 */
export function validatePurpose(
  purpose: string,
  contentType: string,
  sizeBytes: number
): RegistryBlobValidationResult {
  return registryValidateBlobRequest(purpose, contentType, sizeBytes);
}

// ============================================================================
// Validation Function
// ============================================================================

/**
 * Validate a blob upload request against purpose rules.
 * Returns validated input with derived extension, or errors.
 *
 * WINDOW 26: Now uses registry as primary source of truth for purpose validation.
 * Falls back to deprecated PURPOSE_RULES only if registry doesn't have the purpose.
 */
export function validateBlobRequest(body: unknown): BlobValidationResult {
  const errors: string[] = [];

  // Type check
  if (!body || typeof body !== "object") {
    return { ok: false, errors: ["request body must be an object"], code: "INVALID_REQUEST" };
  }

  const input = body as Record<string, unknown>;

  // Extract and validate required fields
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  const contentType = typeof input.contentType === "string" ? input.contentType.trim() : "";
  const sizeBytes = typeof input.sizeBytes === "number" ? input.sizeBytes : NaN;
  const fileName = typeof input.fileName === "string" ? input.fileName.trim() : undefined;
  const sha256Base64 = typeof input.sha256Base64 === "string" ? input.sha256Base64.trim() : undefined;

  // Basic validation
  if (!purpose) {
    errors.push("missing required field: purpose");
  }
  if (!contentType) {
    errors.push("missing required field: contentType");
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    errors.push("sizeBytes must be a positive integer");
  }

  if (errors.length > 0) {
    return { ok: false, errors, code: "INVALID_REQUEST" };
  }

  // WINDOW 26: Try registry first (source of truth)
  const registryPolicy = getBlobPurpose(purpose);
  if (registryPolicy) {
    // Use registry validation
    const registryResult = registryValidateBlobRequest(purpose, contentType, sizeBytes);

    if (!registryResult.ok) {
      // Map registry error codes to our error codes
      const codeMap: Record<string, BlobValidationError["code"]> = {
        UNKNOWN_PURPOSE: "UNSUPPORTED_PURPOSE",
        PURPOSE_DISABLED: "UNSUPPORTED_PURPOSE",
        INVALID_CONTENT_TYPE: "UNSUPPORTED_CONTENT_TYPE",
        FILE_TOO_LARGE: "FILE_TOO_LARGE",
      };
      return {
        ok: false,
        errors: [registryResult.error],
        code: codeMap[registryResult.code] ?? "INVALID_REQUEST",
      };
    }

    // Derive extension from contentType (not fileName for safety)
    const extension = deriveExtFromContentType(contentType);
    if (!extension) {
      return {
        ok: false,
        errors: [`cannot derive file extension from contentType: ${contentType}`],
        code: "UNSUPPORTED_CONTENT_TYPE",
      };
    }

    // Build rule from registry policy for backwards compatibility
    const rule: PurposeRule = {
      allowedTypes: registryPolicy.allowedContentTypes ?? registryPolicy.allowedTypes ?? [],
      maxBytes: registryPolicy.maxBytes,
      description: registryPolicy.description,
    };

    return {
      ok: true,
      value: {
        purpose,
        contentType,
        sizeBytes,
        fileName,
        sha256Base64,
        extension,
        rule,
      },
    };
  }

  // FALLBACK: Use deprecated PURPOSE_RULES (for backwards compatibility)
  const rule = PURPOSE_RULES[purpose];
  if (!rule) {
    const allPurposes = [...getAllBlobPurposes(), ...Object.keys(PURPOSE_RULES)];
    const uniquePurposes = [...new Set(allPurposes)];
    return {
      ok: false,
      errors: [`unsupported purpose: ${purpose}. Allowed: ${uniquePurposes.join(", ")}`],
      code: "UNSUPPORTED_PURPOSE",
    };
  }

  // Check content type for this purpose
  if (!rule.allowedTypes.includes(contentType)) {
    return {
      ok: false,
      errors: [`contentType "${contentType}" not allowed for purpose "${purpose}". Allowed: ${rule.allowedTypes.join(", ")}`],
      code: "UNSUPPORTED_CONTENT_TYPE",
    };
  }

  // Check size limit
  if (sizeBytes > rule.maxBytes) {
    const maxMB = (rule.maxBytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      errors: [`file size ${sizeBytes} bytes exceeds limit of ${rule.maxBytes} bytes (${maxMB} MB) for purpose "${purpose}"`],
      code: "FILE_TOO_LARGE",
    };
  }

  // Derive extension from contentType (not fileName for safety)
  const extension = deriveExtFromContentType(contentType);
  if (!extension) {
    return {
      ok: false,
      errors: [`cannot derive file extension from contentType: ${contentType}`],
      code: "UNSUPPORTED_CONTENT_TYPE",
    };
  }

  return {
    ok: true,
    value: {
      purpose,
      contentType,
      sizeBytes,
      fileName,
      sha256Base64,
      extension,
      rule,
    },
  };
}

// ============================================================================
// HTTP Error Helpers
// ============================================================================

/**
 * Get HTTP status code for validation error.
 */
export function getErrorStatusCode(code: BlobValidationError["code"]): number {
  switch (code) {
    case "INVALID_REQUEST":
      return 400;
    case "UNSUPPORTED_PURPOSE":
      return 400;
    case "UNSUPPORTED_CONTENT_TYPE":
      return 415; // Unsupported Media Type
    case "FILE_TOO_LARGE":
      return 413; // Payload Too Large
    default:
      return 400;
  }
}
