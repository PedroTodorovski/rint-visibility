import type { PostgrestError } from "@supabase/supabase-js";

import { AppError, conflict } from "../lib/errors.js";

export function isForeignKeyViolation(error: { code?: string | null }): boolean {
  return error.code === "23503";
}

export function mapPostgrestError(error: PostgrestError, context: string): AppError {
  if (error.code === "23505") {
    return conflict(`${context}: unique constraint violated`);
  }

  if (error.code === "23514") {
    return conflict(`${context}: constraint violated`);
  }

  throw new AppError(500, "INTERNAL_ERROR", `${context}: ${error.message}`);
}
