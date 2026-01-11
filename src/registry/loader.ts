/**
 * Registry policy loader
 * Loads eventType policies from registry.json
 */

export interface EventTypePolicy {
  consentScope: string;
  defaultPrivacyScope: "private" | "social" | "public";
  allowSocialForward: boolean;
  requiresSocialOptIn?: boolean;
  brainEnabled?: boolean;
  redactKeys: string[];
}

export interface Registry {
  version: string;
  eventTypes: Record<string, EventTypePolicy>;
}

// Embedded registry for build-time inclusion
// In production, this would be loaded from suite-contracts/registry/registry.json
let cachedRegistry: Registry | null = null;

export function getRegistry(): Registry {
  if (cachedRegistry) return cachedRegistry;

  // For now, return a minimal registry
  // In production, load from suite-contracts or a deployed JSON URL
  cachedRegistry = {
    version: "2026-01-10",
    eventTypes: {},
  };

  return cachedRegistry;
}

export function getEventTypePolicy(eventType: string): EventTypePolicy | null {
  const registry = getRegistry();
  return registry.eventTypes[eventType] ?? null;
}

export function getRedactKeys(eventType: string): string[] {
  const policy = getEventTypePolicy(eventType);
  return policy?.redactKeys ?? [];
}

export function getConsentScope(eventType: string): string | null {
  const policy = getEventTypePolicy(eventType);
  return policy?.consentScope ?? null;
}

export function allowsSocialForward(eventType: string): boolean {
  const policy = getEventTypePolicy(eventType);
  return policy?.allowSocialForward ?? false;
}
