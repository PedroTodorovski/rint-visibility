import { describe, expect, it } from "vitest";

import { emptyCitedObject, emptyGeminiStructured } from "../src/lib/llm/gemini-structured.js";
import type {
  DiagnosticQueryRow,
  DiagnosticSkuRow,
} from "../src/repositories/diagnostic-tables.js";
import { buildDiagnosticOutput } from "../src/services/diagnostic-output.js";
import type { ShopifyProductSnapshot } from "../src/services/diagnostic-types.js";

const meta = { port: "test", fetchedAt: "2026-08-18T00:00:00.000Z", source: "test" };

const snapshot: ShopifyProductSnapshot = {
  externalRef: "NUT000007",
  url: "https://nuture.com.br/products/nuture-daily-boost",
  name: "Nuture Daily Boost",
  brand: "Nuture",
  currentPrice: 348,
  currency: "BRL",
  attributes: ["59 vitaminas, minerais, bioativos e vegetais", "2 scoops (10 g) ao dia"],
  variants: [],
  inventoryAvailable: null,
  image: null,
  meta: { source: "test", fetchedAt: "2026-08-18T00:00:00.000Z" },
};

const sku: DiagnosticSkuRow = {
  id: "sku-daily",
  job_id: "job-1",
  product_id: null,
  url: snapshot.url,
  external_ref: snapshot.externalRef,
  shopify_data: snapshot,
  validation_status: "valid",
  validation_errors: [],
  created_at: "2026-08-18T00:00:00.000Z",
};

function query(
  text: string,
  attrs: string[],
  groundingUrls = ["https://www.healthline.com/ag1", "https://drinkag1.com/products/ag1"],
): DiagnosticQueryRow {
  return {
    id: text,
    job_id: "job-1",
    sku_id: sku.id,
    prompt_id: null,
    query_text: text,
    gemini_raw: null,
    gemini_structured: {
      ...emptyGeminiStructured(),
      concorrente_citado_nome: "Athletic Greens",
      objetos_citados: [
        { ...emptyCitedObject(), marca: "Athletic Greens", produto: "AG1", atributos: attrs },
      ],
    },
    cliente_foi_citado: false,
    concorrente_citado_nome: "Athletic Greens",
    concorrente_citado_url: "https://drinkag1.com/products/ag1",
    atributos_mencionados_gemini: attrs,
    temperatura_gemini: 0,
    num_execucoes: 1,
    confianca: null,
    executions: [
      {
        raw_text: "",
        grounding_urls: groundingUrls,
        citation: { grounding_hosts: ["healthline.com", "drinkag1.com"] },
      },
    ],
    created_at: "2026-08-18T00:00:00.000Z",
  };
}

