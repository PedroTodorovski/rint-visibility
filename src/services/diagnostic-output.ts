import { type ClassifiedBrandSurface, classifyBrandSurface } from "../lib/citation-gold.js";
import { crownCompetitorSku, hostFromUrl, planCitedOfferFollowUp } from "../lib/cited-offer.js";
import type {
  Ga4AiReferralRevenue,
  GoogleAdsSkuWaste,
  MerchantCenterProductStatus,
  MetaSkuCac,
  ProductConversionMetrics,
  SeoAuthorityGap,
  ShopifySkuRevenue,
  TrendsInterest,
} from "../ports/types.js";
import type {
  CreateDiagnosticInput,
  CreateFinancialRiskInput,
  DiagnosticQueryRow,
  DiagnosticSkuRow,
} from "../repositories/diagnostic-tables.js";
import { publicStorefrontUnreadable } from "./diagnostic-triage.js";
import type { DiagnosticTrack, ShopifyProductSnapshot } from "./diagnostic-types.js";
import { buildTrackLlmSupportLine } from "./founder-action-copy.js";
import {
  catalogFoundationFromFields,
  formulateTrackLlmFirstAction,
  themeFromQuerySet,
} from "./llm-out-first-action.js";
import { formulateTrackProdutoFirstAction } from "./produto-out-first-action.js";
import { judgeProductWeek } from "./produto-week-judge.js";
import { aggregateCitationCounts, computeRevenueGap } from "./revenue-gap-engine.js";
import {
  type SearchConsoleUrlMatch,
  selectSearchConsoleUrl,
} from "./search-console-url-matcher.js";

export type DiagnosticOutputInput = {
  jobId: string;
  primarySku: DiagnosticSkuRow;
  skus: DiagnosticSkuRow[];
  queries: DiagnosticQueryRow[];
  track: DiagnosticTrack;
  coherenceLevel?: "coerente" | "parcialmente_coerente" | "incoerente";
  finance: {
    ga4: Ga4AiReferralRevenue;
    shopify: ShopifySkuRevenue;
    meta: MetaSkuCac;
    conversion: ProductConversionMetrics | null;
    googleAds: GoogleAdsSkuWaste | null;
    merchantCenter: MerchantCenterProductStatus | null;
    trends: TrendsInterest | null;
    seoGaps: SeoAuthorityGap[];
  };
};

export type DiagnosticOutput = {
  risks: CreateFinancialRiskInput[];
  diagnostic: CreateDiagnosticInput;
};

type CitationFinanceInput = Omit<DiagnosticOutputInput, "track">;

