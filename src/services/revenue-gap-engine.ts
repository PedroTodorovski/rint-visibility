export type RevenueGapAssumptions = {
  receitaAiMedida: number;
  citationClient: number;
  citationTotal: number;
  citationCompetitor: number;
  ticketMedio: number;
  cacSku: number;
  window?: { start: string; end: string };
  origins?: Record<string, { source: string; fetchedAt: string }>;
};

export type RevenueGapFlags = {
  citationClientZero: boolean;
};

export type RevenueGapSnapshot = {
  lacunaRs: number;
  clientesPerdidos: number;
  custoCompensar: number;
  flags: RevenueGapFlags;
  assumptions: RevenueGapAssumptions;
};

export function computeRevenueGap(assumptions: RevenueGapAssumptions): RevenueGapSnapshot {
  const {
    receitaAiMedida,
    citationClient,
    citationCompetitor,
    citationTotal,
    ticketMedio,
    cacSku,
  } = assumptions;

  let lacunaRs: number;
  let citationClientZero = false;

  if (citationClient <= 0) {
    citationClientZero = true;
    const denom = Math.max(citationTotal, 1);
    lacunaRs = receitaAiMedida * (citationCompetitor / denom);
  } else {
    lacunaRs = receitaAiMedida * (citationCompetitor / citationClient - 1);
  }

  lacunaRs = Math.max(0, lacunaRs);
  const clientesPerdidos = ticketMedio > 0 ? lacunaRs / ticketMedio : 0;
  const custoCompensar = clientesPerdidos * cacSku;

  return {
    lacunaRs,
    clientesPerdidos,
    custoCompensar,
    flags: { citationClientZero },
    assumptions,
  };
}

export function aggregateCitationCounts(
  results: Array<{ cited: boolean; metadata?: Record<string, unknown> }>,
  promptCount: number,
): { citationClient: number; citationCompetitor: number; citationTotal: number } {
  const citationTotal = promptCount;
  const citationClient = results.filter((r) => r.cited).length;

  const competitorPrompts = results.filter((r) => {
    if (r.cited) return false;
    const competitors = r.metadata?.competitors;
    return Array.isArray(competitors) && competitors.length > 0;
  }).length;

  return { citationClient, citationCompetitor: competitorPrompts, citationTotal };
}
