/**
 * Questionnaire validation schemas
 *
 * Zod schemas for validating questionnaire submissions from iOS apps
 * and profile updates from Dashboard.
 */

import { z } from "zod";

// ============================================================================
// Client Information Schema
// ============================================================================

export const QuestionnaireClientSchema = z.object({
  platform: z.string().min(1, "Platform is required"),
  app: z.string().min(1, "App name is required"),
  appVersion: z.string().min(1, "App version is required"),
  deviceLocale: z.string().min(1, "Device locale is required"),
});

// ============================================================================
// Redaction Schema
// ============================================================================

export const QuestionnaireRedactionSchema = z.object({
  containsSensitive: z.boolean(),
  notes: z.string(),
});

// ============================================================================
// Answer Schema
// ============================================================================

export const QuestionnaireAnswerSchema = z.object({
  type: z.enum([
    "text",
    "number",
    "boolean",
    "single_choice",
    "multi_choice",
    "date",
    "time",
    "datetime",
    "scale",
    "json",
  ]),
  value: z.unknown(),
});

// ============================================================================
// Questionnaire Submission Schema
// ============================================================================

export const QuestionnaireSubmissionSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Invalid schema version format"),
  moduleId: z.string().min(1, "Module ID is required"),
  moduleVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Invalid module version format"),
  submissionId: z.string().uuid("Submission ID must be a valid UUID"),
  isUpdate: z.boolean(),
  answers: z.record(z.string(), QuestionnaireAnswerSchema),
  scopesGranted: z.record(z.string(), z.boolean()),
  redaction: QuestionnaireRedactionSchema,
  client: QuestionnaireClientSchema,
});

export type QuestionnaireSubmissionT = z.infer<typeof QuestionnaireSubmissionSchema>;

// ============================================================================
// Persona Summary Schema
// ============================================================================

export const PersonaSummarySchema = z.object({
  tone: z.string().min(1),
  detailLevel: z.number().int().min(1).max(5),
  coachingIntensity: z.enum(["low", "medium", "high"]),
  topPriorities: z.array(z.string()).max(10),
  do: z.array(z.string()).max(20),
  dont: z.array(z.string()).max(20),
});

// ============================================================================
// Notification Rules Schemas
// ============================================================================

export const QuietHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)"),
});

export const GlobalNotificationRulesSchema = z.object({
  mode: z.enum(["all", "important", "silent", "scheduled"]),
  quietHours: QuietHoursSchema.nullable(),
  interruptFor: z.array(z.string()),
});

export const NotificationRulesSchema = z.object({
  global: GlobalNotificationRulesSchema,
  apps: z.record(z.string(), z.record(z.string(), z.unknown())),
});

// ============================================================================
// LLM Policy Schema
// ============================================================================

export const LLMPolicySchema = z.object({
  globalSystemStyle: z.record(z.string(), z.unknown()),
  appOverrides: z.record(z.string(), z.record(z.string(), z.unknown())),
});

// ============================================================================
// Profile Update Request Schema
// ============================================================================

export const ProfileUpdateRequestSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).optional(),
  personaSummary: PersonaSummarySchema.partial().optional(),
  notificationRules: NotificationRulesSchema.partial().optional(),
  llmPolicy: LLMPolicySchema.partial().optional(),
}).refine(
  (data) =>
    data.displayName !== undefined ||
    data.timezone !== undefined ||
    data.personaSummary !== undefined ||
    data.notificationRules !== undefined ||
    data.llmPolicy !== undefined,
  { message: "At least one field must be provided for update" }
);

export type ProfileUpdateRequestT = z.infer<typeof ProfileUpdateRequestSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{ path: string; message: string }>;
}

/**
 * Validate a questionnaire submission
 */
export function validateQuestionnaireSubmission(
  input: unknown
): ValidationResult<QuestionnaireSubmissionT> {
  const result = QuestionnaireSubmissionSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/**
 * Validate a profile update request
 */
export function validateProfileUpdateRequest(
  input: unknown
): ValidationResult<ProfileUpdateRequestT> {
  const result = ProfileUpdateRequestSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
