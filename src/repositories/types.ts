export type StoreStatus = "active" | "paused";

export type StoreRow = {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  locale: string;
  status: StoreStatus;
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: string;
  store_id: string;
  url: string;
  title: string | null;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type PromptRow = {
  id: string;
  store_id: string;
  prompt_text: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type UpsertStoreInput = {
  name: string;
  domain?: string | null;
  locale?: string;
  status?: StoreStatus;
};

export type CreateProductInput = {
  url: string;
  title?: string | null;
  description?: string | null;
  position: number;
};

export type UpdateProductInput = {
  url?: string;
  title?: string | null;
  description?: string | null;
  position?: number;
};

export type CreatePromptInput = {
  prompt_text: string;
  active?: boolean;
  sort_order?: number;
};

export type UpdatePromptInput = {
  prompt_text?: string;
  active?: boolean;
  sort_order?: number;
};

export const MAX_PRODUCTS_PER_STORE = 3;
export const MAX_PROMPTS_PER_STORE = 10;

export type ProbeRunStatus = "pending" | "running" | "completed" | "failed";

export type ProbeRunRow = {
  id: string;
  store_id: string;
  status: ProbeRunStatus;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
};

export type ProbeRunSummary = ProbeRunRow & {
  citations_count: number;
  citation_slots_total: number;
};

export type ProbeRunListItem = ProbeRunRow & {
  citations_count: number;
  citation_slots_total: number;
};

export type ResultProvider = "claude" | "chatgpt" | "gemini";

export type ResultRow = {
  id: string;
  probe_run_id: string;
  prompt_id: string;
  provider: ResultProvider;
  cited: boolean;
  response_excerpt: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CatalogFix = {
  type: "title" | "description" | "schema" | string;
  product_url?: string;
  product_title?: string;
  suggestion: string;
  reason?: string;
};

export type WeeklyScoreRow = {
  id: string;
  store_id: string;
  probe_run_id: string | null;
  week_start: string;
  prompts_total: number;
  citation_slots_total: number;
  citations_count: number;
  score_pct: number;
  fixes: CatalogFix[];
  created_at: string;
};

export type ResultWithPrompt = ResultRow & {
  prompt_text: string;
  probe_completed_at: string | null;
};

