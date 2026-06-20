import type { AppConfig } from "../../config.js";
import { extractGroundingMetadata } from "../gemini-grounding.js";
import { buildSingleProbeMessage } from "./batch-probe.js";
import type { LlmBatchProbeResult, LlmClient, LlmProbeResult } from "./types.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

export type GeminiProbeExtras = {
  groundingUrls: string[];
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
};

async function callGeminiWithGrounding(
  apiKey: string,
  model: string,
  userContent: string,
): Promise<{ text: string; model: string; groundingUrls: string[] } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userContent }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as GeminiGenerateResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) return null;

  const grounding = extractGroundingMetadata(data);
  const groundingUrls = grounding.chunks.map((c) => c.uri);

  return { text, model, groundingUrls };
}

export function createGeminiClient(config: AppConfig): LlmClient {
  const apiKey = config.geminiApiKey;
  const model = config.geminiModel ?? DEFAULT_MODEL;

  const client: LlmClient = {
    async probe(prompt: string): Promise<LlmProbeResult> {
      if (!apiKey) {
        return { text: "", model: "mock", mocked: true };
      }

      try {
        const message = buildSingleProbeMessage(prompt);
        const result = await callGeminiWithGrounding(apiKey, model, message);
        if (!result?.text) {
          return { text: "", model: "mock", mocked: true };
        }

        return {
          text: result.text,
          model: result.model,
          mocked: false,
          usedWebSearch: result.groundingUrls.length > 0,
          groundingUrls: result.groundingUrls,
        };
      } catch {
        return { text: "", model: "mock", mocked: true };
      }
    },

    async probeBatch(items) {
      if (items.length === 0) {
        return { responses: [], model: "mock", mocked: true };
      }

      if (!apiKey) {
        return { responses: [], model: "mock", mocked: true };
      }

      const responses: Array<{ index: number; text: string; groundingUrls?: string[] }> = [];
      let mocked = false;
      let batchModel = model;
      let usedWebSearch = false;

      for (const item of items) {
        const result = await client.probe(item.text);
        if (result.mocked || !result.text) mocked = true;
        batchModel = result.model;
        if (result.usedWebSearch) usedWebSearch = true;
        responses.push({
          index: item.index,
          text: result.text,
          groundingUrls: result.groundingUrls,
        });
      }

      return {
        responses,
        model: batchModel,
        mocked,
        usedWebSearch,
      };
    },
  };

  return client;
}
