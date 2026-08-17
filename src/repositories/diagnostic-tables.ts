import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CoherenceLevel,
  DiagnosticJobStatus,
  DiagnosticPlan,
  DiagnosticTrack,
  GeminiStructuredOutput,
  ShopifyProductSnapshot,
} from "../services/diagnostic-types.js";
import { mapPostgrestError } from "./postgrest.js";

type VisibilityDb = SupabaseClient<any, "public", "rint">;

export type JobRow = {
  id: string;
  store_id: string;
  probe_run_id: string | null;
  status: DiagnosticJobStatus;
  plan: DiagnosticPlan;
  webhook_url: string | null;
  config_snapshot: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type CreateJobInput = {
  store_id: string;
  probe_run_id?: string | null;
  plan: DiagnosticPlan;
  webhook_url?: string | null;
  config_snapshot?: Record<string, unknown>;
};

export type DiagnosticSkuRow = {
  id: string;
  job_id: string;
  product_id: string | null;
  url: string;
  external_ref: string | null;
  shopify_data: ShopifyProductSnapshot;
  validation_status: "valid" | "invalid";
  validation_errors: string[];
  created_at: string;
};

export type CreateDiagnosticSkuInput = {
  job_id: string;
  product_id?: string | null;
  url: string;
  external_ref?: string | null;
  shopify_data: ShopifyProductSnapshot;
  validation_status?: "valid" | "invalid";
  validation_errors?: string[];
};

export type DiagnosticQueryRow = {
  id: string;
  job_id: string;
  sku_id: string;
  prompt_id: string | null;
  query_text: string;
  gemini_raw: string | null;
  gemini_structured: GeminiStructuredOutput;
  cliente_foi_citado: boolean;
  concorrente_citado_nome: string | null;
  concorrente_citado_url: string | null;
  atributos_mencionados_gemini: string[];
  temperatura_gemini: number;
  num_execucoes: number;
  confianca: string | null;
  executions: Record<string, unknown>[];
  created_at: string;
};

export type CreateDiagnosticQueryInput = Omit<DiagnosticQueryRow, "id" | "created_at">;

export type TriageResultRow = {
  id: string;
  job_id: string;
  sku_id: string | null;
  coherence_level: CoherenceLevel;
  track_assigned: DiagnosticTrack;
  checks: Record<string, unknown>;
  created_at: string;
};

export type CreateTriageResultInput = Omit<TriageResultRow, "id" | "created_at">;

export type FinancialRiskRow = {
  id: string;
  job_id: string;
  sku_id: string | null;
  gap_value: number | null;
  lost_clients: number | null;
  compensation_cost: number | null;
  formula_type: string;
  inputs: Record<string, unknown>;
  created_at: string;
};

export type CreateFinancialRiskInput = Omit<FinancialRiskRow, "id" | "created_at">;

export type DiagnosticRow = {
  id: string;
  job_id: string;
  sku_id: string | null;
  track: DiagnosticTrack;
  causes: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  next_steps: Record<string, unknown>;
  prazo: string;
  created_at: string;
};

export type CreateDiagnosticInput = Omit<DiagnosticRow, "id" | "created_at">;

export type UsageEventRow = {
  id: string;
  job_id: string;
  tokens_consumed: number;
  apis_called: Record<string, unknown>;
  timestamp: string;
};

export type CreateUsageEventInput = Omit<UsageEventRow, "id" | "timestamp">;

export class JobsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateJobInput): Promise<JobRow> {
    const { data, error } = await this.db
      .from("jobs")
      .insert({
        store_id: input.store_id,
        probe_run_id: input.probe_run_id ?? null,
        status: "pending",
        plan: input.plan,
        webhook_url: input.webhook_url ?? null,
        config_snapshot: input.config_snapshot ?? {},
      })
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to create diagnostic job");
    return data as JobRow;
  }

  async updateStatus(
    id: string,
    status: DiagnosticJobStatus,
    fields: { started_at?: string; completed_at?: string; error_message?: string } = {},
  ): Promise<JobRow> {
    const { data, error } = await this.db
      .from("jobs")
      .update({ status, updated_at: new Date().toISOString(), ...fields })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to update diagnostic job");
    return data as JobRow;
  }

  async findByIdForStore(storeId: string, jobId: string): Promise<JobRow | null> {
    const { data, error } = await this.db
      .from("jobs")
      .select("*")
      .eq("store_id", storeId)
      .eq("id", jobId)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load diagnostic job");
    return data as JobRow | null;
  }

  async findById(jobId: string): Promise<JobRow | null> {
    const { data, error } = await this.db.from("jobs").select("*").eq("id", jobId).maybeSingle();
    if (error) throw mapPostgrestError(error, "Failed to load diagnostic job");
    return data as JobRow | null;
  }

  async findLatestByStoreId(storeId: string): Promise<JobRow | null> {
    const { data, error } = await this.db
      .from("jobs")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load latest diagnostic job");
    return data as JobRow | null;
  }

  async findByProbeRunId(storeId: string, probeRunId: string): Promise<JobRow | null> {
    const { data, error } = await this.db
      .from("jobs")
      .select("*")
      .eq("store_id", storeId)
      .eq("probe_run_id", probeRunId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load diagnostic job for probe run");
    return data as JobRow | null;
  }
}

