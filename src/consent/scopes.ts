/**
 * Consent Scopes Registry
 * Window 25 + Window 26: Centralized consent scope definitions
 *
 * Key principle: iOS permission ≠ user consent
 * For sensitive capture, you must have both:
 * 1. OS permission (Apple dialogs)
 * 2. Server-side consent scope enabled (your policies)
 *
 * WINDOW 26 UPDATE:
 * - Consent enforcement is now registry-driven
 * - getRequiredScopes() now delegates to registry.getRequiredScopes()
 * - EVENT_TYPE_CONSENT_MAP is DEPRECATED (kept for backwards compatibility)
 * - The registry.json is the SINGLE SOURCE OF TRUTH
 *
 * Usage:
 * - Define all consent scopes here (CONSENT_SCOPES)
 * - Event types reference required scopes via registry.json requiredScopes
 * - Gateway enforces consent before accepting events
 */

// ============================================================================
// Consent Scope Types
// ============================================================================

export type RiskLevel = "low" | "med" | "high";

export interface ConsentScope {
  /** Unique scope identifier */
  key: string;
  /** Human-readable label for UI */
  label: string;
  /** Longer description */
  description: string;
  /** Risk level for UI styling */
  risk: RiskLevel;
  /** App(s) this scope applies to */
  apps: string[];
  /** Default enabled state for new users */
  defaultEnabled: boolean;
}

// ============================================================================
// Consent Scopes Registry
// ============================================================================

