import type { AppConfig } from "../config.js";
import {
  brandMentionedWithoutBuyLink,
  planClientSiteFollowUp,
  scoreClientCitation,
} from "../lib/citation-gold.js";
import {
  crownCompetitorSku,
  hostFromUrl,
  mergeFollowUpCitedObjects,
  planCitedOfferFollowUp,
} from "../lib/cited-offer.js";
import { resolveCitedOfferImage, stampStructuredCitedImage } from "../lib/cited-offer-image.js";
import { AppError } from "../lib/errors.js";
import {
  type BoundGroundingSupport,
  bindGroundingSupports,
  objectGroundingVerdicts,
} from "../lib/gemini-grounding.js";
import { resolveDiagnosticGrounding } from "../lib/grounding-resolve.js";
import {
  citedObjectsFromStructured,
  type GeminiCitedObject,
  hydrateGeminiStructured,
  mergeCitedObjects,
} from "../lib/llm/gemini-structured.js";
import {
  assertUsableShopperEvidence,
  enabledDiagnosticClients,
  isUsableShopperEvidence,
  type LlmClient,
  type LlmClients,
  type LlmProviderId,
  type LlmStructuredDiagnosticResult,
  queryCoversProviders,
  SHOPPER_EVIDENCE_MISSING,
  shopperEvidenceProvider,
} from "../lib/llm/index.js";
import { mapPool } from "../lib/map-pool.js";
import { filterAliveUrls } from "../lib/url-validator.js";
import { createIntegrationPorts } from "../ports/mock-adapters.js";
import { DEFAULT_PORT_TTL_MS, readThroughCache } from "../ports/read-through-cache.js";
import type { IntegrationRegistryConfig } from "../ports/types.js";
import type { DiagnosticQueryRow, DiagnosticSkuRow } from "../repositories/diagnostic-tables.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import type { ProductRow, PromptRow, StoreRow } from "../repositories/types.js";
import {
  copyDayPhotoQuery,
  type DayPhotoIndex,
  isDayPhotoCopy,
  loadDayPhotoIndex,
  lookupDayPhotoPair,
  queryFromQueryId,
  queryMeasuredAt,
  stampMeasuredAt,
} from "./day-photo.js";
import {
  assertRunLimits,
  groupQueriesByProduct,
  productsForDiagnosis,
  validateAndSnapshotSku,
} from "./diagnostic-input.js";
import { providersFromIntegrationConfig } from "./diagnostic-job-summary.js";
import { buildCitationFinancialRisks, buildDiagnosticOutput } from "./diagnostic-output.js";
import { computeTriage, publicStorefrontUnreadable } from "./diagnostic-triage.js";
import {
  type DiagnosticPlan,
  type DiagnosticRunConfig,
  normalizeDiagnosticPlan,
  type QueryExecutionRecord,
  runConfigForPlan,
} from "./diagnostic-types.js";
import {
  renderFounderActionWithGuardrails,
  type TrackLlmContentBriefForCopy,
} from "./founder-action-copy.js";

export type DominantDiagnosticJobPayload = {
  jobId: string;
  workspaceId: string;
  plan?: DiagnosticPlan;
  integrationConfig?: IntegrationRegistryConfig;
};

type RunnerDeps = {
  repos: VisibilityRepositories;
  llm: LlmClients;
  config: AppConfig;
};

function shopifyConnected(integrationConfig: IntegrationRegistryConfig | undefined): boolean {
  return Boolean(integrationConfig?.shopify?.shopDomain);
}

function planSnapshot(
  config: DiagnosticRunConfig,
  integrationConfig: IntegrationRegistryConfig | undefined,
) {
  return {
    plan: config.plan,
    phase: config.phase,
    max_skus: config.maxSkus,
    max_queries_per_sku: config.maxQueriesPerSku,
    executions_per_query: config.executionsPerQuery,
    gemini_temperature: config.geminiTemperature,
    providers: providersFromIntegrationConfig(integrationConfig),
    integrations: {
      shopify: Boolean(integrationConfig?.shopify?.shopDomain),
      meta: Boolean(integrationConfig?.meta?.adAccountId),
      ga4: Boolean(integrationConfig?.ga4?.propertyId),
      google_ads: Boolean(integrationConfig?.googleAds?.customerId),
      merchant_center: Boolean(integrationConfig?.merchantCenter?.merchantId),
      google_trends: Boolean(integrationConfig?.googleTrends?.apiKey),
      seo: Boolean(integrationConfig?.seo?.provider),
    },
  };
}

