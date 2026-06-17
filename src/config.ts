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
  geminiApiKey: string | null;
  geminiModel: string | null;
};

function readPort(value: string | undefined, fallback: number): number {
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
    geminiApiKey: env.GEMINI_API_KEY?.trim() || null,
    geminiModel: env.GEMINI_MODEL?.trim() || null,
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
}
