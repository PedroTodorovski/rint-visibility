import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";

export type HealthResponse = {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
};

export async function registerHealthRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const body: HealthResponse = {
      status: "ok",
      service: config.serviceName,
      version: process.env.npm_package_version ?? "0.0.0",
      timestamp: new Date().toISOString(),
    };

    return reply
      .header("cache-control", "no-store, max-age=0")
      .code(200)
      .send(body);
  });
}
