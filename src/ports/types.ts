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

export type ShopifyRevenuePort = {
  getSkuRevenue(ref: string, window: AnalysisWindow): Promise<ShopifySkuRevenue>;
};

export type MetaCacPort = {
  getSkuCac(ref: string, window: AnalysisWindow): Promise<MetaSkuCac>;
};

export type Ga4AiReferralPort = {
  getAiReferralRevenue(window: AnalysisWindow): Promise<Ga4AiReferralRevenue>;
};

export type IntegrationPorts = {
  shopify: ShopifyRevenuePort;
  meta: MetaCacPort;
  ga4: Ga4AiReferralPort;
};

export type IntegrationRegistryConfig = {
  shopify?: { shopDomain?: string; secretRef?: string };
  meta?: { adAccountId?: string; secretRef?: string };
  ga4?: { propertyId?: string; secretRef?: string };
};
