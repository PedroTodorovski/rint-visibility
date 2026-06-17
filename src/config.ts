export type AppConfig = {
  host: string;
  port: number;
  nodeEnv: string;
  serviceName: string;
  apiKey: string | null;
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
  };
}
