import type { FastifyRequest } from "fastify";

import { validationError } from "./errors.js";

export function requireWorkspaceId(request: FastifyRequest): string {
  const query = request.query as { workspace_id?: string };
  const workspaceId = query.workspace_id?.trim();

  if (!workspaceId) {
    throw validationError("workspace_id query parameter is required");
  }

  return workspaceId;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${field} is required`);
  }

  return value.trim();
}

export function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw validationError("Expected string value");
  }

  return value.trim();
}

export function requireIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw validationError(`${field} must be an integer`);
  }

  if (value < min || value > max) {
    throw validationError(`${field} must be between ${min} and ${max}`);
  }

  return value;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw validationError("Expected boolean value");
  }

  return value;
}

export function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw validationError(`${field} must be an integer`);
  }

  return value;
}

export function authHeaders(apiKey: string): { authorization: string } {
  return { authorization: `Bearer ${apiKey}` };
}
