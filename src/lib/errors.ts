export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "INTERNAL_ERROR"
  | "SUPABASE_NOT_CONFIGURED";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}

export function limitExceeded(message: string): AppError {
  return new AppError(409, "LIMIT_EXCEEDED", message);
}

export function supabaseNotConfigured(): AppError {
  return new AppError(503, "SUPABASE_NOT_CONFIGURED", "Supabase credentials are not configured");
}
