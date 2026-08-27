import type {
  AnalysisWindow,
  Ga4AiLanding,
  Ga4AiReferralPort,
  Ga4AiReferralRevenue,
} from "./types.js";

/** Exact hosts the Nuture probe proved, plus aliases the three IAs actually emit. */
export const GA4_AI_REFERRAL_SOURCE_REGEX =
  "^(chatgpt\\.com|chat\\.openai\\.com|gemini\\.google\\.com|bard\\.google\\.com|www\\.perplexity\\.ai|perplexity\\.ai|perplexity)$";

/** Brand tokens so `ai-assistant` medium does not pull Claude / Copilot / Grok. */
export const GA4_AI_REFERRAL_BRAND_REGEX = "chatgpt|openai|gemini|bard|perplexity";

/** Pontual top-K — not a pageview warehouse. */
export const GA4_AI_LANDING_LIMIT = 8;

export const GA4_AI_REFERRAL_SOURCES = [
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "bard.google.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "perplexity",
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

export function ga4AiReferralDimensionFilter(): Record<string, unknown> {
  return {
    orGroup: {
      expressions: [
        {
          filter: {
            fieldName: "sessionSource",
            stringFilter: {
              matchType: "FULL_REGEXP",
              value: GA4_AI_REFERRAL_SOURCE_REGEX,
              caseSensitive: false,
            },
          },
        },
        {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "sessionMedium",
                  stringFilter: {
                    matchType: "EXACT",
                    value: "ai-assistant",
                    caseSensitive: false,
                  },
                },
              },
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: {
                    matchType: "PARTIAL_REGEXP",
                    value: GA4_AI_REFERRAL_BRAND_REGEX,
                    caseSensitive: false,
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

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

export type Ga4AiSourceSessions = { source: string; sessions: number };

/** Persist hosts that actually sent sessions — not revenue, not medium. */
export function snapshotGa4AiSources(
  bySource: Array<{ source: string; sessions: number }>,
): Ga4AiSourceSessions[] {
  const rows: Ga4AiSourceSessions[] = [];
  for (const row of bySource) {
    const source = row.source.trim();
    if (!source || row.sessions <= 0) continue;
    rows.push({ source, sessions: row.sessions });
  }
  return rows;
}

export function ga4SessionEvidence(ga4: Pick<Ga4AiReferralRevenue, "landings" | "bySource">): {
  sessoesAiLandings?: Ga4AiLanding[];
  sessoesAiBySource?: Ga4AiSourceSessions[];
} {
  const landings = (ga4.landings ?? []).slice(0, GA4_AI_LANDING_LIMIT);
  const sources = snapshotGa4AiSources(ga4.bySource);
  return {
    ...(landings.length > 0 ? { sessoesAiLandings: landings } : {}),
    ...(sources.length > 0 ? { sessoesAiBySource: sources } : {}),
  };
}

export function parseGa4LandingRows(payload: RunReportResponse): Ga4AiLanding[] {
  const landings: Ga4AiLanding[] = [];
  for (const row of payload.rows ?? []) {
    const path = row.dimensionValues?.[0]?.value?.trim() ?? "";
    const sessions = Number(row.metricValues?.[0]?.value ?? 0) || 0;
    if (!path || sessions <= 0) continue;
    landings.push({ path, sessions });
    if (landings.length >= GA4_AI_LANDING_LIMIT) break;
  }
  return landings;
}

async function runGa4Report(
  fetchImpl: typeof fetch,
  propertyId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<RunReportResponse> {
  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = (await response.json()) as RunReportResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "ga4_run_report_failed");
  }
  return payload;
}

async function refreshAccessToken(
  credentials: Ga4PortCredentials,
  fetchImpl: typeof fetch,
): Promise<string> {
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
      const dateRanges = [{ startDate: window.start, endDate: window.end }];
      const dimensionFilter = ga4AiReferralDimensionFilter();

      const payload = await runGa4Report(fetchImpl, propertyId, accessToken, {
        dateRanges,
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "purchaseRevenue" }, { name: "sessions" }],
        dimensionFilter,
      });

      const bySource: Ga4AiReferralRevenue["bySource"] = [];
      let totalRevenue = 0;
      let totalSessions = 0;

      for (const row of payload.rows ?? []) {
        const source = row.dimensionValues?.[0]?.value?.trim() ?? "";
        const medium = row.dimensionValues?.[1]?.value?.trim() || null;
        const revenue = Number(row.metricValues?.[0]?.value ?? 0) || 0;
        const sessions = Number(row.metricValues?.[1]?.value ?? 0) || 0;
        if (!source || (revenue <= 0 && sessions <= 0)) continue;
        bySource.push({ source, medium, revenue, sessions });
        totalRevenue += revenue;
        totalSessions += sessions;
      }

      let landings: Ga4AiLanding[] = [];
      try {
        const landingPayload = await runGa4Report(fetchImpl, propertyId, accessToken, {
          dateRanges,
          dimensions: [{ name: "landingPage" }],
          metrics: [{ name: "sessions" }],
          dimensionFilter,
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: GA4_AI_LANDING_LIMIT,
        });
        landings = parseGa4LandingRows(landingPayload);
      } catch {
        landings = [];
      }

      return {
        totalRevenue,
        totalSessions,
        bySource,
        ...(landings.length > 0 ? { landings } : {}),
        meta: metaFor(propertyId),
      };
    },
  };
}