function topCompetitorName(queries: DiagnosticQueryRow[]): string | null {
  const counts = new Map<string, number>();
  for (const query of queries) {
    const name = query.concorrente_citado_nome?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function instantiatedHeadline(skuName: string, queries: DiagnosticQueryRow[]): string {
  const competitor = topCompetitorName(queries);
  if (competitor) return `A IA recomenda ${competitor} no lugar do ${skuName}`;
  return `A IA não recomenda ${skuName} neste teste`;
}

function withHeadline(
  output: DiagnosticOutput,
  skuName: string,
  queries: DiagnosticQueryRow[],
): DiagnosticOutput {
  const first =
    typeof output.diagnostic.next_steps.first_action === "string"
      ? output.diagnostic.next_steps.first_action.trim()
      : "";
  return {
    ...output,
    diagnostic: {
      ...output.diagnostic,
      next_steps: {
        ...output.diagnostic.next_steps,
        headline: first || instantiatedHeadline(skuName, queries),
        exempt: true,
      },
    },
  };
}

function unavailable(source: string) {
  return { status: "unavailable", source };
}

function topCompetitorUrls(queries: DiagnosticQueryRow[]): string[] {
  return [
    ...new Set(
      queries
        .map((query) => query.concorrente_citado_url)
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ].slice(0, 5);
}

function mentionedAttrsFromQueries(queries: DiagnosticQueryRow[]): string[] {
  return [
    ...new Set(
      queries.flatMap((query) => [
        ...query.atributos_mencionados_gemini,
        ...query.gemini_structured.objetos_citados.flatMap((object) => object.atributos),
      ]),
    ),
  ];
}

function missingMentionedAttributes(
  snapshot: ShopifyProductSnapshot,
  queries: DiagnosticQueryRow[],
): string[] {
  const mentioned = new Set(mentionedAttrsFromQueries(queries).map((attr) => attr.toLowerCase()));
  return snapshot.attributes
    .filter((attribute) => !mentioned.has(attribute.toLowerCase()))
    .slice(0, 8);
}

function groundingHostsFromQueries(queries: DiagnosticQueryRow[]): string[] {
  const hosts: string[] = [];
  for (const query of queries) {
    for (const execution of query.executions) {
      const citation = execution.citation;
      if (citation && typeof citation === "object" && "grounding_hosts" in citation) {
        const list = (citation as { grounding_hosts?: unknown }).grounding_hosts;
        if (Array.isArray(list)) {
          for (const host of list) {
            if (typeof host === "string" && host.trim()) hosts.push(host.trim().toLowerCase());
          }
        }
      }
      const urls = execution.grounding_urls;
      if (Array.isArray(urls)) {
        for (const url of urls) {
          if (typeof url !== "string") continue;
          const host = hostFromUrl(url);
          if (host) hosts.push(host);
        }
      }
    }
  }
  return hosts;
}

function groundingUrlsFromQueries(queries: DiagnosticQueryRow[]): string[] {
  const urls = new Set<string>();
  for (const query of queries) {
    for (const execution of query.executions) {
      const rawUrls = execution.grounding_urls;
      if (!Array.isArray(rawUrls)) continue;
      for (const url of rawUrls) {
        if (typeof url === "string" && url.trim()) urls.add(url.trim());
      }
    }
  }
  return [...urls];
}

function surfaceConfigFromSnapshot(snapshot: ShopifyProductSnapshot) {
  const pdpHost = hostFromUrl(snapshot.url);
  const declared = snapshot.meta.ownedSurfaces;
  return {
    storefrontHosts: declared?.storefrontHosts?.length
      ? declared.storefrontHosts
      : [pdpHost].filter((host): host is string => Boolean(host)),
    productUrls: [snapshot.url],
    ownedContentHosts: declared?.ownedContentHosts,
    ownedContentPaths: declared?.ownedContentPaths,
    searchConsoleProperties: declared?.searchConsoleProperties,
  };
}

function groundingSurfacesFromQueries(
  snapshot: ShopifyProductSnapshot,
  queries: DiagnosticQueryRow[],
): ClassifiedBrandSurface[] {
  const config = surfaceConfigFromSnapshot(snapshot);
  return groundingUrlsFromQueries(queries).map((url) => classifyBrandSurface(url, config));
}

function searchConsoleOwnedContentCandidate(
  snapshot: ShopifyProductSnapshot,
  theme: string,
  queryTexts: string[],
): SearchConsoleUrlMatch | null {
  const config = surfaceConfigFromSnapshot(snapshot);
  return selectSearchConsoleUrl({
    theme,
    signals: queryTexts,
    candidates: snapshot.meta.ownedSurfaces?.ownedContentCandidates ?? [],
    surfaceConfig: config,
  });
}

function readReviewOrRivalStore(hosts: string[], clientUrl: string): boolean {
  const clientHost = hostFromUrl(clientUrl);
  if (hosts.length === 0) return false;
  if (!clientHost) return true;
  return hosts.some((host) => {
    const h = host.replace(/^www\./, "").toLowerCase();
    return h !== clientHost && !h.endsWith(`.${clientHost}`);
  });
}

function foldNeedle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function queryAnswerBlob(query: DiagnosticQueryRow): string {
  const executionTexts = query.executions
    .map((execution) => (typeof execution.raw_text === "string" ? execution.raw_text : ""))
    .join(" ");
  return [query.gemini_raw ?? "", executionTexts].join(" ");
}

function answersNameClient(
  queries: DiagnosticQueryRow[],
  snapshot: ShopifyProductSnapshot,
): boolean {
  const needles = [snapshot.brand, snapshot.name]
    .map((value) => foldNeedle(value ?? ""))
    .filter((value) => value.length >= 3);
  if (needles.length === 0) return false;
  return queries.some((query) => {
    const blob = foldNeedle(queryAnswerBlob(query));
    return needles.some((needle) => blob.includes(needle));
  });
}

function trackLlmNextSteps(
  snapshot: ShopifyProductSnapshot,
  queries: DiagnosticQueryRow[],
  absentAttributes: string[],
  seoGaps: DiagnosticOutputInput["finance"]["seoGaps"],
  options: { incoherent?: boolean } = {},
) {
  const mentioned = mentionedAttrsFromQueries(queries);
  const skipAttrs = mentioned.filter(
    (item) => !snapshot.attributes.some((attr) => attr.toLowerCase() === item.toLowerCase()),
  );
  const queryTexts = queries.map((query) => query.query_text);
  const theme = themeFromQuerySet(queryTexts, snapshot.name, snapshot.brand);
  const surfaces = groundingSurfacesFromQueries(snapshot, queries);
  const groundingOwnedContent = surfaces.find(
    (surface) =>
      surface.kind === "owned_content_directory" || surface.kind === "owned_content_subdomain",
  );
  const searchConsoleCandidate = searchConsoleOwnedContentCandidate(snapshot, theme, queryTexts);
  const ownedContent = groundingOwnedContent ?? searchConsoleCandidate?.surface;
  const usesSearchConsoleTarget = !groundingOwnedContent && Boolean(searchConsoleCandidate);
  const readStorefront = surfaces.some((surface) => surface.kind === "owned_storefront");
  const readExternal = surfaces.some((surface) => surface.kind === "external_source");
  const cited = queries.some((query) => query.cliente_foi_citado);
  const sourcesWithoutStore = !cited && !readStorefront && answersNameClient(queries, snapshot);
  const brief = formulateTrackLlmFirstAction({
    skuName: snapshot.name,
    brand: snapshot.brand,
    queryTexts,
    unusedOwnAttrs: absentAttributes,
    skipAttrs,
    readReviewOrRivalStore:
      readExternal && !readStorefront
        ? true
        : readReviewOrRivalStore(groundingHostsFromQueries(queries), snapshot.url),
    existingContentUrl: ownedContent?.href ?? null,
    existingContentSurface:
      ownedContent?.kind === "owned_content_directory" ||
      ownedContent?.kind === "owned_content_subdomain"
        ? ownedContent.kind
        : null,
    searchConsoleCoverage: ownedContent?.search_console_coverage ?? "unknown",
    targetUrlSource: groundingOwnedContent
      ? "grounding"
      : searchConsoleCandidate
        ? "search_console"
        : null,
    catalogGaps: catalogFoundationFromFields({
      attributes: snapshot.attributes,
      descriptionChars: snapshot.descriptionChars ?? snapshot.meta.admin?.descriptionChars,
    }),
    productUrl: snapshot.url,
    incoherent: options.incoherent === true,
    sourcesWithoutStore,
  });
  return {
    owner: "parceiro de conteúdo ou autoridade",
    first_action: brief.first_action,
    support_line: buildTrackLlmSupportLine(brief),
    content_brief: {
      theme: brief.theme,
      sku_name: brief.sku_name,
      brand: brief.brand,
      page_type: brief.page_type,
      surface: brief.surface,
      target_url: brief.target_url,
      target_url_source: brief.target_url_source,
      existing_content_surface: brief.existing_content_surface,
      search_console_coverage: brief.search_console_coverage,
      use_attrs: brief.use_attrs,
      skip_attrs: brief.skip_attrs,
      grounding_note: brief.grounding_note,
      catalog_first: brief.catalog_first,
      catalog_gaps: brief.catalog_gaps,
      incoherent: brief.incoherent === true,
      sourcesWithoutStore: brief.sourcesWithoutStore === true,
      search_console_match:
        usesSearchConsoleTarget && searchConsoleCandidate
          ? {
              score: searchConsoleCandidate.score,
              confidence: searchConsoleCandidate.confidence,
              matched_queries: searchConsoleCandidate.matched_queries,
              metrics: searchConsoleCandidate.metrics,
            }
          : null,
    },
    seo_api_phase_2: seoGaps.length > 0 ? seoGaps : unavailable("seo_api"),
  };
}

function formatOfferPrice(amount: number | null, currency: string | null): string | null {
  if (amount == null) return null;
  if ((currency ?? "").toUpperCase() === "USD") return `US$ ${Math.round(amount)}`;
  return `R$ ${Math.round(amount)}`;
}

function productSkipAttrs(snapshot: ShopifyProductSnapshot, said: string[]): string[] {
  return said
    .filter(
      (attr) =>
        !snapshot.attributes.some((item) =>
          item.toLowerCase().includes(attr.toLowerCase().slice(0, 8)),
        ),
    )
    .slice(0, 4);
}

const CATALOG_FACT_NEEDLES = {
  shipping: ["prazo", "shipping", "frete", "entrega", "delivery"],
  rating: ["avaliacao", "avaliação", "rating", "review", "reviews"],
  dimensions: ["dimens", "scoop", "porcao", "porção", "serving", "dose", "gotas"],
  quality: ["nsf", "anvisa", "certif", "selo", "vegan", "qualidade", "quality"],
} as const;

function catalogFactFromAttributes(
  attributes: string[],
  needles: readonly string[],
): string | null {
  for (const raw of attributes) {
    const attribute = raw.trim();
    if (!attribute) continue;
    const sep = attribute.indexOf(":");
    if (sep >= 0) {
      const name = attribute.slice(0, sep).trim().toLowerCase();
      const value = attribute.slice(sep + 1).trim();
      if (value && needles.some((needle) => name.includes(needle))) return value;
      continue;
    }
    const lower = attribute.toLowerCase();
    if (needles.some((needle) => lower.includes(needle))) return attribute;
  }
  return null;
}

function trackProdutoNextSteps(snapshot: ShopifyProductSnapshot, queries: DiagnosticQueryRow[]) {
  const client = { name: snapshot.name, brand: snapshot.brand, url: snapshot.url };
  const crown = crownCompetitorSku({
    objectsByQuery: queries.map((query) => query.gemini_structured.objetos_citados ?? []),
    client,
  });
  const followup = planCitedOfferFollowUp(crown);
  const skipAttrs = productSkipAttrs(snapshot, crown.atributos);
  const crownedName = [crown.marca, crown.produto].filter(Boolean).join(" ") || null;
  const storeHint = crown.confidence === "store_only" ? (crown.storeHints[0]?.loja ?? null) : null;
  const priceClient = formatOfferPrice(snapshot.currentPrice, snapshot.currency);
  const priceCrowned =
    crown.confidence === "clear" ? formatOfferPrice(crown.preco, crown.moeda) : null;
  const judgment = judgeProductWeek({
    confidence: crown.confidence,
    followupReason: followup?.reason ?? null,
    priceClient: { amount: snapshot.currentPrice, currency: snapshot.currency, label: priceClient },
    priceCrowned:
      crown.confidence === "clear"
        ? { amount: crown.preco, currency: crown.moeda, label: priceCrowned }
        : null,
    clientDose:
      snapshot.dimension ??
      catalogFactFromAttributes(snapshot.attributes, CATALOG_FACT_NEEDLES.dimensions),
    crownedDose: crown.dimensoes,
    ratingClient: catalogFactFromAttributes(snapshot.attributes, CATALOG_FACT_NEEDLES.rating),
    ratingCrowned: crown.avaliacao,
    shippingClient: catalogFactFromAttributes(snapshot.attributes, CATALOG_FACT_NEEDLES.shipping),
    shippingCrowned: crown.prazo_entrega,
    skipAttrs,
    useAttrs: snapshot.attributes.slice(0, 2),
    clientDimensions:
      snapshot.dimension ??
      catalogFactFromAttributes(snapshot.attributes, CATALOG_FACT_NEEDLES.dimensions),
    crownedDimensions: crown.dimensoes,
    clientQuality:
      snapshot.material ??
      catalogFactFromAttributes(snapshot.attributes, CATALOG_FACT_NEEDLES.quality),
    crownedQuality: crown.qualidade,
  });
  const brief = formulateTrackProdutoFirstAction({
    skuName: snapshot.name,
    brand: snapshot.brand,
    productUrl: snapshot.url,
    confidence: crown.confidence,
    crownedName: crown.confidence === "clear" ? crownedName : null,
    crownedSeller: crown.seller,
    storeHint,
    priceClient,
    priceCrowned,
    useAttrs: snapshot.attributes.slice(0, 2),
    skipAttrs,
    followupReason: followup?.reason ?? null,
    losingDimension: judgment.primaryDimension,
    move: judgment.move,
    contributions: judgment.contributions,
  });
  return {
    owner: "consultor estratégico ou especialista em precificação",
    first_action: brief.first_action,
    support_line: brief.support_line,
    product_brief: {
      theme: brief.theme,
      sku_name: brief.sku_name,
      brand: brief.brand,
      move: brief.move,
      surface: brief.surface,
      target_url: brief.target_url,
      losing_dimension: brief.losing_dimension,
      crowned_name: brief.crowned_name,
      crowned_seller: brief.crowned_seller,
      price_client: brief.price_client,
      price_crowned: brief.price_crowned,
      use_attrs: brief.use_attrs,
      skip_attrs: brief.skip_attrs,
      followup_reason: brief.followup_reason,
      contributions: brief.contributions,
    },
  };
}

export function buildCitationFinancialRisks(
  input: CitationFinanceInput,
): CreateFinancialRiskInput[] {
  const citationCounts = aggregateCitationCounts(
    input.queries.map((query) => ({
      cited: query.cliente_foi_citado,
      metadata: {
        competitors:
          query.concorrente_citado_nome || query.concorrente_citado_url
            ? [
                {
                  name:
                    query.concorrente_citado_nome ?? query.concorrente_citado_url ?? "concorrente",
                  url: query.concorrente_citado_url ?? undefined,
                  type: query.concorrente_citado_url ? "domain" : "brand",
                },
              ]
            : [],
      },
    })),
    input.queries.length,
  );

  const gap = computeRevenueGap({
    receitaAiMedida: input.finance.ga4.totalRevenue,
    sessoesAi: input.finance.ga4.totalSessions,
    ...(input.finance.ga4.landings?.length
      ? { sessoesAiLandings: input.finance.ga4.landings.slice(0, 8) }
      : {}),
    citationClient: citationCounts.citationClient,
    citationCompetitor: citationCounts.citationCompetitor,
    citationTotal: citationCounts.citationTotal,
    ticketMedio: input.finance.shopify.ticketMedio,
    cacSku: input.finance.meta.cac,
    origins: {
      receitaAiMedida: input.finance.ga4.meta,
      sessoesAi: input.finance.ga4.meta,
      ticketMedio: input.finance.shopify.meta,
      cacSku: input.finance.meta.meta,
    },
  });

  return [
    {
      job_id: input.jobId,
      sku_id: input.primarySku.id,
      gap_value: gap.lacunaRs,
      lost_clients: gap.clientesPerdidos,
      compensation_cost: null,
      formula_type: "lacuna_ai_floor",
      inputs: {
        formula: "Receita_AI_medida × [(citação_concorrente ÷ citação_cliente) − 1]",
        floor_not_ceiling: true,
        sku_scope: "dominant_sku_within_cluster",
        evaluated_sku_count: input.skus.length,
        assumptions: gap.assumptions,
        flags: gap.flags,
      },
    },
    {
      job_id: input.jobId,
      sku_id: input.primarySku.id,
      gap_value: null,
      lost_clients: gap.clientesPerdidos,
      compensation_cost: gap.custoCompensar,
      formula_type: "compensation_cost_media",
      inputs: {
        formula: "Clientes_perdidos × CAC_SKU",
        never_sum_with_lacuna: true,
        sku_scope: "dominant_sku_within_cluster",
        evaluated_sku_count: input.skus.length,
        assumptions: gap.assumptions,
      },
    },
  ];
}

export function buildDiagnosticOutput(input: DiagnosticOutputInput): DiagnosticOutput {
  const commonRisks = buildCitationFinancialRisks(input);
  const shopifyData = input.primarySku.shopify_data;
  const competitorUrls = topCompetitorUrls(input.queries);
  const absentAttributes = missingMentionedAttributes(shopifyData, input.queries);

  if (input.track === "track_llm") {
    return withHeadline(
      {
        risks: commonRisks,
        diagnostic: {
          job_id: input.jobId,
          sku_id: input.primarySku.id,
          track: "track_llm",
          causes: [
            {
              type: "llm_unknown_product",
              text: "Gemini não conhece o produto de forma coerente.",
            },
            { type: "authority_gap", competitor_urls: competitorUrls },
          ],
          actions: [
            { type: "identify_competitor_domains", competitor_urls: competitorUrls },
            {
              type: "produce_authority_content",
              missing_attributes: absentAttributes,
              recommended_formats: ["artigo", "comparativo", "guia de compra"],
            },
            { type: "certified_partners", text: "Parceiros certificados pelo Rint para execução." },
          ],
          next_steps: trackLlmNextSteps(
            shopifyData,
            input.queries,
            absentAttributes,
            input.finance.seoGaps,
            { incoherent: input.coherenceLevel === "incoerente" },
          ),
          prazo:
            "variável — depende de frequência de indexação do Gemini e volume de conteúdo publicado",
        },
      },
      input.primarySku.shopify_data.name,
      input.queries,
    );
  }

  if (input.track === "track_pdp" && publicStorefrontUnreadable(shopifyData)) {
    return withHeadline(
      {
        risks: commonRisks,
        diagnostic: {
          job_id: input.jobId,
          sku_id: input.primarySku.id,
          track: "track_pdp",
          causes: [
            {
              type: "storefront_closed",
              text: "A loja não está aberta publicamente. Se o cliente não entra, a IA também não entra.",
            },
          ],
          actions: [
            {
              type: "tecnica",
              text: "Deixe esta URL pública — tire a senha ou o bloqueio da página do produto.",
            },
          ],
          next_steps: {
            owner: "o fundador na loja",
            first_action:
              "Deixar esta URL pública — tirar a senha ou o bloqueio da página do produto.",
          },
          prazo: "imediato — a IA só lê o que o público lê",
        },
      },
      input.primarySku.shopify_data.name,
      input.queries,
    );
  }

  if (input.track === "track_pdp") {
    return withHeadline(
      {
        risks: [
          ...commonRisks,
          {
            job_id: input.jobId,
            sku_id: input.primarySku.id,
            gap_value: null,
            lost_clients: input.finance.conversion?.nonConvertingSessions ?? null,
            compensation_cost: null,
            formula_type: "pdp_conversion_risk",
            inputs: {
              conversion_rate: input.finance.conversion?.conversionRate ?? null,
              sessions: input.finance.conversion?.sessions ?? null,
              bounce_rate: input.finance.conversion?.bounceRate ?? null,
              scroll_depth: input.finance.conversion?.scrollDepth ?? null,
              source: input.finance.conversion?.meta ?? unavailable("ga4_conversion_metrics"),
            },
          },
        ],
        diagnostic: {
          job_id: input.jobId,
          sku_id: input.primarySku.id,
          track: "track_pdp",
          causes: [
            {
              type: "conteudo_incompleto",
              items: [
                "atributos técnicos ausentes ou pouco indexáveis",
                "descrição genérica sem diferenciação semântica",
                "ausência de FAQ indexável na PDP",
                "imagens sem alt text descritivo",
              ],
            },
            {
              type: "falha_tecnica",
              items: [
                "Schema.org de produto ausente ou incorreto",
                "Open Graph tags ausentes ou incorretas",
                "Canonical URL com erro",
                "Robots.txt ou noindex bloqueando a PDP",
              ],
              excluded_causes: ["Pixel Meta", "GA4 pixel"],
            },
          ],
          actions: [
            {
              type: "conteudo",
              text: "Enriquecer atributos indexáveis pela IA.",
              missing_attributes: absentAttributes,
            },
            {
              type: "tecnica",
              text: "Corrigir Schema.org, Open Graph, Canonical URL e Robots.txt.",
            },
          ],
          next_steps: {
            owner: "parceiro de conteúdo ou agência técnica especializada na plataforma do cliente",
            decision_rule:
              "Conteúdo se faltar informação; agência técnica se houver schema/canonical/robots incorretos.",
          },
          prazo: "variável — dado a ser coletado em fase de testes",
        },
      },
      input.primarySku.shopify_data.name,
      input.queries,
    );
  }

  if (input.track === "track_produto") {
    const shopifyData = input.primarySku.shopify_data;
    const client = {
      name: shopifyData.name,
      brand: shopifyData.brand,
      url: shopifyData.url,
    };
    const crown = crownCompetitorSku({
      objectsByQuery: input.queries.map((query) => query.gemini_structured.objetos_citados ?? []),
      client,
    });
    const competitorPrice = crown.confidence === "clear" ? crown.preco : null;
    const priceGap = competitorPrice != null ? shopifyData.currentPrice - competitorPrice : null;
    const metaRead = input.finance.meta.cac > 0 || input.finance.meta.spend > 0;
    return withHeadline(
      {
        risks: [
          ...commonRisks,
          {
            job_id: input.jobId,
            sku_id: input.primarySku.id,
            gap_value: priceGap,
            lost_clients: null,
            compensation_cost:
              metaRead && input.finance.meta.cac > input.finance.shopify.ticketMedio
                ? input.finance.meta.spend
                : null,
            formula_type: "product_price_margin_risk",
            inputs: {
              client_price: shopifyData.currentPrice,
              competitor_price: competitorPrice,
              cac_sku: metaRead ? input.finance.meta.cac : null,
              ticket_medio: input.finance.shopify.ticketMedio,
              margin_signal:
                metaRead && input.finance.meta.cac > input.finance.shopify.ticketMedio
                  ? "cac_gt_ticket"
                  : "not_detected",
            },
          },
        ],
        diagnostic: {
          job_id: input.jobId,
          sku_id: input.primarySku.id,
          track: "track_produto",
          causes: [
            {
              type: "preco_nao_competitivo",
              client_price: shopifyData.currentPrice,
              competitor_price: competitorPrice,
            },
            ...(metaRead
              ? [
                  {
                    type: "margem_insuficiente",
                    cac_sku: input.finance.meta.cac,
                    ticket_medio: input.finance.shopify.ticketMedio,
                  },
                ]
              : []),
          ],
          actions: [],
          next_steps: trackProdutoNextSteps(shopifyData, input.queries),
          prazo: "médio a longo prazo",
        },
      },
      input.primarySku.shopify_data.name,
      input.queries,
    );
  }

  const wastedSpend = input.finance.googleAds?.wastedSpend ?? null;
  const feedLostRevenue = input.finance.merchantCenter?.lostRevenue ?? null;
  const economy =
    typeof wastedSpend === "number" || typeof feedLostRevenue === "number"
      ? (wastedSpend ?? 0) + (feedLostRevenue ?? 0)
      : null;

  return withHeadline(
    {
      risks: [
        ...commonRisks,
        {
          job_id: input.jobId,
          sku_id: input.primarySku.id,
          gap_value: feedLostRevenue,
          lost_clients: null,
          compensation_cost: wastedSpend,
          formula_type: "media_recoverable_waste",
          inputs: {
            wasted_spend: wastedSpend,
            feed_lost_revenue: feedLostRevenue,
            monthly_recoverable: economy,
            no_direct_llm_causality_claim: true,
            google_ads: input.finance.googleAds ?? unavailable("google_ads"),
            merchant_center: input.finance.merchantCenter ?? unavailable("merchant_center"),
          },
        },
      ],
      diagnostic: {
        job_id: input.jobId,
        sku_id: input.primarySku.id,
        track: "track_midia",
        causes: [
          {
            type: "budget_mal_alocado",
            source: input.finance.googleAds ?? unavailable("google_ads"),
          },
          {
            type: "feed_com_erro",
            source: input.finance.merchantCenter ?? unavailable("merchant_center"),
          },
          {
            type: "cac_alto_por_sku",
            cac_sku: input.finance.meta.cac,
            ticket_medio: input.finance.shopify.ticketMedio,
          },
        ],
        actions: [
          {
            type: "llms_sem_patrocinio",
            targets: ["Gemini", "Claude", "Perplexity"],
            action: "Otimizar desperdício de verba e corrigir feed.",
          },
          {
            type: "llms_com_patrocinio",
            targets: ["ChatGPT", "Copilot"],
            action: "Mídia paga direta na LLM quando disponível + otimização de feed.",
          },
        ],
        next_steps: {
          owner: "gestor de mídia ou agência parceira certificada",
          recoverable_statement:
            economy === null
              ? "economia potencial indisponível até conectar Google Ads/Merchant Center"
              : `R$ ${economy} recuperável em 1 a 2 semanas`,
          no_direct_llm_causality_claim: true,
        },
        prazo: "1 a 2 semanas",
      },
    },
    input.primarySku.shopify_data.name,
    input.queries,
  );
}
