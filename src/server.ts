import { buildApp } from "./app.js";
import { assertRuntimeConfig, loadConfig } from "./config.js";

async function main() {
  const config = loadConfig();
  assertRuntimeConfig(config);
  const app = await buildApp(config);

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`${config.serviceName} listening on ${config.host}:${config.port}`);
  app.log.info(
    config.redisUrl
      ? "diagnostic queue: bullmq (API enqueues; worker must be running)"
      : "diagnostic queue: in-process (local/dev only — production requires REDIS_URL + worker)",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
