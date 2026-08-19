import { describe, expect, it } from "vitest";

import type { JobRow } from "../src/repositories/diagnostic-tables.js";
import {
  DIAGNOSTIC_JOB_STALE_AFTER_MS,
  DIAGNOSTIC_JOB_STALE_ERROR,
  failOrphanInFlightJobs,
  failStaleDiagnosticJob,
  isDiagnosticJobStale,
} from "../src/services/diagnostic-job-stale.js";

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    store_id: "store-1",
    probe_run_id: null,
    status: "running",
    plan: "essential",
    webhook_url: null,
    config_snapshot: {},
    error_message: null,
    created_at: "2026-08-19T11:29:20.000Z",
    updated_at: "2026-08-19T11:29:22.000Z",
    started_at: "2026-08-19T11:29:20.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("isDiagnosticJobStale", () => {
  const started = Date.parse("2026-08-19T11:29:20.000Z");

  it("keeps a running job inside the wall-clock budget", () => {
    expect(isDiagnosticJobStale(job(), started + 5 * 60_000)).toBe(false);
  });

  it("flags a running job after 15 minutes", () => {
    expect(isDiagnosticJobStale(job(), started + DIAGNOSTIC_JOB_STALE_AFTER_MS)).toBe(true);
  });

  it("ignores completed and failed jobs", () => {
    expect(isDiagnosticJobStale(job({ status: "completed" }), started + 60 * 60_000)).toBe(false);
    expect(isDiagnosticJobStale(job({ status: "failed" }), started + 60 * 60_000)).toBe(false);
  });

  it("uses created_at when a pending job never started", () => {
    const pending = job({
      status: "pending",
      started_at: null,
      updated_at: "2026-08-19T11:29:20.000Z",
    });
    expect(isDiagnosticJobStale(pending, started + DIAGNOSTIC_JOB_STALE_AFTER_MS)).toBe(true);
  });
});

describe("failStaleDiagnosticJob", () => {
  it("marks a stale running job failed", async () => {
    const stale = job();
    const updated = job({
      status: "failed",
      completed_at: "2026-08-19T16:18:04.000Z",
      error_message: DIAGNOSTIC_JOB_STALE_ERROR,
    });
    const repos = {
      async failIfInFlight() {
        return updated;
      },
    };
    const result = await failStaleDiagnosticJob(repos, stale, new Date("2026-08-19T16:18:04.000Z"));
    expect(result.status).toBe("failed");
    expect(result.error_message).toBe(DIAGNOSTIC_JOB_STALE_ERROR);
  });

  it("does not clobber a job that left in-flight after the stale check", async () => {
    const stale = job();
    const completed = job({ status: "completed", completed_at: "2026-08-19T11:44:00.000Z" });
    const result = await failStaleDiagnosticJob(
      { failIfInFlight: async () => completed },
      stale,
      new Date("2026-08-19T16:18:04.000Z"),
    );
    expect(result.status).toBe("completed");
  });

  it("leaves a fresh job unchanged", async () => {
    const fresh = job({
      created_at: "2026-08-19T16:10:00.000Z",
      updated_at: "2026-08-19T16:10:00.000Z",
      started_at: "2026-08-19T16:10:00.000Z",
    });
    const result = await failStaleDiagnosticJob(
      { failIfInFlight: async () => fresh },
      fresh,
      new Date("2026-08-19T16:12:00.000Z"),
    );
    expect(result).toBe(fresh);
  });
});

describe("failOrphanInFlightJobs", () => {
  it("fails every in-flight row on in-process boot", async () => {
    const orphan = job({ id: "orphan", status: "pending", started_at: null });
    const failed: JobRow[] = [];
    const repos = {
      async listInFlight() {
        return [orphan];
      },
      async failIfInFlight(id: string, fields: { error_message?: string }) {
        const row = {
          ...orphan,
          id,
          status: "failed" as const,
          error_message: fields.error_message ?? null,
        };
        failed.push(row);
        return row;
      },
    };
    await failOrphanInFlightJobs(repos, new Date("2026-08-19T16:18:04.000Z"));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.status).toBe("failed");
    expect(failed[0]?.error_message).toBe(DIAGNOSTIC_JOB_STALE_ERROR);
  });
});
