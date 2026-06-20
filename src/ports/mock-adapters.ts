import type {
  AnalysisWindow,
  Ga4AiReferralPort,
  Ga4AiReferralRevenue,
  IntegrationRegistryConfig,
  MetaCacPort,
  MetaSkuCac,
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
    async getSkuRevenue(ref: string, window: AnalysisWindow): Promise<ShopifySkuRevenue> {
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
        bySource: [
          { source: "chatgpt.com", revenue: totalRevenue * 0.5 },
          { source: "gemini.google.com", revenue: totalRevenue * 0.3 },
          { source: "perplexity.ai", revenue: totalRevenue * 0.2 },
        ],
        meta: metaFor("ga4", config.ga4?.propertyId ?? "mock"),
      };
    },
  };
}

export function createIntegrationPorts(
  config: IntegrationRegistryConfig = {},
  window: AnalysisWindow = defaultWindow(),
): { ports: { shopify: ShopifyRevenuePort; meta: MetaCacPort; ga4: Ga4AiReferralPort }; window: AnalysisWindow } {
  return {
    ports: {
      shopify: createShopifyRevenuePort(config),
      meta: createMetaCacPort(config),
      ga4: createGa4AiReferralPort(config),
    },
    window,
  };
}

export type { AnalysisWindow, IntegrationPorts, IntegrationRegistryConfig } from "./types.js";
