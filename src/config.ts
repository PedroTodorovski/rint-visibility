export type AppConfig = {
  host: string;
  port: number;
  nodeEnv: string;
  serviceName: string;
  apiKey: string | null;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  openAiApiKey: string | null;
  openAiModel: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string | null;
  geminiApiKey: string | null;
  geminiModel: string | null;
  redisUrl: string | null;
  diagnosticMaxSkus: number;
  diagnosticMaxQueriesPerSku: number;
  diagnosticWebhookSecret: string | null;
  diagnosticJobAttempts: number;
  diagnosticJobBackoffMs: number;
};

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: readPort(env.PORT, 3010),
    nodeEnv: env.NODE_ENV ?? "development",
    serviceName: "rint-visibility",
    apiKey: env.VISIBILITY_API_KEY?.trim() || null,
    supabaseUrl: env.SUPABASE_URL?.trim() || null,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
    openAiApiKey: env.OPENAI_API_KEY?.trim() || null,
    openAiModel: env.OPENAI_MODEL?.trim() || null,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicModel: env.ANTHROPIC_MODEL?.trim() || null,
    geminiApiKey: env.GEMINI_API_KEY?.trim() || null,
    geminiModel: env.GEMINI_MODEL?.trim() || null,
    redisUrl: env.REDIS_URL?.trim() || null,
    diagnosticMaxSkus: readPositiveInteger(env.DIAGNOSTIC_MAX_SKUS, 3),
    diagnosticMaxQueriesPerSku: readPositiveInteger(env.DIAGNOSTIC_MAX_QUERIES_PER_SKU, 5),
    diagnosticWebhookSecret: env.DIAGNOSTIC_WEBHOOK_SECRET?.trim() || null,
    diagnosticJobAttempts: readPositiveInteger(env.DIAGNOSTIC_JOB_ATTEMPTS, 3),
    diagnosticJobBackoffMs: readPositiveInteger(env.DIAGNOSTIC_JOB_BACKOFF_MS, 30_000),
  };
}

export function hasSupabaseConfig(config: AppConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function assertRuntimeConfig(config: AppConfig): void {
  if (config.nodeEnv !== "production") {
    return;
  }

  if (!config.apiKey) {
    throw new Error("VISIBILITY_API_KEY is required when NODE_ENV=production");
  }

  if (!hasSupabaseConfig(config)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when NODE_ENV=production");
  }

  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required when NODE_ENV=production");
  }
}
