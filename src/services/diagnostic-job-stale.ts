import type { JobRow } from "../repositories/diagnostic-tables.js";
import type { JobsRepositoryLike } from "../repositories/index.js";

/** In-process queue has no lock; a tsx restart leaves rows `running` forever without this. */
export const DIAGNOSTIC_JOB_STALE_AFTER_MS = 15 * 60 * 1000;

export const DIAGNOSTIC_JOB_STALE_ERROR = "O diagnóstico parou antes de terminar. Tente de novo.";

export type JobsStaleRepo = Pick<JobsRepositoryLike, "failIfInFlight">;
export type JobsOrphanRepo = Pick<JobsRepositoryLike, "failIfInFlight" | "listInFlight">;

export function diagnosticJobAnchorMs(
  job: Pick<JobRow, "started_at" | "updated_at" | "created_at">,
): number {
  const raw = job.started_at ?? job.updated_at ?? job.created_at;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

export function isDiagnosticJobStale(
  job: Pick<JobRow, "status" | "started_at" | "updated_at" | "created_at">,
  nowMs = Date.now(),
  maxAgeMs = DIAGNOSTIC_JOB_STALE_AFTER_MS,
): boolean {
  if (job.status !== "pending" && job.status !== "running") return false;
  return nowMs - diagnosticJobAnchorMs(job) >= maxAgeMs;
}

export async function failStaleDiagnosticJob(
  repos: JobsStaleRepo,
  job: JobRow,
  now = new Date(),
): Promise<JobRow> {
  if (!isDiagnosticJobStale(job, now.getTime())) return job;
  return repos.failIfInFlight(job.id, {
    completed_at: now.toISOString(),
    error_message: DIAGNOSTIC_JOB_STALE_ERROR,
  });
}

export async function failStaleDiagnosticJobs(
  repos: JobsStaleRepo,
  jobs: JobRow[],
  now = new Date(),
): Promise<JobRow[]> {
  return Promise.all(jobs.map((job) => failStaleDiagnosticJob(repos, job, now)));
}

/** Previous in-process process is gone — fail every in-flight row on boot, regardless of age. */
export async function failOrphanInFlightJobs(
  repos: JobsOrphanRepo,
  now = new Date(),
): Promise<JobRow[]> {
  const jobs = await repos.listInFlight();
  const completedAt = now.toISOString();
  return Promise.all(
    jobs.map((job) =>
      repos.failIfInFlight(job.id, {
        completed_at: completedAt,
        error_message: DIAGNOSTIC_JOB_STALE_ERROR,
      }),
    ),
  );
}
