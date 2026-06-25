import type { AnalysisWindow, Ga4AiReferralPort, Ga4AiReferralRevenue } from "./types.js";

export const GA4_AI_REFERRAL_SOURCES = [
  "chatgpt.com",
  "gemini.google.com",
  "perplexity.ai",
] as const;

export type Ga4PortCredentials = {
  propertyId: string;
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
};

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  error?: { message?: string };
};

function metaFor(propertyId: string): Ga4AiReferralRevenue["meta"] {
  return {
    port: "ga4",
    fetchedAt: new Date().toISOString(),
    source: propertyId,
  };
}

function normalizePropertyId(propertyId: string): string {
  return propertyId.replace(/^properties\//, "").trim();
}

async function refreshAccessToken(credentials: Ga4PortCredentials, fetchImpl: typeof fetch): Promise<string> {
  if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
    return credentials.accessToken;
  }

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error("ga4_token_refresh_failed");
  }

  return payload.access_token;
}

export function createGa4AiReferralPort(
  credentials: Ga4PortCredentials,
  fetchImpl: typeof fetch = fetch,
): Ga4AiReferralPort {
  const propertyId = normalizePropertyId(credentials.propertyId);

  return {
    async getAiReferralRevenue(window: AnalysisWindow): Promise<Ga4AiReferralRevenue> {
      const accessToken = await refreshAccessToken(credentials, fetchImpl);

      const response = await fetchImpl(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: window.start, endDate: window.end }],
            dimensions: [{ name: "sessionSource" }],
            metrics: [{ name: "purchaseRevenue" }],
            dimensionFilter: {
              filter: {
                fieldName: "sessionSource",
                inListFilter: { values: [...GA4_AI_REFERRAL_SOURCES] },
              },
            },
          }),
        },
      );

      const payload = (await response.json()) as RunReportResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "ga4_run_report_failed");
      }

      const bySource: Ga4AiReferralRevenue["bySource"] = [];
      let totalRevenue = 0;

      for (const row of payload.rows ?? []) {
        const source = row.dimensionValues?.[0]?.value ?? "";
        const revenue = Number(row.metricValues?.[0]?.value ?? 0) || 0;
        if (!source || revenue <= 0) continue;
        bySource.push({ source, revenue });
        totalRevenue += revenue;
      }

      return {
        totalRevenue,
        bySource,
        meta: metaFor(propertyId),
      };
    },
  };
}
