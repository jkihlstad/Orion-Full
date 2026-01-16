/**
 * Registry loader and policy accessor
 * Window 26: Registry-driven enforcement for Orion edge-gateway
 *
 * Loads eventType policies and blobPurpose policies from registry.
 * The registry is the SINGLE SOURCE OF TRUTH for all enforcement rules.
 *
 * Key principle: No hardcoded rules in the worker. All enforcement comes from registry.
 */

// ============================================================================
// Type Definitions (matching suite-contracts registry format)
// ============================================================================

export type PrivacyScope = "private" | "social" | "public";
export type Sensitivity = "low" | "med" | "high";

export interface EventTypePolicy {
  enabled: boolean;
  /** Human-readable description of this event type */
  description?: string;
  /** Sensitivity level for UI styling and audit */
  sensitivity?: Sensitivity;
  /** Legacy consent scope (single scope) */
  consentScope: string;
  /** Required consent scopes (array, takes precedence over consentScope) */
  requiredScopes?: string[];
  defaultPrivacyScope: PrivacyScope;
  allowSocial?: boolean;
  redactKeys?: string[];
  requiresBlob?: boolean;
  brainEnabled?: boolean;
  /** Top-level graphRequired (legacy) */
  graphRequired?: boolean;
  /** Brain-specific settings (new format) */
  brain?: {
    enabled?: boolean;
    graphRequired?: boolean;
  };
  notes?: string;
}

export interface BlobPurposePolicy {
  /** Human-readable description */
  description: string;
  /** Allowed MIME types for this purpose */
  allowedContentTypes: string[];
  /** Maximum file size in bytes */
  maxBytes: number;
  /** Required consent scopes for this blob purpose */
  requiredScopes?: string[];
  /** Whether this purpose is enabled (optional, defaults to true) */
  enabled?: boolean;
  /** Legacy alias for allowedContentTypes */
  allowedTypes?: string[];
}

export interface RegistryFile {
  version: string;
  notes?: string;
  eventTypes: Record<string, EventTypePolicy>;
  blobPurposes?: Record<string, BlobPurposePolicy>;
}

// ============================================================================
// Blob Validation Types
// ============================================================================

export interface BlobValidationSuccess {
  ok: true;
  purpose: string;
  policy: BlobPurposePolicy;
}

export interface BlobValidationError {
  ok: false;
  error: string;
  code: "UNKNOWN_PURPOSE" | "PURPOSE_DISABLED" | "INVALID_CONTENT_TYPE" | "FILE_TOO_LARGE";
}

export type BlobValidationResult = BlobValidationSuccess | BlobValidationError;

// ============================================================================
// Registry Loading
// ============================================================================

// Import vendored registry (synced from suite-contracts)
// This is loaded at build time for optimal performance
// Primary: contracts/registry.json (Window 26 format with blobPurposes)
// Fallback: vendor/suite-contracts/registry/registry.json
import contractsRegistry from "../contracts/registry.json";
import vendorRegistry from "../../vendor/suite-contracts/registry/registry.json";

let cachedRegistry: RegistryFile | null = null;

/**
 * Load and cache the registry
 * Returns the validated registry file
 *
 * Priority:
 * 1. contracts/registry.json (Window 26 format - includes blobPurposes)
 * 2. vendor/suite-contracts/registry/registry.json (fallback)
 */
export function loadRegistry(): RegistryFile {
  if (cachedRegistry) return cachedRegistry;

  // Use contracts registry as primary (Window 26 format)
  // Falls back to vendor registry if contracts doesn't have what we need
  const registry = contractsRegistry as RegistryFile;

  // Basic validation
  if (!registry.version || typeof registry.version !== "string") {
    throw new Error("Invalid registry: missing or invalid version");
  }

  if (!registry.eventTypes || typeof registry.eventTypes !== "object") {
    throw new Error("Invalid registry: missing or invalid eventTypes");
  }

  cachedRegistry = registry;
  return cachedRegistry;
}

/**
 * Load the vendor registry (for eventTypes that might only be in vendor)
 */
