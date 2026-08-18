import type {
  DiagnosticQueryRow,
  DiagnosticSkuRow,
  JobRow,
} from "../repositories/diagnostic-tables.js";
import type { ProductRow, PromptRow } from "../repositories/types.js";
import { groupQueriesByProduct } from "./diagnostic-input.js";
import type { QueryExecutionRecord } from "./diagnostic-types.js";

export const DAY_PHOTO_TIME_ZONE = "America/Sao_Paulo";

export type DayPhotoPair = {
  url: string;
  query: string;
  measured_at: string;
  job_id: string;
  probe_run_id: string | null;
  query_id: string;
  source: DiagnosticQueryRow;
};

export type DayPhotoSet = {
  job_id: string;
  probe_run_id: string | null;
  completed_at: string;
  fingerprint: string;
  pairs: Array<{ url: string; query: string }>;
};

export type DayPhotoIndex = {
  timezone: string;
  pairs: DayPhotoPair[];
  sets: DayPhotoSet[];
  pairByKey: Map<string, DayPhotoPair>;
};

export function startOfSaoPauloDayIso(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAY_PHOTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${date}T00:00:00-03:00`).toISOString();
}

export function normalizeDayPhotoQuery(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeDayPhotoUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = (parsed.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    return `https://${host}${path}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

export function dayPhotoPairKey(url: string, query: string): string {
  return `${normalizeDayPhotoUrl(url)}\t${normalizeDayPhotoQuery(query)}`;
}

export function fingerprintDayPhotoPairs(pairs: Array<{ url: string; query: string }>): string {
  return pairs
    .map((pair) => dayPhotoPairKey(pair.url, pair.query))
    .sort()
    .join("\n");
}

export function fingerprintActiveCluster(products: ProductRow[], prompts: PromptRow[]): string {
  const byProduct = groupQueriesByProduct(products, prompts);
  const pairs: Array<{ url: string; query: string }> = [];
  for (const product of products) {
    for (const prompt of byProduct.get(product.id) ?? []) {
      pairs.push({ url: product.url, query: prompt.prompt_text });
    }
  }
  return fingerprintDayPhotoPairs(pairs);
}

export function queryMeasuredAt(query: DiagnosticQueryRow): string {
  for (const execution of query.executions ?? []) {
    const measured = execution.measured_at;
    if (typeof measured === "string" && measured.trim()) return measured;
  }
  return query.created_at;
}

export function queryFromQueryId(query: DiagnosticQueryRow): string | null {
  for (const execution of query.executions ?? []) {
    const fromId = execution.from_query_id;
    if (typeof fromId === "string" && fromId.trim()) return fromId;
  }
  return null;
}

export function isDayPhotoCopy(query: { executions?: Record<string, unknown>[] }): boolean {
  return (query.executions ?? []).some(
    (execution) => typeof execution.from_query_id === "string" && execution.from_query_id.trim(),
  );
}

export function stampMeasuredAt(
  executions: QueryExecutionRecord[],
  measuredAt: string,
  fromQueryId?: string,
): QueryExecutionRecord[] {
  return executions.map((execution) => ({
    ...execution,
    measured_at: execution.measured_at ?? measuredAt,
    ...(fromQueryId ? { from_query_id: execution.from_query_id ?? fromQueryId } : {}),
  }));
}

export function copyDayPhotoQuery(input: {
  source: DiagnosticQueryRow;
  jobId: string;
  skuId: string;
  promptId: string | null;
  queryText: string;
}): Omit<DiagnosticQueryRow, "id" | "created_at"> {
  const measuredAt = queryMeasuredAt(input.source);
  const fromQueryId = queryFromQueryId(input.source) ?? input.source.id;
  const executions = stampMeasuredAt(
    (input.source.executions ?? []) as unknown as QueryExecutionRecord[],
    measuredAt,
    fromQueryId,
  );

  return {
    job_id: input.jobId,
    sku_id: input.skuId,
    prompt_id: input.promptId,
    query_text: input.queryText,
    gemini_raw: input.source.gemini_raw,
    gemini_structured: input.source.gemini_structured,
    cliente_foi_citado: input.source.cliente_foi_citado,
    concorrente_citado_nome: input.source.concorrente_citado_nome,
    concorrente_citado_url: input.source.concorrente_citado_url,
    atributos_mencionados_gemini: input.source.atributos_mencionados_gemini,
    temperatura_gemini: input.source.temperatura_gemini,
    num_execucoes: input.source.num_execucoes,
    confianca: input.source.confianca,
    executions: executions as unknown as Record<string, unknown>[],
  };
}

export function buildDayPhotoIndex(input: {
  jobs: JobRow[];
  skus: DiagnosticSkuRow[];
  queries: DiagnosticQueryRow[];
  now?: Date;
}): DayPhotoIndex {
  const since = startOfSaoPauloDayIso(input.now);
  const completedToday = input.jobs.filter(
    (job) =>
      job.status === "completed" &&
      typeof job.completed_at === "string" &&
      job.completed_at >= since,
  );
  const skusByJob = new Map<string, DiagnosticSkuRow[]>();
  for (const sku of input.skus) {
    const list = skusByJob.get(sku.job_id) ?? [];
    list.push(sku);
    skusByJob.set(sku.job_id, list);
  }
  const queriesByJob = new Map<string, DiagnosticQueryRow[]>();
  for (const query of input.queries) {
    const list = queriesByJob.get(query.job_id) ?? [];
    list.push(query);
    queriesByJob.set(query.job_id, list);
  }

  const pairByKey = new Map<string, DayPhotoPair>();
  const sets: DayPhotoSet[] = [];

  for (const job of completedToday) {
    const skus = skusByJob.get(job.id) ?? [];
    const queries = queriesByJob.get(job.id) ?? [];
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const pairs: Array<{ url: string; query: string }> = [];

    for (const query of queries) {
      const sku = skuById.get(query.sku_id);
      if (!sku) continue;
      const measuredAt = queryMeasuredAt(query);
      const pair: DayPhotoPair = {
        url: sku.url,
        query: query.query_text,
        measured_at: measuredAt,
        job_id: job.id,
        probe_run_id: job.probe_run_id,
        query_id: queryFromQueryId(query) ?? query.id,
        source: query,
      };
      pairs.push({ url: sku.url, query: query.query_text });
      const key = dayPhotoPairKey(sku.url, query.query_text);
      const existing = pairByKey.get(key);
      if (!existing || pair.measured_at < existing.measured_at) {
        pairByKey.set(key, pair);
      }
    }

    if (pairs.length === 0) continue;
    sets.push({
      job_id: job.id,
      probe_run_id: job.probe_run_id,
      completed_at: job.completed_at ?? job.created_at,
      fingerprint: fingerprintDayPhotoPairs(pairs),
      pairs,
    });
  }

  return {
    timezone: DAY_PHOTO_TIME_ZONE,
    pairs: [...pairByKey.values()],
    sets,
    pairByKey,
  };
}

export function findIdenticalDayPhotoSet(
  index: DayPhotoIndex,
  fingerprint: string,
): DayPhotoSet | null {
  if (!fingerprint.trim()) return null;
  return index.sets.find((set) => set.fingerprint === fingerprint) ?? null;
}

export function lookupDayPhotoPair(
  index: DayPhotoIndex,
  url: string,
  query: string,
): DayPhotoPair | null {
  return index.pairByKey.get(dayPhotoPairKey(url, query)) ?? null;
}

export function dayPhotoPublicPayload(index: DayPhotoIndex): {
  timezone: string;
  pairs: Array<Omit<DayPhotoPair, "source">>;
  sets: DayPhotoSet[];
} {
  return {
    timezone: index.timezone,
    pairs: index.pairs.map(({ source: _source, ...pair }) => pair),
    sets: index.sets,
  };
}

export async function loadDayPhotoIndex(
  repos: {
    jobs: { listCompletedSince(storeId: string, sinceIso: string): Promise<JobRow[]> };
    diagnosticSkus: { listByJobIds(jobIds: string[]): Promise<DiagnosticSkuRow[]> };
    diagnosticQueries: { listByJobIds(jobIds: string[]): Promise<DiagnosticQueryRow[]> };
  },
  storeId: string,
  now = new Date(),
): Promise<DayPhotoIndex> {
  const jobs = await repos.jobs.listCompletedSince(storeId, startOfSaoPauloDayIso(now));
  const jobIds = jobs.map((job) => job.id);
  const [skus, queries] = await Promise.all([
    repos.diagnosticSkus.listByJobIds(jobIds),
    repos.diagnosticQueries.listByJobIds(jobIds),
  ]);
  return buildDayPhotoIndex({ jobs, skus, queries, now });
}
