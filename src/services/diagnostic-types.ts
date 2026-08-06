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
  meta: { source: string; fetchedAt: string };
};

export type GeminiStructuredOutput = {
  cliente_foi_citado: boolean;
  concorrente_citado_nome: string | null;
  concorrente_citado_url: string | null;
  atributos_mencionados_gemini: string[];
  preco_citado: number | null;
  nome_marca_citada: string | null;
  produto_mencionado: string | null;
};

export type QueryExecutionRecord = {
  raw_text: string;
  structured: GeminiStructuredOutput;
  grounding_urls: string[];
  dead_urls: string[];
  model: string;
  mocked: boolean;
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
    executionsPerQuery: plan === "pro" ? 3 : 1,
    geminiTemperature: 0,
  };
}
