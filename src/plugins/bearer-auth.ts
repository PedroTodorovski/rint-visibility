import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { timingSafeCompare } from "../lib/timing-safe-compare.js";

export type UnauthorizedBody = {
  error: "Unauthorized";
  code: "UNAUTHORIZED";
};

export type AuthNotConfiguredBody = {
  error: "Auth not configured";
  code: "AUTH_NOT_CONFIGURED";
};

function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerBearerAuth(
  app: FastifyInstance,
  config: Pick<AppConfig, "apiKey">,
): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!config.apiKey) {
      const body: AuthNotConfiguredBody = {
        error: "Auth not configured",
        code: "AUTH_NOT_CONFIGURED",
      };
      return reply.code(503).send(body);
    }

    const token = parseBearerToken(request.headers.authorization);
    if (!token || !timingSafeCompare(token, config.apiKey)) {
      const body: UnauthorizedBody = {
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      };
      return reply.code(401).send(body);
    }
  });
}