function majority<T>(items: T[], key: (item: T) => string | null): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function selectPrimarySku(
  skus: Array<{ row: DiagnosticSkuRow; product: ProductRow; prompts: PromptRow[] }>,
  queries: DiagnosticQueryRow[],
): ReturnType<typeof selectDominantSku> {
  const closed = skus.find((sku) => publicStorefrontUnreadable(sku.row.shopify_data));
  if (closed) {
    return {
      primary: closed,
      selection: {
        strategy: "closed_storefront_first",
        scope: "dominant_sku_within_cluster",
        selected_sku_id: closed.row.id,
        selected_product_id: closed.product.id,
      },
    };
  }
  return selectDominantSku(skus, queries);
}

export function selectDominantSku(
  skus: Array<{ row: DiagnosticSkuRow; product: ProductRow; prompts: PromptRow[] }>,
  queries: DiagnosticQueryRow[],
): {
  primary: { row: DiagnosticSkuRow; product: ProductRow; prompts: PromptRow[] };
  selection: Record<string, unknown>;
} {
  const scores = skus.map((sku, index) => {
    const skuQueries = queries.filter((query) => query.sku_id === sku.row.id);
    const missingClientCitations = skuQueries.filter((query) => !query.cliente_foi_citado).length;
    const competitorCitations = skuQueries.filter(
      (query) => query.concorrente_citado_nome || query.concorrente_citado_url,
    ).length;
    const validationPenalty = sku.row.validation_status === "invalid" ? 1 : 0;
    const score = missingClientCitations * 3 + competitorCitations * 2 + validationPenalty;

    return {
      index,
      sku_id: sku.row.id,
      product_id: sku.row.product_id,
      external_ref: sku.row.external_ref,
      query_count: skuQueries.length,
      missing_client_citations: missingClientCitations,
      competitor_citations: competitorCitations,
      validation_status: sku.row.validation_status,
      score,
    };
  });

  const winner = [...scores].sort((a, b) => b.score - a.score || a.index - b.index)[0];
  const primary = skus[winner?.index ?? 0];
  if (!primary) {
    throw new AppError(400, "VALIDATION_ERROR", "Nenhum SKU válido para diagnóstico");
  }

  return {
    primary,
    selection: {
      strategy: "highest_visibility_gap_score",
      scope: "dominant_sku_within_cluster",
      selected_sku_id: primary.row.id,
      selected_product_id: primary.row.product_id,
      scores,
    },
  };
}

/**
 * ADR-003 residual gap: stamp each cited object with its own grounding verdict — not just the
 * execution's aggregate one — computed together via `objectGroundingVerdicts` so co-mentioned
 * objects can disambiguate each other instead of each being checked in isolation.
 * `mergeCitedObjects` falls back to the per-execution boolean for objects left `undefined`.
 */
function stampObjectsGrounding(
  objects: GeminiCitedObject[] | undefined,
  supports: BoundGroundingSupport[],
  clientHosts: string[],
): GeminiCitedObject[] {
  const list = objects ?? [];
  const verdicts = objectGroundingVerdicts(
    list.map((object) => ({ names: [object.marca, object.produto, object.loja] })),
    supports,
    clientHosts,
  );
  return list.map((object, index) => {
    const matched = verdicts[index];
    return matched === undefined ? object : { ...object, grounding_confirmed_client: matched };
  });
}

