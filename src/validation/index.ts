/**
 * Validation module exports
 * Integrates with suite-contracts for event type validation
 */

// Registry exports
export {
  loadRegistry,
  clearRegistryCache,
  getPolicy,
  isValidEventType,
  isEventTypeEnabled,
  isBrainEnabled,
  isGraphRequired,
  getRequiredConsentScope,
  getDefaultPrivacyScope,
  getRedactKeys,
  allowsSocialForward,
  requiresBlob,
  getRegistryVersion,
  getAllEventTypes,
  getEnabledEventTypes,
} from "./registry";

export type {
  PrivacyScope,
  EventTypePolicy,
  RegistryFile,
} from "./registry";

// Validation exports
export {
  validateEvent,
  validateEventSync,
  formatValidationErrors,
  ValidationErrorCodes,
} from "./validateEvent";

export type {
  ValidationError,
  ValidationResult,
} from "./validateEvent";
