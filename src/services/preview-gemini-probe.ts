import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config.js";
import {
  brandMentionedWithoutBuyLink,
  type ClientCitationEvidence,
  planClientSiteFollowUp,
  scoreClientCitation,
} from "../lib/citation-gold.js";
import { validationError } from "../lib/errors.js";
import { bindGroundingSupports } from "../lib/gemini-grounding.js";
import { resolveDiagnosticGrounding } from "../lib/grounding-resolve.js";
import {
  emptyGeminiStructured,
  type GeminiStructuredOutput,
  hydrateGeminiStructured,
} from "../lib/llm/gemini-structured.js";
import {
  assertUsableShopperEvidence,
  createLlmClients,
  enabledDiagnosticClients,
  isUsableShopperEvidence,
  type LlmClients,
  type LlmProviderId,
  SHOPPER_EVIDENCE_MISSING,
} from "../lib/llm/index.js";
import { mapPool } from "../lib/map-pool.js";
import { filterAliveUrls } from "../lib/url-validator.js";

export const PREVIEW_PROBE_MAX_QUERIES = 10;
const RUN_TTL_MS = 6 * 60 * 60 * 1000;

export type PreviewProbeQueryInput = {
  sku_id: string;
  query_text: string;
  product_url: string;
  product_name: string;
  product_attributes: string[];
};

export type PreviewProbeStoreIdentity = {
  name: string;
  domain: string | null;
};

export type PreviewProbeQueryResult = {
  id: string;
  sku_id: string;
  prompt_id: string;
  query_text: string;
  cliente_foi_citado: boolean;
  concorrente_citado_nome: string | null;
  concorrente_citado_url: string | null;
  gemini_raw: string;
  gemini_structured: GeminiStructuredOutput;
  executions: Array<{
    raw_text: string;
    structured: GeminiStructuredOutput;
    grounding_urls: string[];
    dead_urls: string[];
    model: string;
    mocked: boolean;
    provider?: LlmProviderId;
    citation: ClientCitationEvidence;
    grounding_supports?: Array<{ text: string; hosts: string[]; hrefs: string[] }>;
    follow_up?: boolean;
    follow_up_query?: string;
  }>;
  mocked: boolean;
  error: string | null;
};

export type PreviewProbeRun = {
  id: string;
  workspace_id: string;
  status: "running" | "completed" | "failed";
  done: number;
  total: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  queries: PreviewProbeQueryResult[];
};

export type PreviewProbeStartInput = {
  workspaceId: string;
  store: PreviewProbeStoreIdentity;
  queries: PreviewProbeQueryInput[];
};

export class PreviewGeminiProbeStore {
  private readonly runs = new Map<string, PreviewProbeRun>();

  get(id: string): PreviewProbeRun | null {
    this.sweep();
    const run = this.runs.get(id);
    if (!run) return null;
    return structuredClone(run);
  }

  create(input: PreviewProbeStartInput): PreviewProbeRun {
    this.sweep();
    const now = new Date().toISOString();
    const run: PreviewProbeRun = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      status: "running",
      done: 0,
      total: input.queries.length,
      error: null,
      created_at: now,
      completed_at: null,
      queries: [],
    };
    this.runs.set(run.id, run);
    return structuredClone(run);
  }

  appendQuery(runId: string, query: PreviewProbeQueryResult): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.queries.push(query);
    run.done = run.queries.length;
  }

  finish(runId: string, status: "completed" | "failed", error: string | null): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = status;
    run.error = error;
    run.completed_at = new Date().toISOString();
    run.done = run.queries.length;
  }

  private sweep(): void {
    const cutoff = Date.now() - RUN_TTL_MS;
    for (const [id, run] of this.runs) {
      if (new Date(run.created_at).getTime() < cutoff) this.runs.delete(id);
    }
  }
}

