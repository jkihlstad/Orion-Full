/**
 * Structured Logging Utility for Orion Edge Gateway
 *
 * Provides structured JSON logging compatible with Cloudflare Workers.
 * Uses console methods under the hood for proper integration with CF logging.
 *
 * Features:
 * - Log levels: debug, info, warn, error
 * - Context support for traceId, userId, requestId, etc.
 * - JSON output format for production
 * - Child logger creation for request-scoped context
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Standard context fields for structured logging
 */
export interface LogContext {
  traceId?: string;
  userId?: string;
  requestId?: string;
  eventId?: string;
  eventType?: string;
  [key: string]: unknown;
}

/**
 * Structured log entry format
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger interface for structured logging
 */
export interface Logger {
  /**
   * Log debug-level message (for development/troubleshooting)
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log info-level message (normal operational events)
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log warning-level message (unexpected but handled situations)
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log error-level message (errors requiring attention)
   */
  error(message: string, error?: Error | null, context?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional base context
   */
  child(context: Record<string, unknown>): Logger;
}

/**
 * Format error object for logging
 */
function formatError(err: Error | null | undefined): LogEntry["error"] | undefined {
  if (!err) return undefined;
  return {
    name: err.name || "Error",
    message: err.message || String(err),
    stack: err.stack,
  };
}

/**
 * Create a structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  baseContext: Record<string, unknown>,
  additionalContext?: Record<string, unknown>,
  error?: Error | null
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  // Merge contexts (base + additional), filtering out undefined values
  const mergedContext = { ...baseContext, ...additionalContext };
  const filteredContext = Object.fromEntries(
    Object.entries(mergedContext).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(filteredContext).length > 0) {
    entry.context = filteredContext;
  }

  if (error) {
    entry.error = formatError(error);
  }

  return entry;
}

/**
 * Implementation of the Logger interface
 */
class StructuredLogger implements Logger {
  private baseContext: Record<string, unknown>;

  constructor(baseContext: Record<string, unknown> = {}) {
    this.baseContext = baseContext;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | null
  ): void {
    const entry = createLogEntry(level, message, this.baseContext, context, error);
    const logLine = JSON.stringify(entry);

    switch (level) {
      case "debug":
        console.debug(logLine);
        break;
      case "info":
        console.info(logLine);
        break;
      case "warn":
        console.warn(logLine);
        break;
      case "error":
        console.error(logLine);
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error | null, context?: Record<string, unknown>): void {
    this.log("error", message, context, error);
  }

  child(context: Record<string, unknown>): Logger {
    return new StructuredLogger({ ...this.baseContext, ...context });
  }
}

/**
 * Create a new logger instance with optional base context
 *
 * @param baseContext - Optional base context to include in all log entries
 * @returns Logger instance
 *
 * @example
 * // Create a basic logger
 * const logger = createLogger();
 * logger.info("Server started", { port: 8080 });
 *
 * @example
 * // Create a logger with base context (e.g., for a request)
 * const logger = createLogger({ traceId: "trace_123", userId: "user_456" });
 * logger.info("Processing request");
 * // Output includes traceId and userId in every log entry
 *
 * @example
 * // Create a child logger with additional context
 * const requestLogger = createLogger({ traceId: "trace_123" });
 * const userLogger = requestLogger.child({ userId: "user_456" });
 * userLogger.info("User action"); // includes both traceId and userId
 */
export function createLogger(baseContext?: Record<string, unknown>): Logger {
  return new StructuredLogger(baseContext);
}

/**
 * Default logger instance without any base context
 * Use for module-level logging where request context isn't available
 */
export const logger = createLogger();
