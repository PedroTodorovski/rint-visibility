import type { FastifyInstance } from "fastify";

import { requireWorkspaceId } from "../../lib/request.js";
import type { VisibilityRepositories } from "../../repositories/index.js";

export async function registerDiagnosticsRoutes(
  app: FastifyInstance,
  repos: VisibilityRepositories,
): Promise<void> {
  app.get("/diagnostics/latest", async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const store = await repos.stores.requireByWorkspaceId(workspaceId);

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