describe("buildDiagnosticOutput track_llm first_action", () => {
  it("emits a formulated content_brief, not a pasted wizard query and not the generic slogan", () => {
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: sku,
      skus: [sku],
      queries: [
        query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
        query("Alternativa ao AG1 com vitaminas e minerais", ["75 vitaminas e minerais"]),
        query("suplemento greens em pó com CoQ10", ["1 scoop por dia"]),
        query("Nuture Daily Boost vale a pena", []),
        query("Nuture Daily Boost vs AG1", ["Certificação NSF"]),
      ],
      track: "track_llm",
      finance: {
        ga4: {
          totalRevenue: 0,
          totalSessions: 44,
          bySource: [],
          landings: [
            { path: "/", sessions: 35 },
            { path: "/blog/greens-em-po", sessions: 1 },
          ],
          meta,
        },
        shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 0, meta },
        meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
        conversion: null,
        googleAds: null,
        merchantCenter: null,
        trends: null,
        seoGaps: [],
      },
    });

    const next = output.diagnostic.next_steps;
    expect(next.first_action).not.toBe(
      "Produzir conteúdo de autoridade com atributos específicos do SKU.",
    );
    expect(String(next.first_action)).not.toContain("Melhor suplemento de greens no Brasil");
    expect(String(next.first_action)).toContain("landing editorial/comparativa");
    expect(String(next.first_action)).toContain("URL própria");
    expect(String(next.first_action)).toContain("fora da PDP");
    expect(String(next.first_action)).toMatch(/suplemento/i);
    expect(String(next.first_action)).toContain("59 vitaminas");
    expect(String(next.first_action)).toContain("Certificação NSF");
    expect(next.content_brief).toMatchObject({
      page_type: "landing_editorial_comparativa",
      surface: "nova_landing_editorial_no_dominio_nao_pdp",
      target_url: null,
      search_console_coverage: "unknown",
      grounding_note: "review_not_listing",
    });
    expect(next.support_line).toContain("Por que isso importa");
    expect(String((next.content_brief as { theme: string }).theme)).not.toBe(
      "Melhor suplemento de greens no Brasil",
    );
    expect(
      (output.risks[0]?.inputs as { assumptions?: { sessoesAi?: number } } | undefined)?.assumptions
        ?.sessoesAi,
    ).toBe(44);
    expect(
      (
        output.risks[0]?.inputs as
          | {
              assumptions?: { sessoesAiLandings?: Array<{ path: string; sessions: number }> };
            }
          | undefined
      )?.assumptions?.sessoesAiLandings,
    ).toEqual([
      { path: "/", sessions: 35 },
      { path: "/blog/greens-em-po", sessions: 1 },
    ]);
    expect(String(next.first_action)).not.toMatch(/\/$/);
    expect((next.content_brief as { target_url?: string | null }).target_url).not.toBe("/");
  });

  it("points the brief to an existing owned content URL when Gemini already read it", () => {
    const skuWithSearchConsole = {
      ...sku,
      shopify_data: {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          ownedSurfaces: {
            storefrontHosts: ["nuture.com.br"],
            ownedContentPaths: ["/blog"],
            searchConsoleProperties: [{ type: "domain" as const, domain: "nuture.com.br" }],
            ownedContentCandidates: [
              {
                url: "https://nuture.com.br/blog/greens-em-po",
                property: "sc-domain:nuture.com.br",
                clicks: 118,
                impressions: 4120,
                topQuery: "greens em pó no brasil",
              },
            ],
          },
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: skuWithSearchConsole,
      skus: [skuWithSearchConsole],
      queries: [
        query(
          "Melhor suplemento de greens no Brasil",
          ["Certificação NSF"],
          ["https://nuture.com.br/blog/greens-em-po"],
        ),
        query("Alternativa ao AG1 com vitaminas e minerais", ["75 vitaminas e minerais"]),
      ],
      track: "track_llm",
      finance: {
        ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
        shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 0, meta },
        meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
        conversion: null,
        googleAds: null,
        merchantCenter: null,
        trends: null,
        seoGaps: [],
      },
    });

    const next = output.diagnostic.next_steps;
    expect(String(next.first_action)).toContain("Melhore esta landing editorial/comparativa");
    expect(String(next.first_action)).toContain("https://nuture.com.br/blog/greens-em-po");
    expect(next.content_brief).toMatchObject({
      surface: "url_editorial_existente_no_dominio_nao_pdp",
      target_url: "https://nuture.com.br/blog/greens-em-po",
      target_url_source: "grounding",
      existing_content_surface: "owned_content_directory",
      search_console_coverage: "covered",
      search_console_match: null,
    });
  });

  it("uses a Search Console owned content candidate before creating a new URL", () => {
    const skuWithSearchConsole = {
      ...sku,
      shopify_data: {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          ownedSurfaces: {
            storefrontHosts: ["nuture.com.br"],
            ownedContentPaths: ["/blog"],
            searchConsoleProperties: [{ type: "domain" as const, domain: "nuture.com.br" }],
            ownedContentCandidates: [
              {
                url: "https://nuture.com.br/blog/greens-em-po",
                property: "sc-domain:nuture.com.br",
                clicks: 118,
                impressions: 4120,
                topQuery: "greens em pó no brasil",
              },
            ],
          },
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: skuWithSearchConsole,
      skus: [skuWithSearchConsole],
      queries: [
        query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
        query("Alternativa ao AG1 com vitaminas e minerais", ["75 vitaminas e minerais"]),
      ],
      track: "track_llm",
      finance: {
        ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
        shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 0, meta },
        meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
        conversion: null,
        googleAds: null,
        merchantCenter: null,
        trends: null,
        seoGaps: [],
      },
    });

    expect(String(output.diagnostic.next_steps.first_action)).toContain(
      "https://nuture.com.br/blog/greens-em-po",
    );
    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      surface: "url_editorial_existente_no_dominio_nao_pdp",
      target_url: "https://nuture.com.br/blog/greens-em-po",
      target_url_source: "search_console",
      search_console_coverage: "covered",
    });
    expect(output.diagnostic.next_steps.support_line).toContain("Search Console");
  });
});
