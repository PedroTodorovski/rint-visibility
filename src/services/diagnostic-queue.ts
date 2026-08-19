import { Queue, Worker } from "bullmq";

import type { AppConfig } from "../config.js";
import { createLlmClients } from "../lib/llm/index.js";
import type { LlmClients } from "../lib/llm/types.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import {
  type DominantDiagnosticJobPayload,
  runDominantDiagnostic,
} from "./dominant-diagnostic-runner.js";

const QUEUE_NAME = "rint-diagnostics";

export type DiagnosticQueue = {
  enqueue(payload: DominantDiagnosticJobPayload): Promise<void>;
  close?(): Promise<void>;
};

function redisConnectionOptions(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname !== "/" ? Number(parsed.pathname.slice(1)) || 0 : 0,
    maxRetriesPerRequest: null,
  };
}

export function createInProcessDiagnosticQueue(input: {
  repos: VisibilityRepositories;
  config: AppConfig;
  llm?: LlmClients;
}): DiagnosticQueue {
  const llm = input.llm ?? createLlmClients(input.config);

  return {
    async enqueue(payload) {
      setTimeout(() => {
        void runDominantDiagnostic(
          {
            repos: input.repos,
            llm,
            config: input.config,
          },
          payload,
        ).catch((err) => {
          console.error("[diagnostic-queue] in-process job crashed", payload.jobId, err);
        });
      }, 0);
    },
  };
}

export function createBullDiagnosticQueue(config: AppConfig): DiagnosticQueue {
  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required to create BullMQ diagnostic queue");
  }

  const queue = new Queue<DominantDiagnosticJobPayload, void, "run">(QUEUE_NAME, {
    connection: redisConnectionOptions(config.redisUrl),
  });

  return {
    async enqueue(payload) {
      await queue.add("run", payload, {
        jobId: payload.jobId,
        attempts: config.diagnosticJobAttempts,
        backoff: {
          type: "exponential",
          delay: config.diagnosticJobBackoffMs,
        },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
    },
    async close() {
      await queue.close();
    },
  };
}

export function createDiagnosticQueue(input: {
  repos: VisibilityRepositories;
  config: AppConfig;
  llm?: LlmClients;
}): DiagnosticQueue {
  if (input.config.redisUrl) {
    return createBullDiagnosticQueue(input.config);
  }

  return createInProcessDiagnosticQueue(input);
}

export function createDiagnosticWorker(input: {
  repos: VisibilityRepositories;
  config: AppConfig;
}): Worker<DominantDiagnosticJobPayload, void, "run"> {
  if (!input.config.redisUrl) {
    throw new Error("REDIS_URL is required to start diagnostic worker");
  }

  const llm = createLlmClients(input.config);

  return new Worker<DominantDiagnosticJobPayload, void, "run">(
    QUEUE_NAME,
    async (job) => {
      await runDominantDiagnostic(
        {
          repos: input.repos,
          llm,
          config: input.config,
        },
        job.data,
      );
    },
    {
      connection: redisConnectionOptions(input.config.redisUrl),
      concurrency: 2,
      // Gemini jobs can run many grounded calls; keep the lock past worst-case wall time.
      stalledInterval: 60_000,
      lockDuration: 30 * 60_000,
    },
  );
}