async function recordDiagnoseExecution(input: {
  provider: LlmProviderId;
  result: LlmStructuredDiagnosticResult;
  store: StoreRow;
  sku: DiagnosticSkuRow;
  measuredAt: string;
  followUp?: { query: string };
}): Promise<QueryExecutionRecord> {
  assertUsableShopperEvidence(input.result);
  const competitorUrl = input.result.structured.concorrente_citado_url;
  const validation = competitorUrl ? await filterAliveUrls([competitorUrl]) : new Map();
  const competitorAlive = competitorUrl ? validation.get(competitorUrl)?.alive === true : false;
  const identity = {
    storeName: input.store.name,
    domain: input.store.domain,
    productUrl: input.sku.url,
    productName: input.sku.shopify_data.name,
  };
  const citation = scoreClientCitation({
    text: input.result.rawText,
    identity,
    resolved: await resolveDiagnosticGrounding(input.result),
    llmClaimedCited: input.result.structured.cliente_foi_citado,
  });
  const resolved = citation.resolved;
  const boundSupports = bindGroundingSupports(input.result.groundingSupports, resolved);
  return {
    raw_text: input.result.rawText,
    structured: {
      ...input.result.structured,
      objetos_citados: stampObjectsGrounding(
        input.result.structured.objetos_citados,
        boundSupports,
        citation.client_hosts,
      ),
      cliente_foi_citado: citation.cited,
      concorrente_citado_url: competitorAlive ? competitorUrl : null,
    },
    grounding_urls: input.result.groundingUrls,
    dead_urls: competitorUrl && !competitorAlive ? [competitorUrl] : [],
    model: input.result.model,
    mocked: input.result.mocked,
    provider: input.provider,
    citation,
    grounding_supports: boundSupports,
    measured_at: input.measuredAt,
    ...(input.followUp ? { follow_up: true as const, follow_up_query: input.followUp.query } : {}),
  };
}

async function diagnoseOrSkip(input: {
  client: LlmClient;
  query: string;
  store: StoreRow;
  sku: DiagnosticSkuRow;
  temperature: number;
}): Promise<LlmStructuredDiagnosticResult | null> {
  if (!input.client.diagnoseQuery) return null;
  try {
    const result = await input.client.diagnoseQuery({
      query: input.query,
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.sku.url,
      productName: input.sku.shopify_data.name,
      productAttributes: input.sku.shopify_data.attributes,
      temperature: input.temperature,
    });
    if (!isUsableShopperEvidence(result)) return null;
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === SHOPPER_EVIDENCE_MISSING) return null;
    throw error;
  }
}

