import type { ShopifyProductSnapshot } from "../services/diagnostic-types.js";
import { createGa4AiReferralPort as createRealGa4AiReferralPort } from "./ga4-revenue-adapter.js";
import { createMetaCacPort as createRealMetaCacPort } from "./meta-cac-adapter.js";
import {
  createShopifyProductSnapshotPort as createRealShopifyProductSnapshotPort,
  createShopifyRevenuePort as createRealShopifyRevenuePort,
} from "./shopify-revenue-adapter.js";
import type {
  AnalysisWindow,
  Ga4AiReferralPort,
  Ga4AiReferralRevenue,
  GoogleAdsPort,
  GoogleTrendsPort,
  IntegrationRegistryConfig,
  MerchantCenterPort,
  MetaCacPort,
  MetaSkuCac,
  ProductConversionMetrics,
  SearchConsoleOwnedSurfaceRead,
  SearchConsolePort,
  SeoAuthorityPort,
  ShopifyProductSnapshotPort,
  ShopifyRevenuePort,
  ShopifySkuRevenue,
} from "./types.js";

function defaultWindow(): AnalysisWindow {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function metaFor(port: string, source: string) {
  return { port, fetchedAt: new Date().toISOString(), source };
}

/** Mock Shopify read — real OAuth call wired when secret_ref resolves in production. */
export function createShopifyRevenuePort(
  config: IntegrationRegistryConfig,
  overrides?: Partial<Record<string, Omit<ShopifySkuRevenue, "meta">>>,
): ShopifyRevenuePort {
  return {
    async getSkuRevenue(ref: string, _window: AnalysisWindow): Promise<ShopifySkuRevenue> {
      const override = overrides?.[ref];
      if (override) {
        return { ...override, meta: metaFor("shopify", config.shopify?.shopDomain ?? "mock") };
      }

      const ticketMedio = 450;
      const orders = 10;
      return {
        externalRef: ref,
        revenue: ticketMedio * orders,
        orders,
        ticketMedio,
        meta: { ...metaFor("shopify", config.shopify?.shopDomain ?? "mock"), port: "shopify" },
      };
    },
  };
}

function productNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() ?? "hero-product";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "Hero Product";
  }
}

export function createShopifyProductSnapshotPort(
  config: IntegrationRegistryConfig,
  overrides?: Partial<Record<string, ShopifyProductSnapshot>>,
): ShopifyProductSnapshotPort {
  return {
    async getProductSnapshot(input): Promise<ShopifyProductSnapshot | null> {
      const key = input.ref ?? input.url;
      const override = overrides?.[key];
      if (override) return override;

      const source = config.shopify?.shopDomain ?? "mock";
      const name = productNameFromUrl(input.url);
      const attributes = ["material", "dimensão", "cor"];
      const material = "material informado";
      const dimension = "dimensão informada";
      const color = "Natural";
      const admin = {
        attributeCount: 3,
        descriptionChars: 120,
        hasMaterial: true,
        hasColor: true,
        hasDimension: true,
        hasImageAlt: false,
        thin: false,
        gaps: [] as Array<"attributes" | "description" | "physical" | "image_alt">,
      };
      return {
        externalRef: input.ref,
        url: input.url,
        name,
        brand: null,
        currentPrice: 450,
        currency: "BRL",
        attributes,
        variants: [
          {
            id: input.ref,
            title: "Default",
            price: 450,
            inventoryQuantity: 12,
            selectedOptions: { Cor: "Natural" },
          },
        ],
        inventoryAvailable: 12,
        material,
        dimension,
        color,
        image: null,
        imageAlt: null,
        descriptionChars: 120,
        meta: { source, fetchedAt: new Date().toISOString(), admin },
      };
    },
  };
}

export function createMetaCacPort(
  config: IntegrationRegistryConfig,
  overrides?: Partial<Record<string, Omit<MetaSkuCac, "meta">>>,
): MetaCacPort {
  return {
    async getSkuCac(ref: string, _window: AnalysisWindow): Promise<MetaSkuCac> {
      const override = overrides?.[ref];
      if (override) {
        return { ...override, meta: metaFor("meta", config.meta?.adAccountId ?? "mock") };
      }

      return {
        externalRef: ref,
        spend: 1350,
        conversions: 10,
        cac: 135,
        meta: metaFor("meta", config.meta?.adAccountId ?? "mock"),
      };
    },
  };
}

export function createGa4AiReferralPort(
  config: IntegrationRegistryConfig,
  overrideRevenue?: number,
): Ga4AiReferralPort {
  return {
    async getAiReferralRevenue(_window: AnalysisWindow): Promise<Ga4AiReferralRevenue> {
      const totalRevenue = overrideRevenue ?? 4500;
      return {
        totalRevenue,
        totalSessions: 44,
        bySource: [
          {
            source: "chatgpt.com",
            medium: "ai-assistant",
            revenue: totalRevenue * 0.5,
            sessions: 22,
          },
          {
            source: "gemini.google.com",
            medium: "referral",
            revenue: totalRevenue * 0.3,
            sessions: 13,
          },
          {
            source: "perplexity.ai",
            medium: "(not set)",
            revenue: totalRevenue * 0.2,
            sessions: 9,
          },
        ],
        meta: metaFor("ga4", config.ga4?.propertyId ?? "mock"),
      };
    },

    async getSkuConversionMetrics(
      ref: string,
      _window: AnalysisWindow,
    ): Promise<ProductConversionMetrics> {
      return {
        externalRef: ref,
        conversionRate: 0.018,
        sessions: 1200,
        nonConvertingSessions: 1178,
        bounceRate: 0.42,
        scrollDepth: 0.58,
        meta: metaFor("ga4", config.ga4?.propertyId ?? "mock"),
      };
    },
  };
}

