/**
 * Profile types for Orion Edge Gateway
 *
 * ProfileSnapshot represents the user's complete profile configuration
 * from the Convex backend, used for personalization and LLM context.
 */

/**
 * Persona summary defines the user's communication preferences
 * and coaching style for AI interactions.
 */
export interface PersonaSummary {
  tone: string;
  detailLevel: number;
  coachingIntensity: string;
  topPriorities: string[];
  do: string[];
  dont: string[];
}

/**
 * Global notification settings
 */
export interface GlobalNotificationRules {
  mode: string;
  quietHours: { start: string; end: string } | null;
  interruptFor: string[];
}

/**
 * Notification rules configuration
 */
export interface NotificationRules {
  global: GlobalNotificationRules;
  apps: Record<string, Record<string, unknown>>;
}

/**
 * LLM policy for system prompt and response styling
 */
export interface LLMPolicy {
  globalSystemStyle: Record<string, unknown>;
  appOverrides: Record<string, Record<string, unknown>>;
}

/**
 * Vector memory references for RAG/semantic search
 */
export interface VectorMemoryRefs {
  lancedb?: { profileDocId: string };
}

/**
 * Complete profile snapshot for a user
 * Retrieved from Convex and cached in KV for quick access
 */
export interface ProfileSnapshot {
  profileVersion: string;
  clerkUserId: string;
  displayName: string;
  timezone: string;
  personaSummary: PersonaSummary;
  notificationRules: NotificationRules;
  llmPolicy: LLMPolicy;
  vectorMemoryRefs?: VectorMemoryRefs;
}

/**
 * Response wrapper for profile snapshot retrieval
 */
export interface ProfileSnapshotResponse {
  ok: boolean;
  updatedAt: number;
  profileSnapshot: ProfileSnapshot;
}

/**
 * Client information for questionnaire submissions
 */
export interface QuestionnaireClient {
  platform: string;
  app: string;
  appVersion: string;
  deviceLocale: string;
}

/**
 * Redaction metadata for sensitive questionnaire data
 */
export interface QuestionnaireRedaction {
  containsSensitive: boolean;
  notes: string;
}

/**
 * Individual answer in a questionnaire submission
 */
export interface QuestionnaireAnswer {
  type: string;
  value: unknown;
}

/**
 * Questionnaire submission payload
 * Used for onboarding and profile updates from iOS apps
 */
export interface QuestionnaireSubmission {
  schemaVersion: string;
  moduleId: string;
  moduleVersion: string;
  submissionId: string;
  isUpdate: boolean;
  answers: Record<string, QuestionnaireAnswer>;
  scopesGranted: Record<string, boolean>;
  redaction: QuestionnaireRedaction;
  client: QuestionnaireClient;
}

/**
 * Profile update request from Dashboard
 */
export interface ProfileUpdateRequest {
  displayName?: string;
  timezone?: string;
  personaSummary?: Partial<PersonaSummary>;
  notificationRules?: Partial<NotificationRules>;
  llmPolicy?: Partial<LLMPolicy>;
}

/**
 * Profile update response
 */
export interface ProfileUpdateResponse {
  ok: boolean;
  updatedAt: number;
}