export function loadVendorRegistry(): RegistryFile {
  return vendorRegistry as RegistryFile;
}

/**
 * Clear the cached registry (useful for testing)
 */
export function clearRegistryCache(): void {
  cachedRegistry = null;
}

// ============================================================================
// Policy Accessors
// ============================================================================

/**
 * Get the policy for a specific eventType
 * Returns null if eventType is not found
 */
export function getPolicy(eventType: string): EventTypePolicy | null {
  const registry = loadRegistry();
  return registry.eventTypes[eventType] ?? null;
}

/**
 * Check if an eventType exists in the registry
 */
export function isValidEventType(eventType: string): boolean {
  const registry = loadRegistry();
  return eventType in registry.eventTypes;
}

/**
 * Check if an eventType is enabled
 * Returns false if eventType doesn't exist or is disabled
 */
export function isEventTypeEnabled(eventType: string): boolean {
  const policy = getPolicy(eventType);
  return policy?.enabled ?? false;
}

/**
 * Check if brain processing is enabled for an eventType
 * Returns false if eventType doesn't exist or brain is disabled
 * Checks both brain.enabled (new format) and top-level brainEnabled (legacy)
 */
export function isBrainEnabled(eventType: string): boolean {
  const policy = getPolicy(eventType);
  if (!policy) return false;
  // Prefer brain.enabled (new format), fall back to brainEnabled (legacy)
  return policy.brain?.enabled ?? policy.brainEnabled ?? false;
}

/**
 * Check if graph processing is required for an eventType
 * Returns false if eventType doesn't exist or graphRequired is not set
 * Checks both brain.graphRequired (new format) and top-level graphRequired (legacy)
 */
export function isGraphRequired(eventType: string): boolean {
  const policy = getPolicy(eventType);
  if (!policy) return false;
  // Prefer brain.graphRequired (new format), fall back to top-level (legacy)
  return policy.brain?.graphRequired ?? policy.graphRequired ?? false;
}

/**
 * Get the required consent scope for an eventType
 * Returns null if eventType doesn't exist
 */
export function getRequiredConsentScope(eventType: string): string | null {
  const policy = getPolicy(eventType);
  return policy?.consentScope ?? null;
}

/**
 * Get the default privacy scope for an eventType
 * Returns "private" as a safe default if eventType doesn't exist
 */
export function getDefaultPrivacyScope(eventType: string): PrivacyScope {
  const policy = getPolicy(eventType);
  return policy?.defaultPrivacyScope ?? "private";
}

/**
 * Get the keys to redact for an eventType
 * Returns empty array if eventType doesn't exist or has no redact keys
 */
export function getRedactKeys(eventType: string): string[] {
  const policy = getPolicy(eventType);
  return policy?.redactKeys ?? [];
}

/**
 * Check if an eventType allows social forwarding
 * Returns false if eventType doesn't exist or social is not allowed
 */
export function allowsSocialForward(eventType: string): boolean {
  const policy = getPolicy(eventType);
  return policy?.allowSocial ?? false;
}

/**
 * Check if an eventType requires blob attachment
 * Returns false if eventType doesn't exist or blob is not required
 */
export function requiresBlob(eventType: string): boolean {
  const policy = getPolicy(eventType);
  return policy?.requiresBlob ?? false;
}

/**
 * Get the registry version
 */
export function getRegistryVersion(): string {
  const registry = loadRegistry();
  return registry.version;
}

/**
 * Get all valid event types
 */
export function getAllEventTypes(): string[] {
  const registry = loadRegistry();
  return Object.keys(registry.eventTypes);
}

/**
 * Get all enabled event types
 */
export function getEnabledEventTypes(): string[] {
  const registry = loadRegistry();
  return Object.entries(registry.eventTypes)
    .filter(([_, policy]) => policy.enabled)
    .map(([eventType]) => eventType);
}

// ============================================================================
// Window 26: New Accessor Functions for Registry-Driven Enforcement
// ============================================================================