async function executeQuery(input: {
  store: StoreRow;
  sku: DiagnosticSkuRow;
  prompt: PromptRow;
  llm: LlmClients;
  config: DiagnosticRunConfig;
  dayPhotos: DayPhotoIndex;
}): Promise<Omit<DiagnosticQueryRow, "id" | "created_at">> {
  const enabled = enabledDiagnosticClients(input.llm);
  if (enabled.length === 0) {
    throw new Error("Diagnostic LLM client is not configured");
  }

  const existing = lookupDayPhotoPair(input.dayPhotos, input.sku.url, input.prompt.prompt_text);
  if (
    existing &&
    queryCoversProviders(
      existing.source,
      enabled.map((row) => row.provider),
    )
  ) {
    return copyDayPhotoQuery({
      source: existing.source,
      jobId: input.sku.job_id,
      skuId: input.sku.id,
      promptId: input.prompt.id,
      queryText: input.prompt.prompt_text,
    });
  }

  const executions: QueryExecutionRecord[] = [];
  const measuredAt = new Date().toISOString();
  const existingExecutions = (existing?.source.executions ??
    []) as unknown as QueryExecutionRecord[];

  for (const { provider, client } of enabled) {
    const reused = existingExecutions.filter(
      (execution) =>
        execution.follow_up !== true &&
        shopperEvidenceProvider(execution) === provider &&
        isUsableShopperEvidence(execution),
    );
    if (reused.length > 0 && existing) {
      executions.push(
        ...stampMeasuredAt(
          reused,
          queryMeasuredAt(existing.source),
          queryFromQueryId(existing.source) ?? existing.source.id,
        ),
      );
      continue;
    }

    for (let i = 0; i < input.config.executionsPerQuery; i++) {
      const result = await diagnoseOrSkip({
        client,
        query: input.prompt.prompt_text,
        store: input.store,
        sku: input.sku,
        temperature: input.config.geminiTemperature,
      });
      if (!result) continue;
      executions.push(
        await recordDiagnoseExecution({
          provider,
          result,
          store: input.store,
          sku: input.sku,
          measuredAt,
        }),
      );
    }
  }

  const first = executions.find((execution) => execution.follow_up !== true);
  if (!first) {
    throw new Error(SHOPPER_EVIDENCE_MISSING);
  }

  const followClient =
    enabled.find((row) => row.provider === shopperEvidenceProvider(first))?.client ??
    enabled[0]?.client;
  if (
    followClient &&
    brandMentionedWithoutBuyLink({
      text: first.raw_text,
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.sku.url,
      resolved: first.citation.resolved,
    })
  ) {
    const plan = planClientSiteFollowUp(input.store.name, input.sku.shopify_data.name);
    console.info(
      JSON.stringify({
        msg: "client_site_follow_up",
        query: input.prompt.prompt_text,
        store: input.store.name,
        provider: shopperEvidenceProvider(first),
      }),
    );
    const follow = await diagnoseOrSkip({
      client: followClient,
      query: plan.query,
      store: input.store,
      sku: input.sku,
      temperature: input.config.geminiTemperature,
    });
    if (follow) {
      executions.push(
        await recordDiagnoseExecution({
          provider: shopperEvidenceProvider(first),
          result: follow,
          store: input.store,
          sku: input.sku,
          measuredAt,
          followUp: { query: plan.query },
        }),
      );
    }
  }

  const primaryExecutions = executions.filter((execution) => !execution.follow_up);
  const geminiPrimary = primaryExecutions.filter(
    (execution) => shopperEvidenceProvider(execution) === "gemini",
  );
  const citedCount = executions.filter(
    (execution) => execution.structured.cliente_foi_citado,
  ).length;
  const clientCited =
    citedCount >= Math.ceil(input.config.executionsPerQuery / 2) ||
    executions.some((execution) => execution.follow_up && execution.structured.cliente_foi_citado);
  const competitorName = majority(
    primaryExecutions,
    (execution) => execution.structured.concorrente_citado_nome,
  );
  const competitorUrl = majority(
    primaryExecutions,
    (execution) => execution.structured.concorrente_citado_url,
  );
  const attrs = [
    ...new Set(
      executions.flatMap((execution) => execution.structured.atributos_mencionados_gemini),
    ),
  ];
  const citedPrice =
    executions.find((execution) => execution.structured.preco_citado)?.structured.preco_citado ??
    null;
  const brand = majority(primaryExecutions, (execution) => execution.structured.nome_marca_citada);
  const product = majority(
    primaryExecutions,
    (execution) => execution.structured.produto_mencionado,
  );

  return {
    job_id: input.sku.job_id,
    sku_id: input.sku.id,
    prompt_id: input.prompt.id,
    query_text: input.prompt.prompt_text,
    gemini_raw: (geminiPrimary.length > 0 ? geminiPrimary : primaryExecutions)
      .map((execution) => execution.raw_text)
      .join("\n\n---\n\n"),
    gemini_structured: hydrateGeminiStructured({
      cliente_foi_citado: clientCited,
      concorrente_citado_nome: competitorName,
      concorrente_citado_url: competitorUrl,
      atributos_mencionados_gemini: attrs,
      preco_citado: citedPrice,
      nome_marca_citada: brand,
      produto_mencionado: product,
      objetos_citados: mergeCitedObjects(
        executions.map((execution) => citedObjectsFromStructured(execution.structured)),
        executions.map((execution) => execution.structured.cliente_foi_citado),
      ),
    }),
    cliente_foi_citado: clientCited,
    concorrente_citado_nome: competitorName,
    concorrente_citado_url: competitorUrl,
    atributos_mencionados_gemini: attrs,
    temperatura_gemini: input.config.geminiTemperature,
    num_execucoes: input.config.executionsPerQuery,
    confianca:
      input.config.executionsPerQuery > 1
        ? `${citedCount} de ${input.config.executionsPerQuery} execuções citaram você`
        : null,
    executions: stampMeasuredAt(executions, measuredAt) as unknown as Record<string, unknown>[],
  };
}

type QueryDraft = Omit<DiagnosticQueryRow, "id" | "created_at">;

