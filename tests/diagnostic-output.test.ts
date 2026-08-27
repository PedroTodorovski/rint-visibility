import { describe, expect, it } from "vitest";

import { emptyCitedObject, emptyGeminiStructured } from "../src/lib/llm/gemini-structured.js";
import type {
  DiagnosticQueryRow,
  DiagnosticSkuRow,
} from "../src/repositories/diagnostic-tables.js";
import { buildDiagnosticOutput, formatOfferPrice } from "../src/services/diagnostic-output.js";
import type { ShopifyProductSnapshot } from "../src/services/diagnostic-types.js";

const meta = { port: "test", fetchedAt: "2026-08-18T00:00:00.000Z", source: "test" };

const snapshot: ShopifyProductSnapshot = {
  externalRef: "NUT000007",
  url: "https://nuture.com.br/products/nuture-daily-boost",
  name: "Nuture Daily Boost",
  brand: "Nuture",
  currentPrice: 348,
  currency: "BRL",
  attributes: [
    "59 vitaminas, minerais, bioativos e vegetais",
    "2 scoops (10 g) ao dia",
    "30 porções",
  ],
  variants: [],
  inventoryAvailable: null,
  image: null,
  descriptionChars: 280,
  meta: {
    source: "test",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    admin: {
      attributeCount: 3,
      descriptionChars: 280,
      hasMaterial: true,
      hasColor: false,
      hasDimension: false,
      hasImageAlt: true,
      thin: false,
      gaps: [],
    },
  },
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

describe("formatOfferPrice", () => {
  it("keeps catalog cents — 129.90 is not 130", () => {
    expect(formatOfferPrice(129.9, "BRL")).toMatch(/129,90/);
    expect(formatOfferPrice(129.9, "BRL")).not.toMatch(/130/);
    expect(formatOfferPrice(348, "BRL")).toMatch(/348/);
    expect(formatOfferPrice(99.9, "USD")).toMatch(/99,90/);
  });
});

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

  it("leads the week action with Shopify cadastro when the Admin foundation is empty", () => {
    const thinSku = {
      ...sku,
      shopify_data: {
        ...snapshot,
        attributes: ["Greens"],
        descriptionChars: 12,
        meta: {
          ...snapshot.meta,
          admin: {
            attributeCount: 1,
            descriptionChars: 12,
            hasMaterial: false,
            hasColor: false,
            hasDimension: false,
            hasImageAlt: false,
            thin: true,
            gaps: ["attributes", "description"] as Array<
              "attributes" | "description" | "physical" | "image_alt"
            >,
          },
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: thinSku,
      skus: [thinSku],
      queries: [
        query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
        query("Alternativa ao AG1 com vitaminas e minerais", ["75 vitaminas e minerais"]),
        query("suplemento greens em pó com CoQ10", ["1 scoop por dia"]),
        query("Nuture Daily Boost vale a pena", []),
        query("Nuture Daily Boost vs AG1", ["Certificação NSF"]),
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

    expect(String(output.diagnostic.next_steps.first_action)).toContain("Complete no Shopify");
    expect(String(output.diagnostic.next_steps.first_action)).toContain(
      "https://nuture.com.br/products/nuture-daily-boost",
    );
    expect(String(output.diagnostic.next_steps.first_action)).not.toContain(
      "Melhore esta landing editorial/comparativa",
    );
    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      surface: "cadastro_shopify_antes_da_landing",
      catalog_first: true,
      target_url: "https://nuture.com.br/products/nuture-daily-boost",
    });
    expect(output.diagnostic.next_steps.support_line).toContain("cadastro é a base");
  });

  it("does not treat a missing description length as an empty catalog", () => {
    const unreadSku = {
      ...sku,
      shopify_data: {
        ...snapshot,
        descriptionChars: undefined,
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
      primarySku: unreadSku,
      skus: [unreadSku],
      queries: [
        query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
        query("Alternativa ao AG1 com vitaminas e minerais", ["75 vitaminas e minerais"]),
        query("suplemento greens em pó com CoQ10", ["1 scoop por dia"]),
        query("Nuture Daily Boost vale a pena", []),
        query("Nuture Daily Boost vs AG1", ["Certificação NSF"]),
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

    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      catalog_first: false,
      surface: "url_editorial_existente_no_dominio_nao_pdp",
      target_url: "https://nuture.com.br/blog/greens-em-po",
    });
    expect(String(output.diagnostic.next_steps.first_action)).toContain(
      "https://nuture.com.br/blog/greens-em-po",
    );
  });

  const gscSku = {
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
  const emptyFinance = {
    ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
    shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 0, meta },
    meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
    conversion: null,
    googleAds: null,
    merchantCenter: null,
    trends: null,
    seoGaps: [],
  };

  it("leads with the mismatch when the cited client object is incoherent", () => {
    const cited = {
      ...query(
        "Nuture Daily Boost vale a pena",
        ["59 vitaminas, minerais, bioativos e vegetais"],
        ["https://nuture.com.br/blog/greens-em-po"],
      ),
      cliente_foi_citado: true,
      concorrente_citado_nome: null,
      concorrente_citado_url: null,
      gemini_structured: {
        ...emptyGeminiStructured(),
        cliente_foi_citado: true,
        objetos_citados: [
          {
            ...emptyCitedObject(),
            marca: "Nuture",
            produto: "Daily Boost",
            url: snapshot.url,
            preco: 99,
            moeda: "BRL",
            atributos: ["59 vitaminas, minerais, bioativos e vegetais"],
          },
        ],
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: gscSku,
      skus: [gscSku],
      queries: [cited],
      track: "track_llm",
      coherenceLevel: "incoerente",
      finance: emptyFinance,
    });

    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      incoherent: true,
      catalog_first: false,
      target_url: "https://nuture.com.br/blog/greens-em-po",
    });
    expect(output.diagnostic.next_steps.support_line).toContain("já te citou");
  });

  it("leads with named-without-store when the answer names the brand and grounding skipped the shopfront", () => {
    const named = {
      ...query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
      gemini_raw:
        "A busca cita a Nuture como alternativa, mas aponta o AG1 da Athletic Greens para comprar.",
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: gscSku,
      skus: [gscSku],
      queries: [named],
      track: "track_llm",
      finance: emptyFinance,
    });

    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      sourcesWithoutStore: true,
      catalog_first: false,
      target_url: "https://nuture.com.br/blog/greens-em-po",
    });
    expect(output.diagnostic.next_steps.support_line).toContain("já sabe o nome");
  });

  it("flags named-without-store from execution raw text when gemini_raw is empty", () => {
    const named = {
      ...query("Melhor suplemento de greens no Brasil", ["Certificação NSF"]),
      gemini_raw: null,
      executions: [
        {
          raw_text:
            "A busca cita a Nuture como alternativa, mas aponta o AG1 da Athletic Greens para comprar.",
          grounding_urls: ["https://www.healthline.com/ag1", "https://drinkag1.com/products/ag1"],
          citation: { grounding_hosts: ["healthline.com", "drinkag1.com"] },
        },
      ],
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: gscSku,
      skus: [gscSku],
      queries: [named],
      track: "track_llm",
      finance: emptyFinance,
    });

    expect(output.diagnostic.next_steps.content_brief).toMatchObject({
      sourcesWithoutStore: true,
      catalog_first: false,
    });
  });
});