export const CONSENT_SCOPES: ConsentScope[] = [
  // -------------------------------------------------------------------------
  // System Telemetry (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "system.telemetry_basic",
    label: "Basic Telemetry",
    description: "App lifecycle events and basic usage tracking",
    risk: "low",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Browser (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "browser.activity_basic",
    label: "Basic Browser Activity",
    description: "Track pages you visit and session data",
    risk: "med",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "browser.activity_detailed",
    label: "Detailed Browser Activity",
    description: "Track scrolls, clicks, and time spent on pages",
    risk: "med",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "browser.form_capture",
    label: "Form Interactions",
    description: "Track form submissions and interactions",
    risk: "high",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "browser.screenshot_capture",
    label: "Screenshot Capture",
    description: "Capture screenshots of web pages",
    risk: "high",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "browser.content_capture",
    label: "Content Capture",
    description: "Capture and store browser content including screenshots",
    risk: "high",
    apps: ["browser"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Finance (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "finance.plaid_link",
    label: "Bank Connection (Plaid)",
    description: "Connect bank accounts for transaction tracking",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.tx_tracking",
    label: "Transaction Tracking",
    description: "Track and categorize your transactions",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.receipt_capture",
    label: "Receipt Capture",
    description: "Scan and store receipts",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Tasks (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "tasks.items_basic",
    label: "Basic Task Access",
    description: "Create and manage tasks",
    risk: "low",
    apps: ["tasks"],
    defaultEnabled: false,
  },
  {
    key: "tasks.items",
    label: "Task Items",
    description: "Create, update, and complete tasks",
    risk: "low",
    apps: ["tasks"],
    defaultEnabled: false,
  },
  {
    key: "tasks.automation",
    label: "Task Automation",
    description: "Auto-generate tasks from calendar and email",
    risk: "med",
    apps: ["tasks"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Calendar (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "calendar.events_basic",
    label: "Calendar Events",
    description: "Access calendar events",
    risk: "med",
    apps: ["calendar"],
    defaultEnabled: false,
  },
  {
    key: "calendar.events",
    label: "Calendar Events",
    description: "Create, update, and delete calendar events",
    risk: "med",
    apps: ["calendar"],
    defaultEnabled: false,
  },
  {
    key: "calendar.automation",
    label: "Calendar Automation",
    description: "Auto-manage calendar events",
    risk: "med",
    apps: ["calendar"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Email (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "email.metadata_basic",
    label: "Email Metadata",
    description: "Access email subjects and senders",
    risk: "med",
    apps: ["email"],
    defaultEnabled: false,
  },
  {
    key: "email.metadata",
    label: "Email Metadata",
    description: "Access email threads, senders, and subjects",
    risk: "med",
    apps: ["email"],
    defaultEnabled: false,
  },
  {
    key: "email.content",
    label: "Email Content",
    description: "Read full email body content",
    risk: "high",
    apps: ["email"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Finance (Window 26 - Additional registry scopes)
  // -------------------------------------------------------------------------
  {
    key: "finance.transactions",
    label: "Financial Transactions",
    description: "Track and sync financial transactions",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.budgets",
    label: "Budget Tracking",
    description: "Create and monitor budgets",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.receipts",
    label: "Receipt Capture",
    description: "Scan and store receipts",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.subscriptions",
    label: "Subscription Tracking",
    description: "Track recurring subscriptions and payments",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.credit",
    label: "Credit Monitoring",
    description: "Monitor credit score and credit activity",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "finance.insights",
    label: "Financial Insights",
    description: "Generate spending insights and financial analytics",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Email (Window 26 - Additional registry scopes)
  // -------------------------------------------------------------------------
  {
    key: "email.attachments",
    label: "Email Attachments",
    description: "Access email attachments",
    risk: "high",
    apps: ["email"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Dashboard (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "dashboard.usage",
    label: "Dashboard Usage",
    description: "Track dashboard usage and interactions",
    risk: "low",
    apps: ["dashboard"],
    defaultEnabled: false,
  },
  {
    key: "profile.write",
    label: "Profile Updates",
    description: "Update and modify profile information",
    risk: "med",
    apps: ["dashboard"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Consent Management (Window 26 - Registry scopes)
  // -------------------------------------------------------------------------
  {
    key: "consent.management",
    label: "Consent Management",
    description: "Track and manage consent preferences",
    risk: "low",
    apps: ["dashboard"],
    defaultEnabled: true,
  },

  // -------------------------------------------------------------------------
  // Communication (Window 26 - Registry scopes)
  // -------------------------------------------------------------------------
  {
    key: "communication.messages",
    label: "Message Tracking",
    description: "Track messaging activity",
    risk: "high",
    apps: ["communication"],
    defaultEnabled: false,
  },
  {
    key: "communication.calls",
    label: "Call Tracking",
    description: "Track call activity and metadata",
    risk: "high",
    apps: ["communication"],
    defaultEnabled: false,
  },
  {
    key: "communication.call_recording",
    label: "Call Recording",
    description: "Record and transcribe calls",
    risk: "high",
    apps: ["communication"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Location (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "location.foreground_coarse",
    label: "Foreground Location (Coarse)",
    description: "Access approximate location while app is in foreground",
    risk: "low",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "location.foreground_precise",
    label: "Foreground Location (Precise)",
    description: "Access precise GPS location while app is in foreground",
    risk: "high",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "location.background_coarse",
    label: "Background Location (Coarse)",
    description: "Access approximate location while app is in background",
    risk: "high",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "location.background_precise",
    label: "Background Location (Precise)",
    description: "Access precise GPS location while app is in background",
    risk: "high",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "location.visits_significant_changes",
    label: "Significant Location Changes",
    description: "Monitor significant location changes and visits",
    risk: "high",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Inputs (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "inputs.gesture_analytics",
    label: "Gesture Analytics",
    description: "Track gesture interactions like taps and swipes",
    risk: "low",
    apps: ["browser", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "inputs.text_analytics",
    label: "Text Input Analytics",
    description: "Track text input statistics and typing patterns",
    risk: "low",
    apps: ["browser", "dashboard"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Nutrition (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "nutrition.meals",
    label: "Meal Tracking",
    description: "Log meals and track nutritional information",
    risk: "low",
    apps: ["nutrition"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Sleep (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "sleep.sessions",
    label: "Sleep Tracking",
    description: "Track sleep sessions and quality metrics",
    risk: "low",
    apps: ["sleep"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Workouts (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "workouts.sessions",
    label: "Workout Tracking",
    description: "Track workout sessions and exercise data",
    risk: "low",
    apps: ["workouts"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Social (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "social.activity",
    label: "Social Activity",
    description: "Track social interactions and messaging",
    risk: "med",
    apps: ["social"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Dating (Window 26 - Registry-aligned scopes)
  // -------------------------------------------------------------------------
  {
    key: "dating.profile",
    label: "Dating Profile",
    description: "Create and manage dating profile",
    risk: "med",
    apps: ["dating"],
    defaultEnabled: false,
  },
  {
    key: "dating.activity",
    label: "Dating Activity",
    description: "Track swipes, matches, and dating activity",
    risk: "med",
    apps: ["dating"],
    defaultEnabled: false,
  },
  {
    key: "dating.messages",
    label: "Dating Messages",
    description: "Send and receive messages with matches",
    risk: "med",
    apps: ["dating"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Browser (Legacy consent.* scopes for backwards compatibility)
  // -------------------------------------------------------------------------
  {
    key: "consent.browser.history",
    label: "Browsing History",
    description: "Track pages you visit to provide personalized insights",
    risk: "med",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "consent.browser.interaction",
    label: "Browser Interactions",
    description: "Track clicks, scrolls, and time spent on pages",
    risk: "low",
    apps: ["browser"],
    defaultEnabled: false,
  },
  {
    key: "consent.browser.screenshots",
    label: "Page Screenshots",
    description: "Capture screenshots of web pages for visual context",
    risk: "high",
    apps: ["browser"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Finance
  // -------------------------------------------------------------------------
  {
    key: "consent.finance.plaid",
    label: "Bank Connections",
    description: "Connect bank accounts via Plaid for transaction tracking",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "consent.finance.transactions",
    label: "Transaction Tracking",
    description: "Track and categorize your financial transactions",
    risk: "high",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "consent.finance.receipts",
    label: "Receipt Capture",
    description: "Scan and store receipts for expense tracking",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },
  {
    key: "consent.finance.subscriptions",
    label: "Subscription Tracking",
    description: "Monitor recurring subscriptions and payments",
    risk: "med",
    apps: ["finance"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------
  {
    key: "consent.calendar.read",
    label: "Read Calendar",
    description: "Access your calendar events for scheduling insights",
    risk: "med",
    apps: ["calendar"],
    defaultEnabled: false,
  },
  {
    key: "consent.calendar.write",
    label: "Modify Calendar",
    description: "Create and modify calendar events on your behalf",
    risk: "med",
    apps: ["calendar"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  {
    key: "consent.tasks.read",
    label: "Read Tasks",
    description: "Access your tasks and to-do lists",
    risk: "low",
    apps: ["tasks"],
    defaultEnabled: false,
  },
  {
    key: "consent.tasks.write",
    label: "Modify Tasks",
    description: "Create and modify tasks on your behalf",
    risk: "low",
    apps: ["tasks"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Email
  // -------------------------------------------------------------------------
  {
    key: "consent.email.read",
    label: "Read Emails",
    description: "Access your email content for insights",
    risk: "high",
    apps: ["email"],
    defaultEnabled: false,
  },
  {
    key: "consent.email.send",
    label: "Send Emails",
    description: "Send emails on your behalf",
    risk: "high",
    apps: ["email"],
    defaultEnabled: false,
  },
  {
    key: "consent.email.metadata",
    label: "Email Metadata",
    description: "Access email threads, subjects, and senders",
    risk: "med",
    apps: ["email"],
    defaultEnabled: false,
  },
  {
    key: "consent.email.body",
    label: "Email Content",
    description: "Read full email body content",
    risk: "high",
    apps: ["email"],
    defaultEnabled: false,
  },

  // -------------------------------------------------------------------------
  // Cross-cutting (Location, Microphone, Camera)
  // -------------------------------------------------------------------------
  {
    key: "consent.location.precise",
    label: "Precise Location",
    description: "Access your precise GPS location",
    risk: "high",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "consent.location.approx",
    label: "Approximate Location",
    description: "Access your approximate location (city-level)",
    risk: "med",
    apps: ["browser", "finance", "calendar", "tasks", "email", "dashboard"],
    defaultEnabled: false,
  },
  {
    key: "consent.microphone.capture",
    label: "Microphone Access",
    description: "Record audio for voice notes and commands",
    risk: "high",
    apps: ["communication", "tasks"],
    defaultEnabled: false,
  },
  {
    key: "consent.camera.capture",
    label: "Camera Access",
    description: "Capture photos and videos",
    risk: "high",
    apps: ["finance", "browser"],
    defaultEnabled: false,
  },
];

// ============================================================================
// Scope Lookup Helpers
// ============================================================================

/**
 * Get all consent scopes as a map for fast lookup.
 */
export function getScopesMap(): Map<string, ConsentScope> {
  const map = new Map<string, ConsentScope>();
  for (const scope of CONSENT_SCOPES) {
    map.set(scope.key, scope);
  }
  return map;
}

/**
 * Get a consent scope by key.
 */
export function getScope(key: string): ConsentScope | undefined {
  return CONSENT_SCOPES.find((s) => s.key === key);
}

/**
 * Check if a scope key is valid.
 */
export function isValidScope(key: string): boolean {
  return CONSENT_SCOPES.some((s) => s.key === key);
}

/**
 * Get all scopes for a specific app.
 */
export function getScopesForApp(app: string): ConsentScope[] {
  return CONSENT_SCOPES.filter((s) => s.apps.includes(app));
}

/**
 * Get default consent values for a new user.
 */
export function getDefaultConsents(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const scope of CONSENT_SCOPES) {
    defaults[scope.key] = scope.defaultEnabled;
  }
  return defaults;
}

// ============================================================================
// Event Type to Consent Scope Mapping
// ============================================================================

/**
 * @deprecated WINDOW 26: This hardcoded map is DEPRECATED.
 * Use registry.getRequiredScopes() instead, which reads from registry.json.
 * This map is kept ONLY for backwards compatibility during migration.
 *
 * DO NOT ADD NEW ENTRIES HERE. Add them to registry.json instead.
 */
export const EVENT_TYPE_CONSENT_MAP: Record<string, string[]> = {
  // DEPRECATED: Browser events - now in registry.json
  "browser.page_viewed": ["consent.browser.history"],
  "browser.session_started": ["consent.browser.history"],
  "browser.session_ended": ["consent.browser.history"],
  "browser.click": ["consent.browser.interaction"],
  "browser.scroll": ["consent.browser.interaction"],
  "browser.screenshot_uploaded": ["consent.browser.screenshots"],

  // DEPRECATED: Finance events - now in registry.json
  "finance.transaction_created": ["consent.finance.transactions"],
  "finance.transaction_categorized": ["consent.finance.transactions"],
  "finance.receipt_uploaded": ["consent.finance.receipts"],
  "finance.subscription_detected": ["consent.finance.subscriptions"],
  "finance.plaid_connected": ["consent.finance.plaid"],

  // DEPRECATED: Calendar events - now in registry.json
  "calendar.event_created": ["consent.calendar.write"],
  "calendar.event_updated": ["consent.calendar.write"],
  "calendar.event_deleted": ["consent.calendar.write"],
  "calendar.sync_completed": ["consent.calendar.read"],

  // DEPRECATED: Tasks events - now in registry.json
  "tasks.task_created": ["consent.tasks.write"],
  "tasks.task_completed": ["consent.tasks.write"],
  "tasks.task_updated": ["consent.tasks.write"],

  // DEPRECATED: Email events - now in registry.json
  "email.thread_opened": ["consent.email.read"],
  "email.message_read": ["consent.email.body"],
  "email.message_sent": ["consent.email.send"],
  "email.sync_completed": ["consent.email.metadata"],

  // DEPRECATED: Location events - now in registry.json
  "location.position_updated": ["consent.location.precise"],
  "location.region_entered": ["consent.location.approx"],
};

// Import registry-driven getRequiredScopes
import { getRequiredScopes as registryGetRequiredScopes } from "../validation/registry";

/**
 * Get required consent scopes for an event type.
 *
 * WINDOW 26: This now delegates to the registry for the source of truth.
 * Falls back to the deprecated hardcoded map only if registry returns empty.
 *
 * Enforcement is now registry-driven.
 */
export function getRequiredScopes(eventType: string): string[] {
  // Primary: Use registry (Window 26 - single source of truth)
  const registryScopes = registryGetRequiredScopes(eventType);
  if (registryScopes.length > 0) {
    return registryScopes;
  }

  // Fallback: Use deprecated hardcoded map (for backwards compatibility)
  return EVENT_TYPE_CONSENT_MAP[eventType] ?? [];
}

/**
 * Check if an event type requires any consent.
 */
export function eventRequiresConsent(eventType: string): boolean {
  return getRequiredScopes(eventType).length > 0;
}
