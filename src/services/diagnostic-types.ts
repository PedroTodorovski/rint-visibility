import type {
  ClientCitationEvidence,
  SearchConsoleOwnedContentCandidate,
  SearchConsoleProperty,
} from "../lib/citation-gold.js";
import type { GeminiStructuredOutput } from "../lib/llm/gemini-structured.js";
import type { LlmProviderId } from "../lib/llm/types.js";

/**
 * Probe depth — not a commercial plan name.
 * `essential` is the MVP default (1 execution/query) for every founder plan.
 * `pro` (3 executions) is reserved if billing lever B (depth) is chosen later.
 * Quota of new diagnoses per period (lever A, preferred) lives in rint-app D1.
 * See rint-app `docs/architecture/BILLING-CONTRACT.md`.
 */
export type DiagnosticPlan = "essential" | "pro";

export type DiagnosticPhase = "mvp" | "phase_2" | "phase_3";

export type DiagnosticJobStatus = "pending" | "running" | "completed" | "failed";

export type CoherenceLevel = "coerente" | "parcialmente_coerente" | "incoerente";

export type DiagnosticTrack = "track_llm" | "track_pdp" | "track_produto" | "track_midia";

export type ShopifyProductSnapshot = {
  externalRef: string | null;
  url: string;
  name: string;
  brand: string | null;
  currentPrice: number;
  currency: string | null;
  attributes: string[];
  variants: Array<{
    id: string | null;
    title: string | null;
    price: number | null;
    inventoryQuantity: number | null;
    selectedOptions?: Record<string, string>;
  }>;
  inventoryAvailable: number | null;
  material?: string | null;
  dimension?: string | null;
  color?: string | null;
  image: string | null;
  /** Featured image alt from Admin — empty hurts AI/crawler recognition. */
  imageAlt?: string | null;
  /** Plain-text length of descriptionHtml from Admin (pontual). */
  descriptionChars?: number;
  meta: {
    source: string;
    fetchedAt: string;
    /** true/false when public PDP was readable; null when unverified (password/block/fetch fail). */
    hasJsonLd?: boolean | null;
    hasOg?: boolean;
    /** Public GET result — a catalog listing is not the public URL. */
    storefrontAccess?: "open" | "password" | "blocked" | "unverified";
    /** Derived from URL / JSON-LD / HTML at diagnosis time. Null = unknown. */
    storefrontPlatform?: "shopify" | "vtex" | "nuvemshop" | null;
    imageSource?: "shopify_api" | "json_ld" | "og" | null;
    /**
     * Shopify was connected on this run, but this SKU was not in that Admin.
     * Street snapshot + probe still run. Not a marketplace URL.
     */
    panelMismatch?: boolean;
    /** Shop was connected even when the snapshot is from the street. */
    shopConnected?: boolean;
    shopDomain?: string | null;
    /** Admin catalog readiness — gold when Shopify is connected. */
    admin?: {
      attributeCount: number;
      descriptionChars: number;
      hasMaterial: boolean;
      hasColor: boolean;
      hasDimension: boolean;
      hasImageAlt: boolean;
      thin: boolean;
      gaps: Array<"attributes" | "description" | "physical" | "image_alt">;
    };
    /** Brand-owned surfaces known at diagnosis time. Do not infer every subdomain as owned. */
    ownedSurfaces?: {
      storefrontHosts?: string[];
      ownedContentHosts?: string[];
      ownedContentPaths?: string[];
      searchConsoleProperties?: SearchConsoleProperty[];
      ownedContentCandidates?: SearchConsoleOwnedContentCandidate[];
      meta?: { port?: string; source?: string; fetchedAt?: string };
    };
  };
};

export type {
  ClientIdentity,
  GeminiCitedObject,
  GeminiStructuredOutput,
} from "../lib/llm/gemini-structured.js";

export type QueryExecutionRecord = {
  raw_text: string;
  structured: GeminiStructuredOutput;
  grounding_urls: string[];
  dead_urls: string[];
  model: string;
  mocked: boolean;
  provider?: LlmProviderId;
  citation: ClientCitationEvidence;
  grounding_supports?: Array<{ text: string; hosts: string[]; hrefs: string[] }>;
  follow_up?: boolean;
  follow_up_query?: string;
  measured_at?: string;
  from_query_id?: string;
};

export type DiagnosticRunConfig = {
  plan: DiagnosticPlan;
  phase: DiagnosticPhase;
  maxSkus: number | null;
  maxQueriesPerSku: number | null;
  executionsPerQuery: number;
  geminiTemperature: number;
};

export function normalizeDiagnosticPlan(value: unknown): DiagnosticPlan {
  return value === "pro" ? "pro" : "essential";
}

export function runConfigForPlan(
  plan: DiagnosticPlan,
  options: { phase?: DiagnosticPhase; maxSkus: number; maxQueriesPerSku: number },
): DiagnosticRunConfig {
  const phase = options.phase ?? "mvp";
  const unlimited = phase === "phase_3";

  return {
    plan,
    phase,
    maxSkus: unlimited ? null : phase === "phase_2" ? 10 : options.maxSkus,
    maxQueriesPerSku: unlimited ? null : phase === "phase_2" ? 15 : options.maxQueriesPerSku,
    // `pro` triples executions; commercial plans currently all send `essential`.
    executionsPerQuery: plan === "pro" ? 3 : 1,
    geminiTemperature: 0,
  };
}