describe("buildDiagnosticOutput track_produto first_action", () => {
  const finance = {
    ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
    shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 348, meta },
    meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
    conversion: null,
    googleAds: null,
    merchantCenter: null,
    trends: null,
    seoGaps: [],
  };

  function ag1Query(text: string, extra?: Partial<DiagnosticQueryRow["gemini_structured"]>) {
    return {
      ...query(text, ["Certificação NSF"]),
      cliente_foi_citado: true,
      gemini_structured: {
        ...emptyGeminiStructured(),
        cliente_foi_citado: true,
        concorrente_citado_nome: "Athletic Greens",
        objetos_citados: [
          {
            ...emptyCitedObject(),
            marca: "Athletic Greens",
            produto: "AG1",
            loja: "Athletic Greens",
            url: "https://drinkag1.com/products/ag1",
            preco: 99,
            moeda: "USD",
            prazo_entrega: "5 a 8 dias",
            avaliacao: "4,8",
            atributos: ["Certificação NSF", "75 vitaminas e minerais"],
          },
          ...(extra?.objetos_citados ?? []),
        ],
      },
    };
  }

  it("emits product_brief from the crowned SKU, not min competitor price or the AG1 slogan", () => {
    const cheaper = {
      ...emptyCitedObject(),
      marca: "Bloom",
      produto: "Greens",
      loja: "Amazon",
      url: "https://www.amazon.com.br/bloom-greens",
      preco: 49,
      moeda: "BRL",
      atributos: ["superfood powder"],
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: sku,
      skus: [sku],
      queries: [
        ag1Query("Melhor suplemento de greens no Brasil"),
        ag1Query("Alternativa ao AG1 com vitaminas e minerais"),
        ag1Query("suplemento greens em pó com CoQ10", { objetos_citados: [cheaper] }),
      ],
      track: "track_produto",
      finance,
    });

    const next = output.diagnostic.next_steps;
    expect(String(next.first_action)).not.toMatch(/A IA recomenda Athletic Greens/);
    expect(String(next.headline)).not.toMatch(/A IA recomenda Athletic Greens/);
    expect(String(next.first_action)).toMatch(/Não foi o preço nem o prazo/);
    expect(String(next.first_action)).toContain("Athletic Greens AG1");
    expect(String(next.first_action)).not.toMatch(/elegeu|aceite o gap|página do produto/);
    expect(String(next.first_action)).toContain("Certificação NSF");
    expect(next.support_line).toMatch(/Por que isso importa/);
    expect(next.product_brief).toMatchObject({
      surface: "sku_da_loja",
      move: "aceitar_gap",
      losing_dimension: "composicao",
      crowned_name: "Athletic Greens AG1",
      price_crowned: "US$ 99",
      skip_attrs: ["Certificação NSF"],
      target_url: "https://nuture.com.br/products/nuture-daily-boost",
      contributions: [{ dimension: "composicao", role: "primary" }],
    });
    expect(
      (output.diagnostic.causes as Array<{ type: string; competitor_price?: number }>).find(
        (cause) => cause.type === "preco_nao_competitivo",
      )?.competitor_price,
    ).toBe(99);
    expect(
      output.diagnostic.causes.some((cause) => cause.type === "posicionamento_inadequado"),
    ).toBe(false);
    expect(output.diagnostic.actions).toEqual([]);
  });
});

