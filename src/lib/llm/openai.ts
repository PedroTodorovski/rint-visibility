import type { AppConfig } from "../../config.js";
import { probeBatchSequential } from "./batch-probe.js";
import type { LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";

export function createOpenAiClient(config: AppConfig): LlmClient {
  const apiKey = config.openAiApiKey;

  const client: LlmClient = {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.openAiModel ?? DEFAULT_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1024,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          return { text: "", model: "mock", mocked: true };
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          model?: string;
        };

        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        return { text, model: data.model ?? config.openAiModel ?? DEFAULT_MODEL, mocked: false };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },

    async probeBatch(items) {
      return probeBatchSequential((text) => client.probe(text), items);
    },
  };

  return client;
}
