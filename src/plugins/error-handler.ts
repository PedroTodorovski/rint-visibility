import type { FastifyInstance } from "fastify";

import { AppError } from "../lib/errors.js";

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });
}
