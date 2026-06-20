import { describe, expect, it } from "vitest";

import { computeRevenueGap } from "../src/services/revenue-gap-engine.js";

describe("computeRevenueGap", () => {
  it("computes Inflow example — Conta 1 and Conta 2 separate", () => {
    const result = computeRevenueGap({
      receitaAiMedida: 4500,
      citationClient: 2,
      citationTotal: 10,
      citationCompetitor: 5,
      ticketMedio: 450,
      cacSku: 135,
    });

    expect(result.lacunaRs).toBeCloseTo(6750, 0);
    expect(result.clientesPerdidos).toBeCloseTo(15, 0);
    expect(result.custoCompensar).toBeCloseTo(2025, 0);
    expect(result.flags.citationClientZero).toBe(false);
  });

  it("handles citation_client zero with flag", () => {
    const result = computeRevenueGap({
      receitaAiMedida: 4500,
      citationClient: 0,
      citationTotal: 10,
      citationCompetitor: 5,
      ticketMedio: 450,
      cacSku: 135,
    });

    expect(result.flags.citationClientZero).toBe(true);
    expect(result.lacunaRs).toBeCloseTo(2250, 0);
  });

  it("never merges Conta 1 and Conta 2 into one figure in snapshot", () => {
    const result = computeRevenueGap({
      receitaAiMedida: 1000,
      citationClient: 1,
      citationTotal: 5,
      citationCompetitor: 3,
      ticketMedio: 100,
      cacSku: 50,
    });

    expect(result.lacunaRs).not.toBe(result.custoCompensar);
    expect(result.lacunaRs).toBeGreaterThan(0);
    expect(result.custoCompensar).toBeGreaterThan(0);
  });
});