async function completeCitedOffers(input: {
  store: StoreRow;
  skuRows: Array<{ row: DiagnosticSkuRow }>;
  drafts: QueryDraft[];
  llm: LlmClients;
  config: DiagnosticRunConfig;
}): Promise<{ drafts: QueryDraft[]; followUps: number }> {
  const enabled = enabledDiagnosticClients(input.llm);
  const primary = enabled[0];
  if (!primary?.client.diagnoseQuery) return { drafts: input.drafts, followUps: 0 };
  let followUps = 0;
  const bySku = new Map<string, QueryDraft[]>();
  for (const draft of input.drafts) {
    const list = bySku.get(draft.sku_id) ?? [];
    list.push(draft);
    bySku.set(draft.sku_id, list);
  }

  for (const sku of input.skuRows) {
    const skuDrafts = bySku.get(sku.row.id);
    if (!skuDrafts?.length) continue;
    if (skuDrafts.every(isDayPhotoCopy)) continue;
    const objectsByQuery = skuDrafts.map((draft) =>
      citedObjectsFromStructured(draft.gemini_structured),
    );
    const citedByQuery = skuDrafts.map((draft) => draft.gemini_structured.cliente_foi_citado);
    const crown = crownCompetitorSku({
      client: {
        name: sku.row.shopify_data.name,
        brand: sku.row.shopify_data.brand,
        url: sku.row.url,
      },
      objectsByQuery,
      citedByQuery,
    });
    const plan = planCitedOfferFollowUp(crown);
    if (!plan) continue;

    const result = await diagnoseOrSkip({
      client: primary.client,
      query: plan.query,
      store: input.store,
      sku: sku.row,
      temperature: input.config.geminiTemperature,
    });
    const last = skuDrafts[skuDrafts.length - 1];
    if (!last || isDayPhotoCopy(last) || !result) continue;
    const followUpIdentity = {
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: sku.row.url,
      productName: sku.row.shopify_data.name,
    };
    const resolved = await resolveDiagnosticGrounding(result);
    const citation = scoreClientCitation({
      text: result.rawText,
      identity: followUpIdentity,
      resolved,
      llmClaimedCited: result.structured.cliente_foi_citado,
    });
    const followUpSupports = bindGroundingSupports(result.groundingSupports, resolved);
    const stampedResultStructured = {
      ...result.structured,
      objetos_citados: stampObjectsGrounding(
        result.structured.objetos_citados,
        followUpSupports,
        citation.client_hosts,
      ),
    };
    const existing = citedObjectsFromStructured(last.gemini_structured);
    const incoming = citedObjectsFromStructured(stampedResultStructured);
    last.gemini_structured = hydrateGeminiStructured({
      ...last.gemini_structured,
      objetos_citados: mergeFollowUpCitedObjects(existing, incoming),
    });
    const executions = [...((last.executions ?? []) as unknown as QueryExecutionRecord[])];
    executions.push({
      raw_text: result.rawText,
      structured: stampedResultStructured,
      grounding_urls: result.groundingUrls,
      dead_urls: [],
      model: result.model,
      mocked: result.mocked,
      provider: primary.provider,
      citation,
      grounding_supports: followUpSupports,
      follow_up: true,
    });
    last.executions = executions as unknown as Record<string, unknown>[];
    followUps += 1;
  }

  return { drafts: input.drafts, followUps };
}

async function hydrateCitedOfferImages(input: {
  skuRows: Array<{ row: DiagnosticSkuRow }>;
  drafts: QueryDraft[];
}): Promise<QueryDraft[]> {
  const bySku = new Map<string, QueryDraft[]>();
  for (const draft of input.drafts) {
    const list = bySku.get(draft.sku_id) ?? [];
    list.push(draft);
    bySku.set(draft.sku_id, list);
  }

  for (const sku of input.skuRows) {
    const skuDrafts = bySku.get(sku.row.id);
    if (!skuDrafts?.length) continue;
    if (skuDrafts.every(isDayPhotoCopy)) continue;
    const objectsByQuery = skuDrafts.map((draft) =>
      citedObjectsFromStructured(draft.gemini_structured),
    );
    const citedByQuery = skuDrafts.map((draft) => draft.gemini_structured.cliente_foi_citado);
    const crown = crownCompetitorSku({
      client: {
        name: sku.row.shopify_data.name,
        brand: sku.row.shopify_data.brand,
        url: sku.row.url,
      },
      objectsByQuery,
      citedByQuery,
    });
    if (crown.confidence !== "clear" || !crown.productKey) continue;
    const groundingUrls = skuDrafts.flatMap((draft) => {
      const executions = (draft.executions ?? []) as Array<{ grounding_urls?: string[] }>;
      return executions.flatMap((execution) => execution.grounding_urls ?? []);
    });
    const hit = await resolveCitedOfferImage({
      imagemUrl: crown.imagem_url,
      productUrl: crown.url,
      groundingUrls,
    });
    if (!hit) continue;
    for (const draft of skuDrafts) {
      draft.gemini_structured = stampStructuredCitedImage(
        draft.gemini_structured,
        crown.productKey,
        hit.url,
      );
    }
  }
  return input.drafts;
}

