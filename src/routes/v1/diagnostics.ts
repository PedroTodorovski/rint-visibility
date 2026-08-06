import type { FastifyInstance } from "fastify";

import { requireWorkspaceId } from "../../lib/request.js";
import { notFound } from "../../lib/errors.js";
import type { AppConfig } from "../../config.js";
import type { VisibilityRepositories } from "../../repositories/index.js";
import type { DiagnosticQueue } from "../../services/diagnostic-queue.js";
import { normalizeDiagnosticPlan } from "../../services/diagnostic-types.js";
import type { IntegrationRegistryConfig } from "../../ports/types.js";

function parseRunBody(body: unknown): {
  plan: ReturnType<typeof normalizeDiagnosticPlan>;
  webhookUrl: string | null;
  integrationConfig: IntegrationRegistryConfig | undefined;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const webhookUrl = typeof record.webhook_url === "string" && record.webhook_url.trim()
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

    const probeRun = await repos.probeRuns.create(store.id, new Date().toISOString().slice(0, 10));
    const job = await repos.jobs.create({
      store_id: store.id,
      probe_run_id: probeRun.id,
      plan: body.plan,
      webhook_url: body.webhookUrl,
      config_snapshot: {
        plan: body.plan,
        has_integration_config: Boolean(body.integrationConfig),
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
      status_url: `/v1/jobs/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
      result_url: `/v1/diagnostics/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
    });
  });

  app.get("/jobs/:jobId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const { jobId } = request.params as { jobId: string };
    const job = await repos.jobs.findByIdForStore(store.id, jobId);

    if (!job) {
      throw notFound(`Job ${jobId} not found`);
    }

    return reply.code(200).send({ job });
  });

  app.get("/diagnostics/:jobId", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);
    const { jobId } = request.params as { jobId: string };
    const job = await repos.jobs.findByIdForStore(store.id, jobId);
    if (!job) throw notFound(`Job ${jobId} not found`);

    const payload = await diagnosticPayload(repos, jobId);
    return reply.code(200).send(payload);
  });

  app.get("/diagnostics/latest", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);

    const latestJob = await repos.jobs.findLatestByStoreId(store.id);
    if (latestJob) {
      const payload = await diagnosticPayload(repos, latestJob.id);
      return reply.code(200).send(payload);
    }

    const lacuna = await repos.lacunaSnapshots.findLatestByStoreId(store.id);
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