export function parsePreviewProbeBody(body: unknown): {
  store: PreviewProbeStoreIdentity;
  queries: PreviewProbeQueryInput[];
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const storeRecord =
    record.store && typeof record.store === "object"
      ? (record.store as Record<string, unknown>)
      : {};
  const name = typeof storeRecord.name === "string" ? storeRecord.name.trim() : "";
  if (!name) throw validationError("store.name is required");
  const domain =
    typeof storeRecord.domain === "string" && storeRecord.domain.trim()
      ? storeRecord.domain.trim()
      : null;

  if (!Array.isArray(record.queries) || record.queries.length === 0) {
    throw validationError("queries must be a non-empty array");
  }
  if (record.queries.length > PREVIEW_PROBE_MAX_QUERIES) {
    throw validationError(`queries must have at most ${PREVIEW_PROBE_MAX_QUERIES} items`);
  }

  const queries = record.queries.map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sku_id = typeof row.sku_id === "string" ? row.sku_id.trim() : "";
    const query_text = typeof row.query_text === "string" ? row.query_text.trim() : "";
    const product_url = typeof row.product_url === "string" ? row.product_url.trim() : "";
    const product_name = typeof row.product_name === "string" ? row.product_name.trim() : "";
    if (!sku_id) throw validationError(`queries[${index}].sku_id is required`);
    if (!query_text) throw validationError(`queries[${index}].query_text is required`);
    if (!product_url) throw validationError(`queries[${index}].product_url is required`);
    if (!product_name) throw validationError(`queries[${index}].product_name is required`);
    const product_attributes = Array.isArray(row.product_attributes)
      ? row.product_attributes.filter((value): value is string => typeof value === "string")
      : [];
    return { sku_id, query_text, product_url, product_name, product_attributes };
  });

  return { store: { name, domain }, queries };
}

async function runOneQuery(input: {
  store: PreviewProbeStoreIdentity;
  query: PreviewProbeQueryInput;
  llm: LlmClients;
  temperature: number;
}): Promise<PreviewProbeQueryResult> {
  const id = randomUUID();
  const enabled = enabledDiagnosticClients(input.llm);
  const primary = enabled[0];
  const diagnoseQuery = primary?.client.diagnoseQuery;
  if (!primary || !diagnoseQuery) {
    return emptyFailedQuery(id, input.query, "Diagnostic LLM client is not configured");
  }

  const result = await diagnoseQuery({
    query: input.query.query_text,
    storeName: input.store.name,
    domain: input.store.domain,
    productUrl: input.query.product_url,
    productName: input.query.product_name,
    productAttributes: input.query.product_attributes,
    temperature: input.temperature,
  });

  try {
    assertUsableShopperEvidence(result);
  } catch {
    return emptyFailedQuery(id, input.query, SHOPPER_EVIDENCE_MISSING);
  }

  const competitorUrl = result.structured.concorrente_citado_url;
  const validation = competitorUrl ? await filterAliveUrls([competitorUrl]) : new Map();
  const competitorAlive = competitorUrl ? validation.get(competitorUrl)?.alive === true : false;
  const deadUrls = competitorUrl && !competitorAlive ? [competitorUrl] : [];
  const resolved = await resolveDiagnosticGrounding(result);
  const citation = scoreClientCitation({
    text: result.rawText,
    identity: {
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.query.product_url,
      productName: input.query.product_name,
    },
    resolved,
    llmClaimedCited: result.structured.cliente_foi_citado,
  });
  const structured = hydrateGeminiStructured({
    ...result.structured,
    cliente_foi_citado: citation.cited,
    concorrente_citado_url: competitorAlive ? competitorUrl : null,
  });

  const executions: PreviewProbeQueryResult["executions"] = [
    {
      raw_text: result.rawText,
      structured,
      grounding_urls: result.groundingUrls,
      dead_urls: deadUrls,
      model: result.model,
      mocked: false,
      provider: primary.provider,
      citation,
      grounding_supports: bindGroundingSupports(result.groundingSupports, resolved),
    },
  ];

  let cited = citation.cited;
  let structuredOut = structured;

  if (
    brandMentionedWithoutBuyLink({
      text: result.rawText,
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.query.product_url,
      resolved: citation.resolved,
    })
  ) {
    const plan = planClientSiteFollowUp(input.store.name, input.query.product_name);
    console.info(
      JSON.stringify({
        msg: "client_site_follow_up",
        query: input.query.query_text,
        store: input.store.name,
      }),
    );
    const follow = await diagnoseQuery({
      query: plan.query,
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.query.product_url,
      productName: input.query.product_name,
      productAttributes: input.query.product_attributes,
      temperature: input.temperature,
    });
    if (isUsableShopperEvidence(follow)) {
      const followResolved = await resolveDiagnosticGrounding(follow);
      const followCitation = scoreClientCitation({
        text: follow.rawText,
        identity: {
          storeName: input.store.name,
          domain: input.store.domain,
          productUrl: input.query.product_url,
          productName: input.query.product_name,
        },
        resolved: followResolved,
        llmClaimedCited: follow.structured.cliente_foi_citado,
      });
      const followStructured = hydrateGeminiStructured({
        ...follow.structured,
        cliente_foi_citado: followCitation.cited,
      });
      executions.push({
        raw_text: follow.rawText,
        structured: followStructured,
        grounding_urls: follow.groundingUrls,
        dead_urls: [],
        model: follow.model,
        mocked: false,
        provider: primary.provider,
        citation: followCitation,
        grounding_supports: bindGroundingSupports(follow.groundingSupports, followResolved),
        follow_up: true,
        follow_up_query: plan.query,
      });
      if (followCitation.cited) cited = true;
      structuredOut = hydrateGeminiStructured({
        ...structuredOut,
        cliente_foi_citado: cited,
      });
    }
  }

  return {
    id,
    sku_id: input.query.sku_id,
    prompt_id: id,
    query_text: input.query.query_text,
    cliente_foi_citado: cited,
    concorrente_citado_nome: structuredOut.concorrente_citado_nome,
    concorrente_citado_url: structuredOut.concorrente_citado_url,
    gemini_raw: result.rawText,
    gemini_structured: structuredOut,
    executions,
    mocked: false,
    error: null,
  };
}