export function createGoogleAdsPort(config: IntegrationRegistryConfig): GoogleAdsPort {
  return {
    async getSkuWaste(ref: string, _window: AnalysisWindow) {
      return {
        externalRef: ref,
        spend: null,
        roas: null,
        breakEvenRoas: null,
        wastedSpend: null,
        clickVolumeWithoutConversion: null,
        meta: metaFor("google_ads", config.googleAds?.customerId ?? "stub_unavailable"),
      };
    },
  };
}

export function createMerchantCenterPort(config: IntegrationRegistryConfig): MerchantCenterPort {
  return {
    async getProductStatus(ref: string, _window: AnalysisWindow) {
      return {
        externalRef: ref,
        approved: null,
        gtinValid: null,
        priceMatchesShopify: null,
        disapprovedReason: null,
        lostRevenue: null,
        meta: metaFor("merchant_center", config.merchantCenter?.merchantId ?? "stub_unavailable"),
      };
    },
  };
}

export function createGoogleTrendsPort(config: IntegrationRegistryConfig): GoogleTrendsPort {
  return {
    async getInterest(term: string, _window: AnalysisWindow) {
      return {
        term,
        interest: null,
        seasonalIndex: null,
        meta: metaFor(
          "google_trends",
          config.googleTrends?.apiKey ? "configured" : "stub_unavailable",
        ),
      };
    },
  };
}

export function createSeoAuthorityPort(config: IntegrationRegistryConfig): SeoAuthorityPort {
  return {
    async getAuthorityGap(input) {
      return {
        competitorUrl: input.competitorUrl,
        domainsCitingCompetitorNotClient: [],
        meta: metaFor("seo", config.seo?.provider ?? "stub_unavailable"),
      };
    },
  };
}

export function createSearchConsolePort(config: IntegrationRegistryConfig): SearchConsolePort {
  return {
    async getOwnedSurfaces(input): Promise<SearchConsoleOwnedSurfaceRead> {
      const configured = config.searchConsole;
      const host = input.storefrontHost?.trim() ?? "";
      return {
        properties: configured?.properties ?? [],
        ownedContentHosts: configured?.ownedContentHosts ?? [],
        ownedContentPaths: configured?.ownedContentPaths ?? ["/blog", "/pages", "/guias"],
        ownedContentCandidates: configured?.ownedContentCandidates ?? [],
        meta: metaFor("search_console", configured?.secretRef ?? (host || "stub_unavailable")),
      };
    },
  };
}

export function createIntegrationPorts(
  config: IntegrationRegistryConfig = {},
  window: AnalysisWindow = defaultWindow(),
): {
  ports: {
    shopify: ShopifyRevenuePort;
    shopifyProduct: ShopifyProductSnapshotPort;
    meta: MetaCacPort;
    ga4: Ga4AiReferralPort;
    googleAds: GoogleAdsPort;
    merchantCenter: MerchantCenterPort;
    googleTrends: GoogleTrendsPort;
    seo: SeoAuthorityPort;
    searchConsole: SearchConsolePort;
  };
  window: AnalysisWindow;
} {
  return {
    ports: {
      shopify:
        config.shopify?.accessToken && config.shopify.shopDomain
          ? createRealShopifyRevenuePort({
              shopDomain: config.shopify.shopDomain,
              accessToken: config.shopify.accessToken,
              adminApiVersion: config.shopify.adminApiVersion,
            })
          : createShopifyRevenuePort(config),
      shopifyProduct:
        config.shopify?.accessToken && config.shopify.shopDomain
          ? createRealShopifyProductSnapshotPort({
              shopDomain: config.shopify.shopDomain,
              accessToken: config.shopify.accessToken,
              adminApiVersion: config.shopify.adminApiVersion,
            })
          : createShopifyProductSnapshotPort(config),
      meta:
        config.meta?.accessToken && config.meta.adAccountId
          ? createRealMetaCacPort({
              adAccountId: config.meta.adAccountId,
              accessToken: config.meta.accessToken,
              graphApiVersion: config.meta.graphApiVersion,
            })
          : createMetaCacPort(config),
      ga4:
        config.ga4?.accessToken && config.ga4.propertyId
          ? createRealGa4AiReferralPort({
              propertyId: config.ga4.propertyId,
              accessToken: config.ga4.accessToken,
              refreshToken: config.ga4.refreshToken,
              clientId: config.ga4.clientId,
              clientSecret: config.ga4.clientSecret,
            })
          : createGa4AiReferralPort(config),
      googleAds: createGoogleAdsPort(config),
      merchantCenter: createMerchantCenterPort(config),
      googleTrends: createGoogleTrendsPort(config),
      seo: createSeoAuthorityPort(config),
      searchConsole: createSearchConsolePort(config),
    },
    window,
  };
}

export type { AnalysisWindow, IntegrationPorts, IntegrationRegistryConfig } from "./types.js";
