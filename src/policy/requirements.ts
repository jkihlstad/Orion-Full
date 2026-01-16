/**
 * requirements.ts
 *
 * Loads and provides lookup for ExpandedEventRequirements.json
 */

import ExpandedRequirements from '../contracts/generated/ExpandedEventRequirements.json';

export interface EventRequirement {
  eventType: string;
  enabled: boolean;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  requiredScopes: string[];
  graphRequired: boolean;
  brainEnabled: boolean;
  piiRisk: 'low' | 'medium' | 'high' | 'very_high';
  redactKeys: string[];
  retentionDays: number;
  requiresIndicatorInBackground?: boolean;
  allowBackground?: boolean;
  requiresUltraConsent?: boolean;
  requiresParticipantNotice?: boolean;
  scopeTier?: string;
  scopeApps?: string[];
}

export interface ExpandedEventRequirements {
  version: string;
  generatedAt: string;
  eventCount: number;
  events: EventRequirement[];
  tierSummary: {
    T0: number;
    T1: number;
    T2: number;
    T3: number;
  };
}

// Build lookup map on module load
const requirementsMap = new Map<string, EventRequirement>();
const requirements = ExpandedRequirements as ExpandedEventRequirements;

for (const event of requirements.events) {
  requirementsMap.set(event.eventType, event);
}

/**
 * Get requirements for an event type
 */
export function getEventRequirements(eventType: string): EventRequirement | undefined {
  return requirementsMap.get(eventType);
}

/**
 * Check if an event type is known
 */
export function isKnownEventType(eventType: string): boolean {
  return requirementsMap.has(eventType);
}

/**
 * Check if an event type is enabled
 */
export function isEventEnabled(eventType: string): boolean {
  const req = requirementsMap.get(eventType);
  return req?.enabled ?? false;
}

/**
 * Get all event types for a tier
 */
export function getEventsByTier(tier: 'T0' | 'T1' | 'T2' | 'T3'): string[] {
  return requirements.events
    .filter(e => e.tier === tier)
    .map(e => e.eventType);
}

/**
 * Get the requirements version
 */
export function getRequirementsVersion(): string {
  return requirements.version;
}

/**
 * Get tier summary
 */
export function getTierSummary(): Record<string, number> {
  return requirements.tierSummary;
}

export { requirements as ExpandedRequirements };
