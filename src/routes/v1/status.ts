import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";

export type V1StatusResponse = {
  status: "ok";
  service: string;
  authenticated: true;
};

/** Smoke route for rint-admin to verify Bearer auth and connectivity. */
export async function registerV1StatusRoute(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  app.get("/status", async (_request, reply) => {
    const body: V1StatusResponse = {
      status: "ok",
      service: config.serviceName,
      authenticated: true,
    };

    return reply.code(200).send(body);
  });
}