describe("buildDiagnosticOutput track_pdp first_action", () => {
  const finance = {
    ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
    shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 348, meta },
    meta: { externalRef: "NUT000007", spend: 0, conversions: 0, cac: 0, meta },
    conversion: null,
    googleAds: null,
    merchantCenter: null,
    trends: null,
    seoGaps: [],
  };

  it("emits page_brief for a password wall, not a SEO laundry list", () => {
    const closed: DiagnosticSkuRow = {
      ...sku,
      shopify_data: {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          source: "shopify_api",
          storefrontAccess: "password",
          hasJsonLd: null,
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: closed,
      skus: [closed],
      queries: [query("Melhor suplemento de greens no Brasil", [])],
      track: "track_pdp",
      finance,
    });
    const next = output.diagnostic.next_steps;
    expect(String(next.first_action)).toContain("está com senha");
    expect(String(next.first_action)).not.toMatch(/FAQ|Canonical|Robots|Open Graph/i);
    expect(next.page_brief).toMatchObject({
      move: "abrir_senha",
      source: "nao_lemos",
      has_json_ld: null,
    });
  });

  it("emits expose-schema copy when the street is open without JSON-LD", () => {
    const open: DiagnosticSkuRow = {
      ...sku,
      shopify_data: {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          source: "shopify_api",
          storefrontAccess: "open",
          hasJsonLd: false,
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: open,
      skus: [open],
      queries: [query("Melhor suplemento de greens no Brasil", [])],
      track: "track_pdp",
      finance,
    });
    expect(String(output.diagnostic.next_steps.first_action)).toContain("ficha estruturada");
    expect(output.diagnostic.next_steps.page_brief).toMatchObject({
      move: "expor_schema",
      source: "rua",
    });
  });

  it("does not claim missing schema when the public GET did not close", () => {
    const unverified: DiagnosticSkuRow = {
      ...sku,
      shopify_data: {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          source: "shopify_api",
          storefrontAccess: "unverified",
          hasJsonLd: null,
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: unverified,
      skus: [unverified],
      queries: [query("Melhor suplemento de greens no Brasil", [])],
      track: "track_pdp",
      finance,
    });
    expect(output.diagnostic.causes).toEqual([
      expect.objectContaining({ type: "publico_nao_lido" }),
    ]);
    expect(output.diagnostic.next_steps.page_brief).toMatchObject({
      move: "conferir_publico",
      has_json_ld: null,
    });
    expect(String(output.diagnostic.next_steps.first_action)).toContain("Não conseguimos ler");
    expect(String(output.diagnostic.next_steps.first_action)).toContain("não afirmamos");
  });

  it("does not claim Shopify cadastro on a marketplace street snapshot", () => {
    const market: DiagnosticSkuRow = {
      ...sku,
      shopify_data: {
        ...snapshot,
        url: "https://www.mercadolivre.com.br/item-camisa",
        meta: {
          ...snapshot.meta,
          source: "public_pdp",
          storefrontAccess: "open",
          hasJsonLd: false,
          shopConnected: true,
          panelMismatch: false,
        },
      },
    };
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: market,
      skus: [market],
      queries: [query("Melhor suplemento de greens no Brasil", [])],
      track: "track_pdp",
      finance,
    });
    expect(String(output.diagnostic.next_steps.first_action)).toContain("ficha estruturada");
    expect(String(output.diagnostic.next_steps.first_action)).not.toContain(
      "cadastro no Shopify já tem",
    );
    expect(output.diagnostic.next_steps.page_brief).toMatchObject({ move: "expor_schema" });
  });
});

