import type { IntegrationRegistryConfig } from "../ports/types.js";
import type {
  DiagnosticQueryRow,
  DiagnosticRow,
  JobRow,
} from "../repositories/diagnostic-tables.js";
import type { DiagnosticJobStatus, DiagnosticTrack } from "./diagnostic-types.js";

export const DIAGNOSTIC_HISTORY_SKU_CAP = 3;
export const DIAGNOSTIC_HISTORY_PROVIDERS = ["shopify", "meta", "ga4"] as const;

export type DiagnosticHistoryProvider = (typeof DIAGNOSTIC_HISTORY_PROVIDERS)[number];

export type DiagnosticJobSummary = {
  id: string;
  status: DiagnosticJobStatus;
  probe_run_id: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  sku_names: string[];
  cited: number;
  total: number;
  track: DiagnosticTrack | null;
  providers: DiagnosticHistoryProvider[];
};

export function providersFromIntegrationConfig(
  config?: IntegrationRegistryConfig | null,
): DiagnosticHistoryProvider[] {
  const present = new Set<DiagnosticHistoryProvider>();
  if (config?.shopify) present.add("shopify");
  if (config?.meta) present.add("meta");
  if (config?.ga4) present.add("ga4");
  return DIAGNOSTIC_HISTORY_PROVIDERS.filter((provider) => present.has(provider));
}

export function providersFromJobSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  skuSources: string[] = [],
): DiagnosticHistoryProvider[] {
  if (Array.isArray(snapshot?.providers)) {
    const stored = new Set(
      snapshot.providers.filter((value): value is string => typeof value === "string"),
    );
    return DIAGNOSTIC_HISTORY_PROVIDERS.filter((provider) => stored.has(provider));
  }

  const inferred = new Set<DiagnosticHistoryProvider>();
  if (
    skuSources.some(
      (source) => source === "shopify_api" || source.startsWith("shopify"),
    )
  ) {
    inferred.add("shopify");
  }
  return DIAGNOSTIC_HISTORY_PROVIDERS.filter((provider) => inferred.has(provider));
}

export function skuNameFromDiagnosticSku(sku: {
  url: string;
  shopify_data?: { name?: string | null } | null;
}): string {
  const named = sku.shopify_data?.name?.trim() ?? "";
  if (named) return named;
  try {
    const handle = new URL(sku.url).pathname.split("/").filter(Boolean).pop();
    if (!handle) return "";
    return decodeURIComponent(handle).replace(/-/g, " ");
  } catch {
    return "";
  }
}

function groupByJobId<T extends { job_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.job_id);
    if (list) list.push(row);
    else grouped.set(row.job_id, [row]);
  }
  return grouped;
}

export function summarizeDiagnosticJobs(
  jobs: JobRow[],
  skus: Array<{
    job_id: string;
    url: string;
    shopify_data?: { name?: string | null; meta?: { source?: string } } | null;
  }>,
  queries: Pick<DiagnosticQueryRow, "job_id" | "cliente_foi_citado">[],
  diagnostics: Pick<DiagnosticRow, "job_id" | "track" | "created_at">[],
): DiagnosticJobSummary[] {
  const skusByJob = groupByJobId(skus);
  const queriesByJob = groupByJobId(queries);
  const trackByJob = new Map<string, DiagnosticTrack>();
  const latestDiagnostic = [...diagnostics].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  for (const row of latestDiagnostic) {
    if (!trackByJob.has(row.job_id)) trackByJob.set(row.job_id, row.track);
  }

  return jobs.map((job) => {
    const jobQueries = queriesByJob.get(job.id) ?? [];
    const jobSkus = skusByJob.get(job.id) ?? [];
    const sku_names = jobSkus
      .map(skuNameFromDiagnosticSku)
      .filter((name) => name.length > 0)
      .slice(0, DIAGNOSTIC_HISTORY_SKU_CAP);
    const skuSources = jobSkus
      .map((sku) => sku.shopify_data?.meta?.source?.trim() ?? "")
      .filter(Boolean);

    return {
      id: job.id,
      status: job.status,
      probe_run_id: job.probe_run_id,
      created_at: job.created_at,
      completed_at: job.completed_at,
      error_message: job.error_message,
      sku_names,
      cited: jobQueries.filter((query) => query.cliente_foi_citado).length,
      total: jobQueries.length,
      track: trackByJob.get(job.id) ?? null,
      providers: providersFromJobSnapshot(job.config_snapshot, skuSources),
    };
  });
}
