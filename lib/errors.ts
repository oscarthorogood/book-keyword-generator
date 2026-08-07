/**
 * Centralized error handling for the API.
 * Provides consistent error response formatting and logging.
 */

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(400, message, context);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, unknown>) {
    super(404, `${resource} not found`, context);
    this.name = "NotFoundError";
  }
}

export class AuthError extends AppError {
  constructor(message: string = "Unauthorized", context?: Record<string, unknown>) {
    super(401, message, context);
    this.name = "AuthError";
  }
}

export class ServerError extends AppError {
  constructor(message: string = "Internal server error", context?: Record<string, unknown>) {
    super(500, message, context);
    this.name = "ServerError";
  }
}

/**
 * Log an error with optional context for debugging.
 * In production, this would integrate with a proper error tracking service (Sentry, etc.)
 */
export function logError(error: unknown, context?: Record<string, unknown>) {
  if (error instanceof AppError) {
    console.error(`[${error.name}] ${error.message}`, error.context || context);
  } else if (error instanceof Error) {
    console.error(`[Error] ${error.message}`, context);
  } else {
    console.error("[Unknown Error]", { error, context });
  }
}

/**
 * Convert an error to a JSON response for API endpoints.
 */
export function errorToResponse(error: unknown) {
  logError(error);

  if (error instanceof AppError) {
    return { status: error.statusCode, body: { error: error.message } };
  }

  if (error instanceof Error) {
    return { status: 500, body: { error: "Internal server error" } };
  }

  return { status: 500, body: { error: "Internal server error" } };
}
