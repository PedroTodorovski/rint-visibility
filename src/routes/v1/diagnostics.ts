import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { notFound } from "../../lib/errors.js";
import { requireWorkspaceId } from "../../lib/request.js";
import type { IntegrationRegistryConfig } from "../../ports/types.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import {
  dayPhotoPublicPayload,
  findIdenticalDayPhotoSet,
  fingerprintActiveCluster,
  loadDayPhotoIndex,
} from "../../services/day-photo.js";
import {
  failStaleDiagnosticJob,
  failStaleDiagnosticJobs,
} from "../../services/diagnostic-job-stale.js";
import {
  providersFromIntegrationConfig,
  summarizeDiagnosticJobs,
} from "../../services/diagnostic-job-summary.js";
import type { DiagnosticQueue } from "../../services/diagnostic-queue.js";
import { normalizeDiagnosticPlan } from "../../services/diagnostic-types.js";

function parseRunBody(body: unknown): {
  plan: ReturnType<typeof normalizeDiagnosticPlan>;
  webhookUrl: string | null;
  integrationConfig: IntegrationRegistryConfig | undefined;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const webhookUrl =
    typeof record.webhook_url === "string" && record.webhook_url.trim()
      ? record.webhook_url.trim()
      : null;

  return {
    plan: normalizeDiagnosticPlan(record.plan),
    webhookUrl,
    integrationConfig:
      record.integration_config && typeof record.integration_config === "object"
        ? (record.integration_config as IntegrationRegistryConfig)
        : undefined,
  };
}

async function diagnosticPayload(repos: VisibilityRepositories, jobId: string) {
  const [job, skus, queries, triage, financialRisk, diagnostic] = await Promise.all([
    repos.jobs.findById(jobId),
    repos.diagnosticSkus.listByJobId(jobId),
    repos.diagnosticQueries.listByJobId(jobId),
    repos.triageResults.findByJobId(jobId),
    repos.financialRisk.listByJobId(jobId),
    repos.diagnostics.findByJobId(jobId),
  ]);

  if (!job) {
    throw notFound(`Job ${jobId} not found`);
  }

  return {
    job,
    skus,
    queries,
    triage_result: triage,
    financial_risk: financialRisk,
    diagnostic,
  };
}

