import type { AnalysisWindow, MetaCacPort, MetaSkuCac } from "./types.js";

export type MetaPortCredentials = {
  adAccountId: string;
  accessToken: string;
  graphApiVersion?: string;
};

type InsightsResponse = {
  data?: Array<{
    spend?: string;
    actions?: Array<{ action_type?: string; value?: string }>;
  }>;
  error?: { message?: string };
};

function graphBaseUrl(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

function normalizeAdAccountId(adAccountId: string): string {
  const digits = adAccountId.replace(/^act_/, "").trim();
  return `act_${digits}`;
}

function metaFor(adAccountId: string): MetaSkuCac["meta"] {
  return {
    port: "meta",
    fetchedAt: new Date().toISOString(),
    source: adAccountId,
  };
}

function purchaseConversions(actions: Array<{ action_type?: string; value?: string }> | undefined): number {
  let total = 0;
  for (const action of actions ?? []) {
    const type = action.action_type ?? "";
    if (!type.includes("purchase")) continue;
    total += Number(action.value ?? 0) || 0;
  }
  return total;
}

export function createMetaCacPort(
  credentials: MetaPortCredentials,
  fetchImpl: typeof fetch = fetch,
): MetaCacPort {
  const adAccountId = normalizeAdAccountId(credentials.adAccountId);
  const apiVersion = credentials.graphApiVersion?.trim() || "v21.0";

  return {
    async getSkuCac(_ref: string, window: AnalysisWindow): Promise<MetaSkuCac> {
      const url = new URL(`${graphBaseUrl(apiVersion)}/${adAccountId}/insights`);
      url.searchParams.set(
        "fields",
        "spend,actions",
      );
      url.searchParams.set(
        "time_range",
        JSON.stringify({ since: window.start, until: window.end }),
      );
      url.searchParams.set("access_token", credentials.accessToken);

      const response = await fetchImpl(url);
      const payload = (await response.json()) as InsightsResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "meta_insights_failed");
      }

      const row = payload.data?.[0];
      const spend = Number(row?.spend ?? 0) || 0;
      const conversions = purchaseConversions(row?.actions);
      const cac = conversions > 0 ? spend / conversions : 0;

      return {
        externalRef: adAccountId,
        spend,
        conversions,
        cac,
        meta: metaFor(adAccountId),
      };
    },
  };
}
