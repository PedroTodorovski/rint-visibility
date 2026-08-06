import { assertRuntimeConfig, loadConfig } from "./config.js";
import { createRepositories } from "./repositories/index.js";
import { createDiagnosticWorker } from "./services/diagnostic-queue.js";

async function main() {
  const config = loadConfig();
  assertRuntimeConfig(config);

  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required to start rint-visibility worker");
  }

  const repos = createRepositories(config);
  const worker = createDiagnosticWorker({ repos, config });

  worker.on("completed", (job) => {
    console.info(`diagnostic job completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`diagnostic job failed: ${job?.id ?? "unknown"}`, error);
  });

  console.info("rint-visibility diagnostic worker started");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