function emptyFailedQuery(
  id: string,
  query: PreviewProbeQueryInput,
  error: string,
): PreviewProbeQueryResult {
  return {
    id,
    sku_id: query.sku_id,
    prompt_id: id,
    query_text: query.query_text,
    cliente_foi_citado: false,
    concorrente_citado_nome: null,
    concorrente_citado_url: null,
    gemini_raw: "",
    gemini_structured: emptyGeminiStructured(),
    executions: [],
    mocked: true,
    error,
  };
}

export async function executePreviewProbeRun(input: {
  store: PreviewGeminiProbeStore;
  runId: string;
  identity: PreviewProbeStoreIdentity;
  queries: PreviewProbeQueryInput[];
  llm: LlmClients;
  concurrency: number;
}): Promise<void> {
  try {
    await mapPool(input.queries, input.concurrency, async (query) => {
      try {
        const result = await runOneQuery({
          store: input.identity,
          query,
          llm: input.llm,
          temperature: 0,
        });
        input.store.appendQuery(input.runId, result);
      } catch (error) {
        input.store.appendQuery(
          input.runId,
          emptyFailedQuery(
            randomUUID(),
            query,
            error instanceof Error ? error.message : SHOPPER_EVIDENCE_MISSING,
          ),
        );
      }
    });

    const snapshot = input.store.get(input.runId);
    const live = snapshot?.queries.filter((query) => !query.mocked && query.gemini_raw) ?? [];
    if (live.length === 0) {
      input.store.finish(
        input.runId,
        "failed",
        snapshot?.queries[0]?.error ?? SHOPPER_EVIDENCE_MISSING,
      );
      return;
    }
    input.store.finish(input.runId, "completed", null);
  } catch (error) {
    input.store.finish(
      input.runId,
      "failed",
      error instanceof Error ? error.message : SHOPPER_EVIDENCE_MISSING,
    );
  }
}

export function resolvePreviewLlm(config: AppConfig, llm?: LlmClients): LlmClients | null {
  if (llm) return llm;
  if (!config.geminiApiKey) return null;
  return createLlmClients(config);
}