/**
 * Get required consent scopes for an eventType
 * Returns array of scope strings (uses requiredScopes if present, else wraps consentScope)
 *
 * This is the PRIMARY function for consent enforcement.
 */
export function getRequiredScopes(eventType: string): string[] {
  const policy = getPolicy(eventType);
  if (!policy) return [];

  // If requiredScopes is defined and non-empty, use it
  if (policy.requiredScopes && policy.requiredScopes.length > 0) {
    return policy.requiredScopes;
  }

  // Fall back to legacy consentScope (wrap in array)
  if (policy.consentScope) {
    return [policy.consentScope];
  }

  return [];
}

/**
 * Get the sensitivity level for an eventType
 * Returns "low" as safe default if not specified
 */
export function getSensitivity(eventType: string): Sensitivity {
  const policy = getPolicy(eventType);
  return policy?.sensitivity ?? "low";
}

/**
 * Get the description for an eventType
 * Returns empty string if not found
 */
export function getDescription(eventType: string): string {
  const policy = getPolicy(eventType);
  return policy?.description ?? "";
}

// ============================================================================
// Blob Purpose Accessors
// ============================================================================

/**
 * Get the blob purpose policy
 * Returns undefined if purpose is not found
 */
export function getBlobPurpose(purpose: string): BlobPurposePolicy | undefined {
  const registry = loadRegistry();
  return registry.blobPurposes?.[purpose];
}

/**
 * Check if a blob purpose is valid (exists in registry)
 */
export function isValidBlobPurpose(purpose: string): boolean {
  const registry = loadRegistry();
  return purpose in (registry.blobPurposes ?? {});
}

/**
 * Check if a blob purpose is enabled
 * Defaults to true if enabled is not specified
 */
export function isBlobPurposeEnabled(purpose: string): boolean {
  const policy = getBlobPurpose(purpose);
  if (!policy) return false;
  return policy.enabled ?? true;
}

/**
 * Get all valid blob purposes
 */
export function getAllBlobPurposes(): string[] {
  const registry = loadRegistry();
  return Object.keys(registry.blobPurposes ?? {});
}

/**
 * Validate a blob request against registry rules
 *
 * Checks:
 * 1. Purpose exists in registry
 * 2. Purpose is enabled
 * 3. Content type is allowed for this purpose
 * 4. Size is within limits
 *
 * Returns ValidationResult with policy on success, error details on failure.
 */
export function validateBlobRequest(
  purpose: string,
  contentType: string,
  sizeBytes: number
): BlobValidationResult {
  const policy = getBlobPurpose(purpose);

  // Check if purpose exists
  if (!policy) {
    return {
      ok: false,
      error: `Unknown blob purpose: ${purpose}. Valid purposes: ${getAllBlobPurposes().join(", ")}`,
      code: "UNKNOWN_PURPOSE",
    };
  }

  // Check if purpose is enabled (defaults to true if not specified)
  if (policy.enabled === false) {
    return {
      ok: false,
      error: `Blob purpose "${purpose}" is disabled`,
      code: "PURPOSE_DISABLED",
    };
  }

  // Check content type (support both allowedContentTypes and legacy allowedTypes)
  const allowedTypes = policy.allowedContentTypes ?? policy.allowedTypes ?? [];
  if (!allowedTypes.includes(contentType)) {
    return {
      ok: false,
      error: `Content type "${contentType}" not allowed for purpose "${purpose}". Allowed: ${allowedTypes.join(", ")}`,
      code: "INVALID_CONTENT_TYPE",
    };
  }

  // Check size
  if (sizeBytes > policy.maxBytes) {
    const maxMB = (policy.maxBytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `File size ${sizeBytes} bytes exceeds limit of ${policy.maxBytes} bytes (${maxMB} MB) for purpose "${purpose}"`,
      code: "FILE_TOO_LARGE",
    };
  }

  return {
    ok: true,
    purpose,
    policy,
  };
}

/**
 * Get required consent scopes for a blob purpose
 */
export function getBlobPurposeScopes(purpose: string): string[] {
  const policy = getBlobPurpose(purpose);
  return policy?.requiredScopes ?? [];
}
