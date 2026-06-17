import type { AppConfig } from "../../config.js";
import type { LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function createClaudeClient(config: AppConfig): LlmClient {
  const apiKey = config.anthropicApiKey;
  const model = config.anthropicModel ?? DEFAULT_MODEL;

  return {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          return { text: "", model: "mock", mocked: true };
        }

        const data = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
          model?: string;
        };

        const text =
          data.content?.find((block) => block.type === "text")?.text?.trim() ?? "";
        return { text, model: data.model ?? model, mocked: false };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },
  };
}
