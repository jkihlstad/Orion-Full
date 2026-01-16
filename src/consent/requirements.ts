/**
 * Event Requirements Module
 * Window 51: Gateway auto-enforcement layer for consent and graph requirements
 *
 * This module loads event_requirements.json and provides type-safe access
 * to per-event consent requirements, graph flags, and PII risk levels.
 *
 * Usage:
 *   import { getRequirements, getRequirementsVersion } from "./consent/requirements";
 *
 *   const reqs = getRequirements("browser.page_visited");
 *   if (reqs.graphRequired) {
 *     // Route to Brain/Neo4j
 *   }
 *
 * The event_requirements.json is synced from suite-contracts by:
 *   orion-test-harness/scripts/sync_contracts_into_worker.sh
 */

import reqs from "../contracts/event_requirements.json";

// ============================================================================
// Types
// ============================================================================

/**
 * PII risk level for an event type.
 * - low: No PII or minimal risk (e.g., system events)
 * - medium: Contains some identifiable data (e.g., URLs, timestamps)
 * - high: Contains sensitive PII (e.g., transactions, emails)
 * - very_high: Contains highly sensitive data (e.g., SSN, credit reports)
 */
export type PIIRiskLevel = "low" | "medium" | "high" | "very_high";

/**
 * Per-event requirements for consent and processing.
 */
export interface EventRequirements {
  /** Consent scopes required to accept this event */
  requiredScopes: string[];
  /** Whether this event should be routed to Brain/Neo4j */
  graphRequired?: boolean;
  /** PII risk level for this event type */
  piiRisk?: PIIRiskLevel;
  /** Payload keys that should be redacted before storage */
  redaction?: string[];
  /** Notes about this event type */
  notes?: string;
}

/**
 * Consent scope definition.
 */
export interface ConsentScopeDefinition {
  description: string;
  uiLabel: string;
  defaultEnabled: boolean;
  piiLevel?: PIIRiskLevel;
}

/**
 * Default requirements for unknown event types.
 */
export interface DefaultRequirements {
  graphRequired: boolean;
  piiRisk: PIIRiskLevel;
  requiredScopes: string[];
}

// ============================================================================
// Type assertion for JSON import
// ============================================================================

interface EventRequirementsJSON {
  version: string;
  defaults: DefaultRequirements;
  eventTypes: Record<string, EventRequirements>;
  scopes: Record<string, ConsentScopeDefinition>;
}

const requirements = reqs as unknown as EventRequirementsJSON;

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the version of the event requirements file.
 */
export function getRequirementsVersion(): string {
  return requirements.version;
}

/**
 * Get requirements for a specific event type.
 *
 * Returns the specific requirements if defined, otherwise returns
 * defaults merged with an empty requirements object.
 *
 * @param eventType - The event type (e.g., "browser.page_visited")
 * @returns EventRequirements with all applicable settings
 */
export function getRequirements(eventType: string): EventRequirements {
  const eventReqs = requirements.eventTypes[eventType];

  if (eventReqs) {
    return {
      requiredScopes: eventReqs.requiredScopes ?? requirements.defaults.requiredScopes,
      graphRequired: eventReqs.graphRequired ?? requirements.defaults.graphRequired,
      piiRisk: eventReqs.piiRisk ?? requirements.defaults.piiRisk,
      redaction: eventReqs.redaction ?? [],
      notes: eventReqs.notes,
    };
  }

  // Return defaults for unknown event types
  return {
    requiredScopes: requirements.defaults.requiredScopes,
    graphRequired: requirements.defaults.graphRequired,
    piiRisk: requirements.defaults.piiRisk,
    redaction: [],
  };
}

/**
 * Get required consent scopes for an event type.
 *
 * Convenience method that returns just the required scopes array.
 *
 * @param eventType - The event type (e.g., "browser.page_visited")
 * @returns Array of required consent scope keys
 */
export function getRequiredScopes(eventType: string): string[] {
  return getRequirements(eventType).requiredScopes;
}