describe("buildDiagnosticOutput track_midia persists Meta volume for admin mosaic", () => {
  it("writes spend and conversions into lacuna assumptions", () => {
    const output = buildDiagnosticOutput({
      jobId: "job-1",
      primarySku: sku,
      skus: [sku],
      queries: [query("Melhor suplemento de greens no Brasil", [])],
      track: "track_midia",
      finance: {
        ga4: { totalRevenue: 0, totalSessions: 0, bySource: [], meta },
        shopify: { externalRef: "NUT000007", revenue: 0, orders: 0, ticketMedio: 0, meta },
        meta: { externalRef: "NUT000007", spend: 900, conversions: 2, cac: 450, meta },
        conversion: null,
        googleAds: null,
        merchantCenter: null,
        trends: null,
        seoGaps: [],
      },
    });

    const assumptions = (
      output.risks[0]?.inputs as {
        assumptions?: { spend?: number; conversions?: number; cacSku?: number };
      }
    )?.assumptions;
    expect(assumptions?.spend).toBe(900);
    expect(assumptions?.conversions).toBe(2);
    expect(assumptions?.cacSku).toBe(450);
    expect(output.diagnostic.track).toBe("track_midia");
    expect(String(output.diagnostic.next_steps.first_action)).toMatch(/Meta|verba|custo/i);
  });
});
