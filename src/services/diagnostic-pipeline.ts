import { createIntegrationPorts } from "../ports/mock-adapters.js";
import { DEFAULT_PORT_TTL_MS, readThroughCache } from "../ports/read-through-cache.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import type { ProductRow, StoreRow } from "../repositories/types.js";
import { generateDualTracks } from "./dual-track-generator.js";
import {
  aggregateCitationCounts,
  computeRevenueGap,
} from "./revenue-gap-engine.js";

export type DiagnosticPipelineInput = {
  store: StoreRow;
  products: ProductRow[];
  probeRunId: string;
  results: Array<{
    cited: boolean;
    metadata: Record<string, unknown>;
  }>;
  promptCount: number;
  integrationConfig?: Parameters<typeof createIntegrationPorts>[0];
};

export type DiagnosticPipelineOutcome = {
  lacunaSnapshotId: string;
  triageOwner: "narrative" | "product_pricing";
};

export async function runDiagnosticPipeline(
  repos: VisibilityRepositories,
  input: DiagnosticPipelineInput,
): Promise<DiagnosticPipelineOutcome> {
  const { ports, window } = createIntegrationPorts(input.integrationConfig ?? {});
  const cache = repos.perRunReadCache;

  const primaryRef = input.products[0]?.external_ref ?? input.products[0]?.id ?? "hero-1";
  const cacheKeyBase = `${window.start}:${window.end}`;

  const [ga4Read, shopifyRead, metaRead] = await Promise.all([
    readThroughCache(cache, input.probeRunId, "ga4", `ai-referral:${cacheKeyBase}`, DEFAULT_PORT_TTL_MS, () =>
      ports.ga4.getAiReferralRevenue(window),
    ),
    readThroughCache(
      cache,
      input.probeRunId,
      "shopify",
      `revenue:${primaryRef}:${cacheKeyBase}`,
      DEFAULT_PORT_TTL_MS,
      () => ports.shopify.getSkuRevenue(primaryRef, window),
    ),
    readThroughCache(
      cache,
      input.probeRunId,
      "meta",
      `cac:${primaryRef}:${cacheKeyBase}`,
      DEFAULT_PORT_TTL_MS,
      () => ports.meta.getSkuCac(primaryRef, window),
    ),
  ]);

  const citations = aggregateCitationCounts(input.results, input.promptCount);

  const assumptions = {
    receitaAiMedida: ga4Read.data.totalRevenue,
    citationClient: citations.citationClient,
    citationCompetitor: citations.citationCompetitor,
    citationTotal: citations.citationTotal,
    ticketMedio: shopifyRead.data.ticketMedio,
    cacSku: metaRead.data.cac,
    window,
    origins: {
      receitaAiMedida: ga4Read.data.meta,
      ticketMedio: shopifyRead.data.meta,
      cacSku: metaRead.data.meta,
    },
  };

  const gap = computeRevenueGap(assumptions);

  const lacuna = await repos.lacunaSnapshots.create({
    probe_run_id: input.probeRunId,
    store_id: input.store.id,
    lacuna_rs: gap.lacunaRs,
    clientes_perdidos: gap.clientesPerdidos,
    custo_compensar: gap.custoCompensar,
    assumptions: gap.assumptions,
    flags: gap.flags,
  });

  const dualTrack = generateDualTracks(input.products, gap, input.results);

  const trackRows = dualTrack.tracks.flatMap((sku) => [
    {
      probe_run_id: input.probeRunId,
      sku_ref_id: sku.skuRefId,
      track_number: 1 as const,
      items: sku.track1,
      triage_owner: sku.triageOwner,
    },
    {
      probe_run_id: input.probeRunId,
      sku_ref_id: sku.skuRefId,
      track_number: 2 as const,
      items: sku.track2,
      triage_owner: sku.triageOwner,
    },
  ]);

  await repos.dualTrackOutputs.createMany(trackRows);

  return {
    lacunaSnapshotId: lacuna.id,
    triageOwner: dualTrack.triageOwner,
  };
}
