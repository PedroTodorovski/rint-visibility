import type { AppConfig } from "../../config.js";
import { extractGroundingMetadata, supportRefsFromSpans } from "../gemini-grounding.js";
import { buildSingleProbeMessage } from "./batch-probe.js";
import {
  emptyCitedObject,
  emptyGeminiStructured,
  GEMINI_STRUCTURE_PROMPT_SHAPE,
  hydrateGeminiStructured,
  parseGeminiStructuredOutput,
} from "./gemini-structured.js";
import { SHOPPER_EVIDENCE_MISSING } from "./shopper-evidence.js";
import type { LlmClient, LlmProbeResult, LlmStructuredDiagnosticResult } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_COPY_MODEL = "gemini-2.5-flash";
const GROUNDING_MAX_OUTPUT_TOKENS = 8192;
const GENERATE_RETRY_DELAYS_MS = [0, 250, 800];

function mergeGroundingChunks(
  first: Array<{ uri: string; title?: string }>,
  second: Array<{ uri: string; title?: string }>,
): Array<{ uri: string; title?: string }> {
  const seen = new Map<string, { uri: string; title?: string }>();
  for (const chunk of [...first, ...second]) {
    const uri = chunk.uri.trim();
    if (!uri || seen.has(uri)) continue;
    seen.set(uri, { uri, title: chunk.title });
  }
  return [...seen.values()];
}

export type GeminiProbeExtras = {
  groundingUrls: string[];
};

type GeminiGenerateResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
};

