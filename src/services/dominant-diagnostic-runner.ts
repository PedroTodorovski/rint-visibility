import type { AppConfig } from "../config.js";
import { scoreClientCitation } from "../lib/citation-gold.js";
import { AppError } from "../lib/errors.js";
import { resolveGroundingUrls } from "../lib/grounding-resolve.js";
import {
  citedObjectsFromStructured,
  hydrateGeminiStructured,
  mergeCitedObjects,
} from "../lib/llm/gemini-structured.js";
import type { LlmClients, LlmStructuredDiagnosticResult } from "../lib/llm/index.js";
import { mapPool } from "../lib/map-pool.js";
import { filterAliveUrls } from "../lib/url-validator.js";
import { createIntegrationPorts } from "../ports/mock-adapters.js";
import { DEFAULT_PORT_TTL_MS, readThroughCache } from "../ports/read-through-cache.js";
import type { IntegrationRegistryConfig } from "../ports/types.js";
import type { DiagnosticQueryRow, DiagnosticSkuRow } from "../repositories/diagnostic-tables.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import type { ProductRow, PromptRow, StoreRow } from "../repositories/types.js";
import {
  assertRunLimits,
  groupQueriesByProduct,
  validateAndSnapshotSku,
} from "./diagnostic-input.js";
import { buildCitationFinancialRisks, buildDiagnosticOutput } from "./diagnostic-output.js";
import { computeTriage } from "./diagnostic-triage.js";
import {
  type DiagnosticPlan,
  type DiagnosticRunConfig,
  normalizeDiagnosticPlan,
  type QueryExecutionRecord,
  runConfigForPlan,
} from "./diagnostic-types.js";

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

async function executeQuery(input: {
  store: StoreRow;
  sku: DiagnosticSkuRow;
  prompt: PromptRow;
  llm: LlmClients;
  config: DiagnosticRunConfig;
}): Promise<Omit<DiagnosticQueryRow, "id" | "created_at">> {
  if (!input.llm.gemini.diagnoseQuery) {
    throw new Error("Gemini diagnostic client is not configured");
  }

  const executions: QueryExecutionRecord[] = [];

  for (let i = 0; i < input.config.executionsPerQuery; i++) {
    const result: LlmStructuredDiagnosticResult = await input.llm.gemini.diagnoseQuery({
      query: input.prompt.prompt_text,
      storeName: input.store.name,
      domain: input.store.domain,
      productUrl: input.sku.url,
      productName: input.sku.shopify_data.name,
      productAttributes: input.sku.shopify_data.attributes,
      temperature: input.config.geminiTemperature,
    });

    const competitorUrl = result.structured.concorrente_citado_url;
    const validation = competitorUrl ? await filterAliveUrls([competitorUrl]) : new Map();
    const competitorAlive = competitorUrl ? validation.get(competitorUrl)?.alive === true : false;
    const deadUrls = competitorUrl && !competitorAlive ? [competitorUrl] : [];
    const resolved = await resolveGroundingUrls(result.groundingUrls);
    const citation = scoreClientCitation({
      text: result.rawText,
      identity: {
        storeName: input.store.name,
        domain: input.store.domain,
        productUrl: input.sku.url,
        productName: input.sku.shopify_data.name,
      },
      resolved,
      llmClaimedCited: result.structured.cliente_foi_citado,
    });

    executions.push({
      raw_text: result.rawText,
      structured: {
        ...result.structured,
        cliente_foi_citado: citation.cited,
        concorrente_citado_url: competitorAlive ? competitorUrl : null,
      },
      grounding_urls: result.groundingUrls,
      dead_urls: deadUrls,
      model: result.model,
      mocked: result.mocked,
      citation,
    });
  }

  const citedCount = executions.filter(
    (execution) => execution.structured.cliente_foi_citado,
  ).length;
  const clientCited = citedCount >= Math.ceil(input.config.executionsPerQuery / 2);
  const competitorName = majority(
    executions,
    (execution) => execution.structured.concorrente_citado_nome,
  );
  const competitorUrl = majority(
    executions,
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
  const brand = majority(executions, (execution) => execution.structured.nome_marca_citada);
  const product = majority(executions, (execution) => execution.structured.produto_mencionado);

  return {
    job_id: input.sku.job_id,
    sku_id: input.sku.id,
    prompt_id: input.prompt.id,
    query_text: input.prompt.prompt_text,
    gemini_raw: executions.map((execution) => execution.raw_text).join("\n\n---\n\n"),
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
    executions: executions as unknown as Record<string, unknown>[],
  };
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

    const products = productsAll.sort((a, b) => a.position - b.position);
    const promptsByProduct = groupQueriesByProduct(products, activePrompts);
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
      });
      const row = await deps.repos.diagnosticSkus.create({
        job_id: payload.jobId,
        product_id: product.id,
        url: product.url,
        external_ref: product.external_ref,
        shopify_data: snapshot,
      });
      skuRows.push({ row, product, prompts: promptsByProduct.get(product.id) ?? [] });
    }

    const queryWork = skuRows.flatMap((sku) =>
      sku.prompts.map((prompt) => ({ sku: sku.row, prompt })),
    );
    const queryDrafts = await mapPool(
      queryWork,
      deps.config.diagnosticQueryConcurrency,
      async ({ sku, prompt }) =>
        executeQuery({
          store,
          sku,
          prompt,
          llm: deps.llm,
          config: runConfig,
        }),
    );
    const queryRows: DiagnosticQueryRow[] = [];
    for (const draft of queryDrafts) {
      queryRows.push(await deps.repos.diagnosticQueries.create(draft));
    }

    const { primary, selection: dominantSkuSelection } = selectDominantSku(skuRows, queryRows);
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

    const conversion = ports.ga4.getSkuConversionMetrics
      ? await cachePort("ga4", `conversion:${ref}:${cacheKeyBase}`, () =>
          ports.ga4.getSkuConversionMetrics!(ref, window),
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

    if (gold) {
      const triage = computeTriage({
        skus: skuRows.map((sku) => ({ id: sku.row.id, shopify: sku.row.shopify_data })),
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
        },
      });

      const output = buildDiagnosticOutput({
        jobId: payload.jobId,
        primarySku: primary.row,
        skus: skuRows.map((sku) => sku.row),
        queries: queryRows,
        track: triage.track,
        finance,
      });

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
        gemini_calls: queryRows.length * runConfig.executionsPerQuery * 2,
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