export async function registerDiagnosticsRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
  config: AppConfig,
  queue: DiagnosticQueue,
): Promise<void> {
  app.post("/diagnostics/run", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const body = parseRunBody(request.body);

    const products = await repos.products.listByStoreId(store.id);
    const prompts = await repos.prompts.listByStoreId(store.id);
    const fingerprint = fingerprintActiveCluster(products, prompts);
    const dayPhotos = await loadDayPhotoIndex(repos, store.id);
    const identical = findIdenticalDayPhotoSet(dayPhotos, fingerprint);
    if (identical) {
      return reply.code(200).send({
        job_id: identical.job_id,
        probe_run_id: identical.probe_run_id,
        status: "completed",
        reused: true,
        status_url: `/v1/jobs/${identical.job_id}?workspace_id=${encodeURIComponent(workspaceId)}`,
        result_url: `/v1/diagnostics/${identical.job_id}?workspace_id=${encodeURIComponent(workspaceId)}`,
      });
    }

    const probeRun = await repos.probeRuns.create(store.id, new Date().toISOString().slice(0, 10));
    const job = await repos.jobs.create({
      store_id: store.id,
      probe_run_id: probeRun.id,
      plan: body.plan,
      webhook_url: body.webhookUrl,
      config_snapshot: {
        plan: body.plan,
        has_integration_config: Boolean(body.integrationConfig),
        providers: providersFromIntegrationConfig(body.integrationConfig),
        max_skus: config.diagnosticMaxSkus,
        max_queries_per_sku: config.diagnosticMaxQueriesPerSku,
      },
    });

    await queue.enqueue({
      jobId: job.id,
      workspaceId,
      plan: body.plan,
      integrationConfig: body.integrationConfig,
    });

    return reply.code(202).send({
      job_id: job.id,
      probe_run_id: probeRun.id,
      status: job.status,
      reused: false,
      status_url: `/v1/jobs/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
      result_url: `/v1/diagnostics/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
    });
  });

  app.get("/diagnostics/day-photos", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const index = await loadDayPhotoIndex(repos, store.id);
    return reply.code(200).send(dayPhotoPublicPayload(index));
  });

  app.get("/jobs", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const query = request.query as { page?: string; limit?: string };
    const requestedPage = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit ?? "20", 10) || 20));
    const total = await repos.jobs.countByStoreId(store.id);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, requestedPage);
    const listed = await repos.jobs.listByStoreId(store.id, {
      limit,
      offset: (page - 1) * limit,
    });
    const jobs = await failStaleDiagnosticJobs(repos.jobs, listed);
    const jobIds = jobs.map((job) => job.id);
    const [skus, queries, diagnostics] = await Promise.all([
      repos.diagnosticSkus.listByJobIds(jobIds),
      repos.diagnosticQueries.listByJobIds(jobIds),
      repos.diagnostics.listByJobIds(jobIds),
    ]);

    return reply.code(200).send({
      jobs: summarizeDiagnosticJobs(jobs, skus, queries, diagnostics),
      page,
      limit,
      total,
    });
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const { jobId } = request.params as { jobId: string };
    const found = await repos.jobs.findByIdForStore(store.id, jobId);

    if (!found) {
      throw notFound(`Job ${jobId} not found`);
    }

    const job = await failStaleDiagnosticJob(repos.jobs, found);
    return reply.code(200).send({ job });
  });

  app.get("/diagnostics/:jobId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const { jobId } = request.params as { jobId: string };
    const found = await repos.jobs.findByIdForStore(store.id, jobId);
    if (!found) throw notFound(`Job ${jobId} not found`);
    await failStaleDiagnosticJob(repos.jobs, found);

    const payload = await diagnosticPayload(repos, jobId);
    return reply.code(200).send(payload);
  });

  // ── Admin X-ray — cross-tenant, no workspace_id scoping ──────────────────
  // Access control lives entirely in rint-app (super_admin gate on /admin/*).
  // The engine trusts whoever holds the shared bearer key, same as every
  // other route here — these two just skip the store-ownership filter.

  app.get("/admin/diagnostics", async (request, reply) => {
    const query = request.query as { page?: string; limit?: string };
    const requestedPage = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit ?? "20", 10) || 20));
    // Fetch by the requested page directly rather than clamping the offset to a
    // count fetched first — count and list have no data dependency on each other,
    // so they can run concurrently. A page past the end just comes back empty.
    const [total, jobs] = await Promise.all([
      repos.jobs.countAll(),
      repos.jobs.listAll({ limit, offset: (requestedPage - 1) * limit }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = requestedPage;
    const jobIds = jobs.map((job) => job.id);
    const storeIds = [...new Set(jobs.map((job) => job.store_id))];
    const [skus, queries, diagnostics, stores] = await Promise.all([
      repos.diagnosticSkus.listByJobIds(jobIds),
      repos.diagnosticQueries.listByJobIds(jobIds),
      repos.diagnostics.listByJobIds(jobIds),
      repos.stores.listByIds(storeIds),
    ]);
    const storeById = new Map(stores.map((store) => [store.id, store]));
    // summarizeDiagnosticJobs derives each summary from jobs via a single .map(),
    // so summaries[i] always corresponds to jobs[i] — no per-row lookup needed.
    const summaries = summarizeDiagnosticJobs(jobs, skus, queries, diagnostics);

    return reply.code(200).send({
      jobs: summaries.map((summary, index) => {
        const job = jobs[index];
        const store = job ? storeById.get(job.store_id) : undefined;
        return {
          ...summary,
          store_id: job?.store_id ?? null,
          store_name: store?.name ?? null,
          store_domain: store?.domain ?? null,
          workspace_id: store?.workspace_id ?? null,
        };
      }),
      page,
      limit,
      total,
    });
  });

  app.get("/admin/diagnostics/:jobId", async (request, reply) => {
    // Read-only audit screen — unlike the tenant-facing route, this one must not
    // mutate job status as a side effect of being viewed (failStaleDiagnosticJob
    // writes "failed" for a stale-looking job, which could race a worker that's
    // still legitimately processing it).
    const { jobId } = request.params as { jobId: string };
    const job = await repos.jobs.findById(jobId);
    if (!job) throw notFound(`Job ${jobId} not found`);

    const [payload, store] = await Promise.all([
      diagnosticPayload(repos, jobId),
      repos.stores.findById(job.store_id),
    ]);

    return reply.code(200).send({
      ...payload,
      store: store
        ? { id: store.id, name: store.name, domain: store.domain, workspace_id: store.workspace_id }
        : null,
    });
  });

  app.get("/diagnostics/latest", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const probeRunId = (request.query as { probe_run_id?: string }).probe_run_id?.trim() || "";

    const latestJob = probeRunId
      ? await repos.jobs.findByProbeRunId(store.id, probeRunId)
      : await repos.jobs.findLatestByStoreId(store.id);
    if (latestJob) {
      await failStaleDiagnosticJob(repos.jobs, latestJob);
      const payload = await diagnosticPayload(repos, latestJob.id);
      return reply.code(200).send(payload);
    }

    const lacuna = probeRunId
      ? await repos.lacunaSnapshots.findByProbeRunId(probeRunId)
      : await repos.lacunaSnapshots.findLatestByStoreId(store.id);
    if (!lacuna) {
      return reply.code(404).send({ error: "No diagnostic snapshot found", code: "NOT_FOUND" });
    }

    const dualTracks = await repos.dualTrackOutputs.listByProbeRunId(lacuna.probe_run_id);

    const track1 = dualTracks.filter((t) => t.track_number === 1);
    const track2 = dualTracks.filter((t) => t.track_number === 2);
    const triageOwner = dualTracks[0]?.triage_owner ?? "narrative";

    return reply.code(200).send({
      lacuna: {
        id: lacuna.id,
        probe_run_id: lacuna.probe_run_id,
        lacuna_rs: Number(lacuna.lacuna_rs),
        clientes_perdidos: Number(lacuna.clientes_perdidos),
        custo_compensar: Number(lacuna.custo_compensar),
        assumptions: lacuna.assumptions,
        flags: lacuna.flags,
        created_at: lacuna.created_at,
      },
      dual_track: {
        triage_owner: triageOwner,
        track1: track1.map((t) => ({ sku_ref_id: t.sku_ref_id, items: t.items })),
        track2: track2.map((t) => ({ sku_ref_id: t.sku_ref_id, items: t.items })),
      },
    });
  });
}