export class DiagnosticSkusRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateDiagnosticSkuInput): Promise<DiagnosticSkuRow> {
    const { data, error } = await this.db
      .from("skus")
      .insert({
        job_id: input.job_id,
        product_id: input.product_id ?? null,
        url: input.url,
        external_ref: input.external_ref ?? null,
        shopify_data: input.shopify_data,
        validation_status: input.validation_status ?? "valid",
        validation_errors: input.validation_errors ?? [],
      })
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to create diagnostic SKU");
    return data as DiagnosticSkuRow;
  }

  async listByJobId(jobId: string): Promise<DiagnosticSkuRow[]> {
    const { data, error } = await this.db
      .from("skus")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    if (error) throw mapPostgrestError(error, "Failed to list diagnostic SKUs");
    return (data ?? []) as DiagnosticSkuRow[];
  }
}

export class DiagnosticQueriesRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateDiagnosticQueryInput): Promise<DiagnosticQueryRow> {
    const { data, error } = await this.db.from("queries").insert(input).select("*").single();
    if (error) throw mapPostgrestError(error, "Failed to create diagnostic query");
    return data as DiagnosticQueryRow;
  }

  async listByJobId(jobId: string): Promise<DiagnosticQueryRow[]> {
    const { data, error } = await this.db
      .from("queries")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    if (error) throw mapPostgrestError(error, "Failed to list diagnostic queries");
    return (data ?? []) as DiagnosticQueryRow[];
  }
}

export class TriageResultsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateTriageResultInput): Promise<TriageResultRow> {
    const { data, error } = await this.db.from("triage_results").insert(input).select("*").single();
    if (error) throw mapPostgrestError(error, "Failed to create triage result");
    return data as TriageResultRow;
  }

  async findByJobId(jobId: string): Promise<TriageResultRow | null> {
    const { data, error } = await this.db
      .from("triage_results")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load triage result");
    return data as TriageResultRow | null;
  }
}

export class FinancialRiskRepository {
  constructor(private readonly db: VisibilityDb) {}

  async createMany(inputs: CreateFinancialRiskInput[]): Promise<FinancialRiskRow[]> {
    if (inputs.length === 0) return [];
    const { data, error } = await this.db.from("financial_risk").insert(inputs).select("*");
    if (error) throw mapPostgrestError(error, "Failed to create financial risk rows");
    return (data ?? []) as FinancialRiskRow[];
  }

  async listByJobId(jobId: string): Promise<FinancialRiskRow[]> {
    const { data, error } = await this.db
      .from("financial_risk")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    if (error) throw mapPostgrestError(error, "Failed to list financial risk rows");
    return (data ?? []) as FinancialRiskRow[];
  }
}

export class DiagnosticsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateDiagnosticInput): Promise<DiagnosticRow> {
    const { data, error } = await this.db.from("diagnostics").insert(input).select("*").single();
    if (error) throw mapPostgrestError(error, "Failed to create diagnostic");
    return data as DiagnosticRow;
  }

  async findByJobId(jobId: string): Promise<DiagnosticRow | null> {
    const { data, error } = await this.db
      .from("diagnostics")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, "Failed to load diagnostic");
    return data as DiagnosticRow | null;
  }
}

export class UsageEventsRepository {
  constructor(private readonly db: VisibilityDb) {}

  async create(input: CreateUsageEventInput): Promise<UsageEventRow> {
    const { data, error } = await this.db
      .from("usage_events")
      .insert({
        job_id: input.job_id,
        tokens_consumed: input.tokens_consumed,
        apis_called: input.apis_called,
      })
      .select("*")
      .single();

    if (error) throw mapPostgrestError(error, "Failed to create usage event");
    return data as UsageEventRow;
  }
}