async function sendWebhook(input: {
  webhookUrl: string | null;
  payload: Record<string, unknown>;
  secret: string | null;
}): Promise<void> {
  if (!input.webhookUrl) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.secret) headers["X-Rint-Webhook-Secret"] = input.secret;

  await fetch(input.webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export async function runDominantDiagnostic(
  deps: RunnerDeps,
  payload: DominantDiagnosticJobPayload,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const plan = normalizeDiagnosticPlan(payload.plan);
  const runConfig = runConfigForPlan(plan, {
    maxSkus: deps.config.diagnosticMaxSkus,
    maxQueriesPerSku: deps.config.diagnosticMaxQueriesPerSku,
  });

  const job = await deps.repos.jobs.updateStatus(payload.jobId, "running", {
    started_at: startedAt,
  });

  try {
    const gold = shopifyConnected(payload.integrationConfig);

    const store = await deps.repos.stores.requireByWorkspaceId(payload.workspaceId);
    const dayPhotos = await loadDayPhotoIndex(deps.repos, store.id);
    const [productsAll, prompts] = await Promise.all([
      deps.repos.products.listByStoreId(store.id),
      deps.repos.prompts.listByStoreId(store.id),
    ]);

    if (productsAll.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Nenhum SKU configurado para diagnóstico");
    }

    const activePrompts = prompts.filter((prompt) => prompt.active);
    if (activePrompts.length === 0) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Nenhuma query ativa configurada para diagnóstico",
      );
    }

    const promptsByProduct = groupQueriesByProduct(productsAll, activePrompts);
    const products = productsForDiagnosis(productsAll, promptsByProduct);
    if (products.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Nenhum SKU com pergunta ativa para diagnóstico");
    }
    assertRunLimits(products, promptsByProduct, runConfig);

    const { ports, window } = createIntegrationPorts(payload.integrationConfig);
    await deps.repos.jobs.updateStatus(payload.jobId, "running", {
      started_at: startedAt,
      error_message: undefined,
    });

    const skuRows: Array<{ row: DiagnosticSkuRow; product: ProductRow; prompts: PromptRow[] }> = [];
    for (const product of products) {
      const snapshot = await validateAndSnapshotSku(product, ports.shopifyProduct, {
        shopifyConnected: gold,
        shopDomain: payload.integrationConfig?.shopify?.shopDomain ?? null,
      });
      const searchConsole = await ports.searchConsole.getOwnedSurfaces({
        storefrontHost: hostFromUrl(product.url),
      });
      const snapshotWithSurfaces = {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          ownedSurfaces: {
            storefrontHosts: [hostFromUrl(product.url)].filter((host): host is string =>
              Boolean(host),
            ),
            ownedContentHosts: searchConsole.ownedContentHosts,
            ownedContentPaths: searchConsole.ownedContentPaths,
            searchConsoleProperties: searchConsole.properties,
            ownedContentCandidates: searchConsole.ownedContentCandidates,
            meta: searchConsole.meta,
          },
        },
      };
      const row = await deps.repos.diagnosticSkus.create({
        job_id: payload.jobId,
        product_id: product.id,
        url: product.url,
        external_ref: product.external_ref,
        shopify_data: snapshotWithSurfaces,
      });
      skuRows.push({ row, product, prompts: promptsByProduct.get(product.id) ?? [] });
    }

    const storefrontClosed = skuRows.some((sku) =>
      publicStorefrontUnreadable(sku.row.shopify_data),
    );
    // Closed door is already the week's cause — do not wait on shopper text.
    const queryWork = skuRows.flatMap((sku) => {
      if (publicStorefrontUnreadable(sku.row.shopify_data)) return [];
      return sku.prompts.map((prompt) => ({ sku: sku.row, prompt }));
    });
    const queryDrafts = (
      await mapPool(
        queryWork,
        deps.config.diagnosticQueryConcurrency,
        async ({ sku, prompt }): Promise<QueryDraft | null> => {
          try {
            return await executeQuery({
              store,
              sku,
              prompt,
              llm: deps.llm,
              config: runConfig,
              dayPhotos,
            });
          } catch (error) {
            if (
              storefrontClosed &&
              error instanceof Error &&
              error.message === SHOPPER_EVIDENCE_MISSING
            ) {
              return null;
            }
            throw error;
          }
        },
      )
    ).filter((draft): draft is QueryDraft => draft != null);
    const completed = await completeCitedOffers({
      store,
      skuRows,
      drafts: queryDrafts,
      llm: deps.llm,
      config: runConfig,
    });
    const imagedDrafts = await hydrateCitedOfferImages({
      skuRows,
      drafts: completed.drafts,
    });
    const queryRows: DiagnosticQueryRow[] = [];
    for (const draft of imagedDrafts) {
      queryRows.push(await deps.repos.diagnosticQueries.create(draft));
    }

    const { primary, selection: dominantSkuSelection } = selectPrimarySku(skuRows, queryRows);
    const probeRunId = job.probe_run_id;
    if (!probeRunId) {
      throw new AppError(500, "INTERNAL_ERROR", "Diagnostic job is missing probe_run_id");
    }

    const cachePort = <T>(portName: string, cacheKey: string, fetcher: () => Promise<T>) =>
      readThroughCache(
        deps.repos.perRunReadCache,
        probeRunId,
        portName,
        cacheKey,
        DEFAULT_PORT_TTL_MS,
        fetcher,
      );

    const cacheKeyBase = `${window.start}:${window.end}`;
    const ref = primary.product.external_ref ?? primary.product.id;
    const [ga4Read, shopifyRead, metaRead, googleAdsRead, merchantRead, trendsRead] =
      await Promise.all([
        cachePort("ga4", `ai-referral:${cacheKeyBase}`, () =>
          ports.ga4.getAiReferralRevenue(window),
        ),
        cachePort("shopify", `revenue:${ref}:${cacheKeyBase}`, () =>
          ports.shopify.getSkuRevenue(ref, window),
        ),
        cachePort("meta", `cac:${ref}:${cacheKeyBase}`, () => ports.meta.getSkuCac(ref, window)),
        cachePort("google_ads", `waste:${ref}:${cacheKeyBase}`, () =>
          ports.googleAds.getSkuWaste(ref, window),
        ),
        cachePort("merchant_center", `status:${ref}:${cacheKeyBase}`, () =>
          ports.merchantCenter.getProductStatus(ref, window),
        ),
        cachePort(
          "google_trends",
          `interest:${primary.row.shopify_data.name}:${cacheKeyBase}`,
          () => ports.googleTrends.getInterest(primary.row.shopify_data.name, window),
        ),
      ]);

    const getSkuConversionMetrics = ports.ga4.getSkuConversionMetrics;
    const conversion = getSkuConversionMetrics
      ? await cachePort("ga4", `conversion:${ref}:${cacheKeyBase}`, () =>
          getSkuConversionMetrics(ref, window),
        )
      : null;

    const competitorUrls = [
      ...new Set(
        queryRows.map((query) => query.concorrente_citado_url).filter(Boolean) as string[],
      ),
    ];
    const seoGaps = await Promise.all(
      competitorUrls.map((competitorUrl) =>
        ports.seo.getAuthorityGap({ competitorUrl, clientDomain: store.domain }),
      ),
    );

    const finance = {
      ga4: ga4Read.data,
      shopify: shopifyRead.data,
      meta: metaRead.data,
      conversion: conversion?.data ?? null,
      googleAds: googleAdsRead.data,
      merchantCenter: merchantRead.data,
      trends: trendsRead.data,
      seoGaps,
    };

    let assignedTrack: string | null = null;
    const persistEnvelope = gold || storefrontClosed;

    if (persistEnvelope) {
      // Primary SKU first: computeTriage's media-waste check reads skus[0]'s price
      // as the "card price" — it must be the same SKU buildDiagnosticOutput uses
      // below (primary.row), or the triage decision and the track_midia trace can
      // disagree about whose price justified the call.
      const triageSkus = [primary, ...skuRows.filter((sku) => sku.row.id !== primary.row.id)];
      const triage = computeTriage({
        skus: triageSkus.map((sku) => ({ id: sku.row.id, shopify: sku.row.shopify_data })),
        queries: queryRows,
        mediaSignals: {
          meta: metaRead.data,
          googleAds: googleAdsRead.data,
          merchantCenter: merchantRead.data,
          shopifyRevenue: shopifyRead.data,
        },
      });

      await deps.repos.triageResults.create({
        job_id: payload.jobId,
        sku_id: primary.row.id,
        coherence_level: triage.coherenceLevel,
        track_assigned: triage.track,
        checks: {
          ...triage.checks,
          dominant_sku_selection: dominantSkuSelection,
          config: planSnapshot(runConfig, payload.integrationConfig),
          decision_trace: triage.trace,
        },
      });

      const output = buildDiagnosticOutput({
        jobId: payload.jobId,
        primarySku: primary.row,
        skus: skuRows.map((sku) => sku.row),
        queries: queryRows,
        track: triage.track,
        coherenceLevel: triage.coherenceLevel,
        finance,
      });

      if (triage.track === "track_llm") {
        const contentBrief = output.diagnostic.next_steps.content_brief as
          | TrackLlmContentBriefForCopy
          | undefined;
        const deterministicAction =
          typeof output.diagnostic.next_steps.first_action === "string"
            ? output.diagnostic.next_steps.first_action
            : "";
        if (contentBrief && deterministicAction) {
          const copy = await renderFounderActionWithGuardrails({
            deterministicAction,
            brief: contentBrief,
            llm: deps.llm.gemini,
          });
          output.diagnostic.next_steps = {
            ...output.diagnostic.next_steps,
            first_action: copy.first_action,
            content_brief: {
              ...contentBrief,
              copy_source: copy.copy_source,
              copy_model: copy.copy_model,
              copy_fallback_reason: copy.copy_fallback_reason,
              deterministic_first_action: deterministicAction,
            },
          };
        }
      }

      await deps.repos.financialRisk.createMany(output.risks);
      await deps.repos.diagnostics.create(output.diagnostic);
      assignedTrack = triage.track;
    } else {
      await deps.repos.financialRisk.createMany(
        buildCitationFinancialRisks({
          jobId: payload.jobId,
          primarySku: primary.row,
          skus: skuRows.map((sku) => sku.row),
          queries: queryRows,
          finance,
        }),
      );
    }
    await deps.repos.usageEvents.create({
      job_id: payload.jobId,
      tokens_consumed: 0,
      apis_called: {
        gemini_calls: queryRows.length * runConfig.executionsPerQuery * 2 + completed.followUps * 2,
        shopify_reads: products.length + 1,
        ga4_reads: 2,
        meta_reads: 1,
        google_ads_reads: 1,
        merchant_center_reads: 1,
        google_trends_reads: 1,
        seo_reads: seoGaps.length,
      },
    });

    await deps.repos.jobs.updateStatus(payload.jobId, "completed", {
      completed_at: new Date().toISOString(),
    });

    await sendWebhook({
      webhookUrl: job.webhook_url,
      secret: deps.config.diagnosticWebhookSecret,
      payload: { job_id: payload.jobId, status: "completed", track: assignedTrack },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostic job failed";
    await deps.repos.jobs.updateStatus(payload.jobId, "failed", {
      completed_at: new Date().toISOString(),
      error_message: message,
    });

    await sendWebhook({
      webhookUrl: job.webhook_url,
      secret: deps.config.diagnosticWebhookSecret,
      payload: { job_id: payload.jobId, status: "failed", error: message },
    });
  }
}
