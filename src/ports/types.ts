import type { ShopifyProductSnapshot } from "../services/diagnostic-types.js";

export type AnalysisWindow = {
  start: string;
  end: string;
};

export type PortReadMeta = {
  port: string;
  fetchedAt: string;
  source: string;
};

export type ShopifySkuRevenue = {
  externalRef: string;
  revenue: number;
  orders: number;
  ticketMedio: number;
  meta: PortReadMeta;
};

export type MetaSkuCac = {
  externalRef: string;
  spend: number;
  conversions: number;
  cac: number;
  meta: PortReadMeta;
};

export type Ga4AiReferralRevenue = {
  totalRevenue: number;
  bySource: Array<{ source: string; revenue: number }>;
  meta: PortReadMeta;
};

export type ProductConversionMetrics = {
  externalRef: string;
  conversionRate: number | null;
  sessions: number | null;
  nonConvertingSessions: number | null;
  bounceRate: number | null;
  scrollDepth: number | null;
  meta: PortReadMeta;
};

export type GoogleAdsSkuWaste = {
  externalRef: string;
  spend: number | null;
  roas: number | null;
  breakEvenRoas: number | null;
  wastedSpend: number | null;
  clickVolumeWithoutConversion: number | null;
  meta: PortReadMeta;
};

export type MerchantCenterProductStatus = {
  externalRef: string;
  approved: boolean | null;
  gtinValid: boolean | null;
  priceMatchesShopify: boolean | null;
  disapprovedReason: string | null;
  lostRevenue: number | null;
  meta: PortReadMeta;
};

export type TrendsInterest = {
  term: string;
  interest: number | null;
  seasonalIndex: number | null;
  meta: PortReadMeta;
};

export type SeoAuthorityGap = {
  competitorUrl: string;
  domainsCitingCompetitorNotClient: string[];
  meta: PortReadMeta;
};

export type ShopifyRevenuePort = {
  getSkuRevenue(ref: string, window: AnalysisWindow): Promise<ShopifySkuRevenue>;
};

export type ShopifyProductSnapshotPort = {
  getProductSnapshot(input: {
    ref: string | null;
    url: string;
  }): Promise<ShopifyProductSnapshot | null>;
};

export type MetaCacPort = {
  getSkuCac(ref: string, window: AnalysisWindow): Promise<MetaSkuCac>;
};

export type Ga4AiReferralPort = {
  getAiReferralRevenue(window: AnalysisWindow): Promise<Ga4AiReferralRevenue>;
  getSkuConversionMetrics?(ref: string, window: AnalysisWindow): Promise<ProductConversionMetrics>;
};

export type GoogleAdsPort = {
  getSkuWaste(ref: string, window: AnalysisWindow): Promise<GoogleAdsSkuWaste>;
};

export type MerchantCenterPort = {
  getProductStatus(ref: string, window: AnalysisWindow): Promise<MerchantCenterProductStatus>;
};

export type GoogleTrendsPort = {
  getInterest(term: string, window: AnalysisWindow): Promise<TrendsInterest>;
};

export type SeoAuthorityPort = {
  getAuthorityGap(input: {
    competitorUrl: string;
    clientDomain: string | null;
  }): Promise<SeoAuthorityGap>;
};

export type IntegrationPorts = {
  shopify: ShopifyRevenuePort;
  shopifyProduct: ShopifyProductSnapshotPort;
  meta: MetaCacPort;
  ga4: Ga4AiReferralPort;
  googleAds: GoogleAdsPort;
  merchantCenter: MerchantCenterPort;
  googleTrends: GoogleTrendsPort;
  seo: SeoAuthorityPort;
};

export type IntegrationRegistryConfig = {
  shopify?: {
    shopDomain?: string;
    accessToken?: string;
    adminApiVersion?: string;
    secretRef?: string;
  };
  meta?: {
    adAccountId?: string;
    accessToken?: string;
    graphApiVersion?: string;
    secretRef?: string;
  };
  ga4?: {
    propertyId?: string;
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
    secretRef?: string;
  };
  googleAds?: { customerId?: string; accessToken?: string; secretRef?: string };
  merchantCenter?: { merchantId?: string; accessToken?: string; secretRef?: string };
  googleTrends?: { apiKey?: string; secretRef?: string };
  seo?: { provider?: "ahrefs" | "semrush" | string; apiKey?: string; secretRef?: string };
};