export function visibleTextFromGeminiParts(
  parts?: Array<{ text?: string; thought?: boolean }>,
): string {
  return (parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function logGeminiGenerateFailed(input: {
  model: string;
  status?: number;
  finishReason?: string;
  blockReason?: string;
}): void {
  console.info(
    JSON.stringify({
      msg: "llm_generate_failed",
      provider: "gemini",
      model: input.model,
      status: input.status,
      finishReason: input.finishReason,
      blockReason: input.blockReason,
    }),
  );
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postGeminiGenerate(input: {
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{ ok: true; data: GeminiGenerateResponse } | { ok: false; status: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!res.ok) {
    logGeminiGenerateFailed({ model: input.model, status: res.status });
    return { ok: false, status: res.status };
  }
  const data = (await res.json()) as GeminiGenerateResponse;
  return { ok: true, data };
}

async function callGeminiPlainText(
  apiKey: string,
  model: string,
  userContent: string,
  temperature = 0.2,
  maxOutputTokens = 384,
): Promise<string | null> {
  const posted = await postGeminiGenerate({
    apiKey,
    model,
    timeoutMs: 20_000,
    body: {
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: {
        temperature,
        maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
  });
  if (!posted.ok) return null;
  const text = visibleTextFromGeminiParts(posted.data.candidates?.[0]?.content?.parts);
  return text || null;
}

async function callGeminiWithGrounding(
  apiKey: string,
  model: string,
  userContent: string,
  temperature = 0.7,
): Promise<{
  text: string;
  model: string;
  groundingUrls: string[];
  groundingChunks: Array<{ uri: string; title?: string }>;
  groundingSupports: ReturnType<typeof extractGroundingMetadata>["supports"];
} | null> {
  const body = {
    contents: [{ parts: [{ text: userContent }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature,
      maxOutputTokens: GROUNDING_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  for (let attempt = 0; attempt < GENERATE_RETRY_DELAYS_MS.length; attempt++) {
    await sleep(GENERATE_RETRY_DELAYS_MS[attempt] ?? 0);
    let posted: Awaited<ReturnType<typeof postGeminiGenerate>>;
    try {
      posted = await postGeminiGenerate({
        apiKey,
        model,
        timeoutMs: 120_000,
        body,
      });
    } catch {
      logGeminiGenerateFailed({ model });
      continue;
    }

    if (!posted.ok) {
      if (posted.status === 429 || posted.status === 503) continue;
      return null;
    }

    const candidate = posted.data.candidates?.[0];
    const text = visibleTextFromGeminiParts(candidate?.content?.parts);
    if (!text) {
      logGeminiGenerateFailed({
        model,
        finishReason: candidate?.finishReason,
        blockReason: posted.data.promptFeedback?.blockReason,
      });
      return null;
    }

    const grounding = extractGroundingMetadata(
      posted.data as Parameters<typeof extractGroundingMetadata>[0],
    );
    const groundingChunks = grounding.chunks.map((chunk) => ({
      uri: chunk.uri,
      title: chunk.title?.replace(/\s+/g, " ").trim() || undefined,
    }));
    const groundingUrls = groundingChunks.map((chunk) => chunk.uri);

    return {
      text,
      model,
      groundingUrls,
      groundingChunks,
      groundingSupports: grounding.supports,
    };
  }

  return null;
}

function mockStructuredFromShopperAnswer(): LlmStructuredDiagnosticResult["structured"] {
  return hydrateGeminiStructured({
    ...emptyGeminiStructured(),
    concorrente_citado_nome: "Decathlon",
    nome_marca_citada: "Burton",
    objetos_citados: [
      {
        ...emptyCitedObject(),
        marca: "Burton",
        loja: "Decathlon",
      },
      {
        ...emptyCitedObject(),
        loja: "Mercado Livre",
      },
    ],
  });
}

function buildDiagnosticTextPrompt(query: string): string {
  return `You are answering a real ecommerce shopper query in Brazil.

Shopper query:
"${query}"

REQUIRED:
1. Search the web with Google Search grounding.
2. Answer as Gemini would answer the shopper, citing real brands/products/URLs only when they appear in grounded search results.
3. Do not return JSON.
4. Do not invent a store, brand, product, or URL that search did not surface.
5. If a specific store or product is not in the grounded results, say it was not found. Do not recommend it anyway.
6. Answer in the same language as the shopper query.`;
}

function buildDiagnosticStructurePrompt(rawText: string): string {
  return `Search the web again with Google Search grounding, then convert the quoted Gemini-style answer below into strict JSON only.

Quoted answer:
"""
${rawText}
"""

Return exactly this JSON shape:
${GEMINI_STRUCTURE_PROMPT_SHAPE}

Rules:
- Do not add markdown.
- Use null or [] when the quoted answer and grounding did not state the fact. Do not invent.
- objetos_citados: one entry per distinct product or store named in the quoted answer or grounding.
- Put a fact on that object only (price, dimensions, quality, delivery time, rating, attributes). Copy the phrase as stated; do not normalize into a scale you did not see.
- Preserve URL only when it is explicit in the quoted answer or grounding.
- Do not infer a price if no price is cited.
- atributos are characteristics of THAT object only (material, color, size, warranty, etc.).
- Singular fields stay for compatibility: primary cited object, or the competitor if the client was not cited.
- Set cliente_foi_citado true only if the quoted answer recommends the shopper buy from that store or product. A mention that the store or product was not found is false.`;
}

function buildFounderActionCopyPrompt(input: {
  deterministicAction: string;
  contentBrief: Record<string, unknown>;
  fallbackCopy: string;
}): string {
  const brief = input.contentBrief;
  const useAttrs = Array.isArray(brief.use_attrs) ? brief.use_attrs.join(" | ") : "";
  const skipAttrs = Array.isArray(brief.skip_attrs) ? brief.skip_attrs.join(" | ") : "";
  const targetUrl = typeof brief.target_url === "string" ? brief.target_url : "";
  const skuName = typeof brief.sku_name === "string" ? brief.sku_name : "";
  const theme = typeof brief.theme === "string" ? brief.theme : "";
  const note =
    brief.grounding_note === "review_not_listing"
      ? "A IA buscou essa resposta em review, blog ou loja de outra marca."
      : "";
  return `Você é a camada final de redação do Rint para um fundador de e-commerce leigo.

Tarefa: escreva uma orientação em português do Brasil, clara, humana e direta.

REGRAS INEGOCIÁVEIS:
- Não adicione nenhum fato.
- Não crie números, atributos, URL, promessa ou diagnóstico novo.
- Se existir target_url, use exatamente o placeholder [URL_ALVO]. Não escreva outra URL.
- Inclua literalmente todos os itens de use_attrs.
- Se citar algum item de skip_attrs, cite apenas como algo que NÃO deve ser afirmado.
- Não use markdown, bullets, título ou JSON.
- Retorne apenas um parágrafo curto, com 2 a 5 frases.
- A resposta final precisa ter pelo menos 80 caracteres.

CHECKLIST OBRIGATÓRIO ANTES DE RESPONDER:
- placeholder [URL_ALVO] presente, se houver target_url.
- sku_name presente.
- use_attrs presentes literalmente.
- skip_attrs citados apenas com negação.

Dados fechados:
- target_url: ${targetUrl || "nenhuma"}
- sku_name: ${skuName}
- theme: ${theme}
- use_attrs: ${useAttrs || "nenhum"}
- skip_attrs: ${skipAttrs || "nenhum"}
- contexto: ${note || "sem contexto adicional"}

Frase técnica atual:
${input.deterministicAction}

Estilo desejado, mas você pode melhorar a fluidez:
${input.fallbackCopy}`;
}

export function createGeminiClient(config: AppConfig): LlmClient {
  const apiKey = config.geminiApiKey;
  const model = config.geminiModel ?? DEFAULT_MODEL;
  const copyModel = config.geminiCopyModel ?? DEFAULT_COPY_MODEL;

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

    async renderFounderAction(input) {
      if (!apiKey) {
        return { text: input.fallbackCopy, model: "mock", mocked: true };
      }

      try {
        const targetUrl =
          typeof input.contentBrief.target_url === "string"
            ? input.contentBrief.target_url.trim()
            : "";
        const promptInput = targetUrl
          ? {
              ...input,
              deterministicAction: input.deterministicAction.replaceAll(targetUrl, "[URL_ALVO]"),
              fallbackCopy: input.fallbackCopy.replaceAll(targetUrl, "[URL_ALVO]"),
              contentBrief: {
                ...input.contentBrief,
                target_url: "[URL_ALVO]",
              },
            }
          : input;
        const text = await callGeminiPlainText(
          apiKey,
          copyModel,
          buildFounderActionCopyPrompt(promptInput),
          0.2,
          1024,
        );
        const safeText =
          targetUrl && text
            ? text.replaceAll("[URL_ALVO]", targetUrl).replaceAll("URL_ALVO", targetUrl)
            : text;
        return {
          text: safeText ?? input.fallbackCopy,
          model: safeText ? copyModel : "mock",
          mocked: !safeText,
        };
      } catch {
        return { text: input.fallbackCopy, model: "mock", mocked: true };
      }
    },

    async diagnoseQuery(input): Promise<LlmStructuredDiagnosticResult> {
      if (!apiKey) {
        return {
          rawText:
            "Decathlon, Burton e Mercado Livre aparecem com frequência para quem busca prancha de snowboard no Brasil.",
          structured: mockStructuredFromShopperAnswer(),
          model: "mock",
          mocked: true,
          usedWebSearch: false,
          groundingUrls: [],
          groundingChunks: [],
          groundingSupports: [],
          calls: [
            { type: "text", usedWebSearch: false, model: "mock" },
            { type: "structure", usedWebSearch: false, model: "mock" },
          ],
        };
      }

      const textPrompt = buildDiagnosticTextPrompt(input.query);
      const first = await callGeminiWithGrounding(apiKey, model, textPrompt, input.temperature);
      if (!first?.text) {
        throw new Error(SHOPPER_EVIDENCE_MISSING);
      }

      const structurePrompt = buildDiagnosticStructurePrompt(first.text);
      const second = await callGeminiWithGrounding(
        apiKey,
        model,
        structurePrompt,
        input.temperature,
      );
      const structured = second?.text ? parseGeminiStructuredOutput(second.text) : null;
      const groundingChunks = mergeGroundingChunks(
        first.groundingChunks,
        second?.groundingChunks ?? [],
      );

      return {
        rawText: first.text,
        structured: structured ?? emptyGeminiStructured(),
        model,
        mocked: false,
        usedWebSearch: first.groundingUrls.length > 0 || (second?.groundingUrls.length ?? 0) > 0,
        groundingUrls: groundingChunks.map((chunk) => chunk.uri),
        groundingChunks,
        groundingSupports: supportRefsFromSpans(first.groundingSupports, first.groundingChunks),
        calls: [
          { type: "text", usedWebSearch: first.groundingUrls.length > 0, model: first.model },
          {
            type: "structure",
            usedWebSearch: (second?.groundingUrls.length ?? 0) > 0,
            model: second?.model ?? model,
          },
        ],
      };
    },
  };

  return client;
}
