import type { AppConfig } from "../../config.js";
import { buildSingleProbeMessage, type BatchProbeItem } from "./batch-probe.js";
import type { LlmBatchProbeResult, LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
} as const;

type ClaudeResponse = {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: {
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
};

function extractText(data: ClaudeResponse): string {
  return (data.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!.trim())
    .join("\n\n")
    .trim();
}

function countWebSearches(data: ClaudeResponse): number {
  return data.usage?.server_tool_use?.web_search_requests ?? 0;
}

async function callClaudeWithWebSearch(
  apiKey: string,
  model: string,
  userContent: string,
  maxTokens: number,
): Promise<{ text: string; model: string; webSearchCount: number } | null> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userContent }],
      tools: [WEB_SEARCH_TOOL],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as ClaudeResponse;
  const text = extractText(data);
  if (!text) return null;

  return {
    text,
    model: data.model ?? model,
    webSearchCount: countWebSearches(data),
  };
}

export function createClaudeClient(config: AppConfig): LlmClient {
  const apiKey = config.anthropicApiKey;
  const model = config.anthropicModel ?? DEFAULT_MODEL;

  const client: LlmClient = {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const message = buildSingleProbeMessage(prompt);
        const result = await callClaudeWithWebSearch(apiKey, model, message, 2048);
        if (!result || !result.text) {
          return { text: "", model: "mock", mocked: true };
        }
        return {
          text: result.text,
          model: result.model,
          mocked: false,
          usedWebSearch: result.webSearchCount > 0,
        };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },

    async probeBatch(items: BatchProbeItem[]): Promise<LlmBatchProbeResult> {
      if (items.length === 0) {
        return { responses: [], model: "mock", mocked: true };
      }

      if (!apiKey) {
        return { responses: [], model: "mock", mocked: true };
      }

      try {
        const settled = await Promise.all(
          items.map(async (item) => {
            const result = await client.probe(item.text);
            return { index: item.index, result };
          }),
        );

        const responses = settled.map(({ index, result }) => ({
          index,
          text: result.text,
        }));

        const mocked = settled.some(({ result }) => result.mocked || !result.text);

        return {
          responses,
          model: settled.find(({ result }) => result.model)?.result.model ?? model,
          mocked,
          usedWebSearch: settled.some(({ result }) => result.usedWebSearch),
        };
      } catch {
        return { responses: [], model: "mock", mocked: true };
      }
    },
  };

  return client;
}