/**
 * Check if an event type requires any consent.
 *
 * @param eventType - The event type to check
 * @returns true if the event requires at least one consent scope
 */
export function requiresConsent(eventType: string): boolean {
  return getRequiredScopes(eventType).length > 0;
}

/**
 * Check if an event type requires graph processing (Brain/Neo4j).
 *
 * @param eventType - The event type to check
 * @returns true if the event should be routed to Brain/Neo4j
 */
export function requiresGraph(eventType: string): boolean {
  return getRequirements(eventType).graphRequired === true;
}

/**
 * Get the PII risk level for an event type.
 *
 * @param eventType - The event type to check
 * @returns PIIRiskLevel for the event
 */
export function getPIIRisk(eventType: string): PIIRiskLevel {
  return getRequirements(eventType).piiRisk ?? "medium";
}

/**
 * Get redaction keys for an event type.
 *
 * These are payload keys that should be redacted/removed
 * before persistent storage.
 *
 * @param eventType - The event type to check
 * @returns Array of payload keys to redact
 */
export function getRedactionKeys(eventType: string): string[] {
  return getRequirements(eventType).redaction ?? [];
}

/**
 * Check if an event type is known (defined in requirements).
 *
 * @param eventType - The event type to check
 * @returns true if the event type is defined in requirements
 */
export function isKnownEventType(eventType: string): boolean {
  return eventType in requirements.eventTypes;
}

/**
 * Get all known event types.
 *
 * @returns Array of all defined event type names
 */
export function getAllEventTypes(): string[] {
  return Object.keys(requirements.eventTypes);
}

/**
 * Get all event types that require graph processing.
 *
 * @returns Array of event types with graphRequired: true
 */
export function getGraphRequiredEventTypes(): string[] {
  return Object.entries(requirements.eventTypes)
    .filter(([_, reqs]) => reqs.graphRequired === true)
    .map(([type]) => type);
}

/**
 * Get consent scope definition.
 *
 * @param scope - The consent scope key (e.g., "consent.browser.history")
 * @returns ConsentScopeDefinition or undefined if not found
 */
export function getScopeDefinition(scope: string): ConsentScopeDefinition | undefined {
  return requirements.scopes[scope];
}

/**
 * Get all consent scope keys.
 *
 * @returns Array of all defined consent scope keys
 */
export function getAllScopes(): string[] {
  return Object.keys(requirements.scopes);
}

/**
 * Validate that user consent covers required scopes for an event.
 *
 * @param eventType - The event type to validate
 * @param userScopes - Set of consent scopes the user has enabled
 * @returns Object with valid: boolean and missingScopes: string[]
 */
export function validateConsent(
  eventType: string,
  userScopes: Set<string>
): { valid: boolean; missingScopes: string[] } {
  const required = getRequiredScopes(eventType);
  const missing = required.filter((scope) => !userScopes.has(scope));

  return {
    valid: missing.length === 0,
    missingScopes: missing,
  };
}

/**
 * Get event types by PII risk level.
 *
 * @param riskLevel - The PII risk level to filter by
 * @returns Array of event types with the specified risk level
 */
export function getEventTypesByRisk(riskLevel: PIIRiskLevel): string[] {
  return Object.entries(requirements.eventTypes)
    .filter(([_, reqs]) => (reqs.piiRisk ?? "medium") === riskLevel)
    .map(([type]) => type);
}

/**
 * Get events that require a specific consent scope.
 *
 * @param scope - The consent scope to search for
 * @returns Array of event types that require this scope
 */
export function getEventTypesRequiringScope(scope: string): string[] {
  return Object.entries(requirements.eventTypes)
    .filter(([_, reqs]) => reqs.requiredScopes?.includes(scope))
    .map(([type]) => type);
}

// ============================================================================
// Export raw data for advanced use cases
// ============================================================================

/**
 * Raw event requirements data.
 * Use getRequirements() for type-safe access.
 */
export const rawRequirements = requirements;
