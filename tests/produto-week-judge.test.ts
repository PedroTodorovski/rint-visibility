import { describe, expect, it } from "vitest";

import { judgeProductWeek } from "../src/services/produto-week-judge.js";

const nuture = {
  confidence: "clear" as const,
  followupReason: null,
  priceClient: { amount: 348, currency: "BRL", label: "R$ 348" },
  priceCrowned: { amount: 99, currency: "USD", label: "US$ 99" },
  clientDose: "2 scoops (10 g) ao dia",
  crownedDose: "1 scoop / pouch",
  ratingClient: "4,6 / +25.000 clientes",
  ratingCrowned: "4,8",
  shippingClient: "Frete grátis",
  shippingCrowned: "5 a 8 dias",
  skipAttrs: ["Certificação NSF"],
  useAttrs: ["59 vitaminas, minerais, bioativos e vegetais", "2 scoops (10 g) ao dia"],
  clientDimensions: "2 scoops (10 g) ao dia",
  crownedDimensions: "1 scoop / pouch",
  clientQuality: "Anvisa notificado",
  crownedQuality: "Certificação NSF",
};

describe("judgeProductWeek", () => {
  it("abstains on wait chips instead of mixing invented losses", () => {
    expect(
      judgeProductWeek({
        ...nuture,
        confidence: "empty",
        skipAttrs: ["Certificação NSF"],
      }).abstainReason,
    ).toBe("empty");
    expect(
      judgeProductWeek({
        ...nuture,
        confidence: "store_only",
        followupReason: "missing_product",
      }).abstainReason,
    ).toBe("missing_product");
    expect(
      judgeProductWeek({
        ...nuture,
        followupReason: "missing_seller",
      }).abstainReason,
    ).toBe("missing_seller");
    expect(
      judgeProductWeek({
        ...nuture,
        followupReason: "missing_facts",
      }).abstainReason,
    ).toBe("missing_facts");
    expect(judgeProductWeek({ ...nuture, confidence: "split" }).abstainReason).toBe("split");
  });

  it("locks Nuture Daily Boost vs AG1 on formula: price is not comparable, 4.6 vs 4.8 does not win", () => {
    const judgment = judgeProductWeek(nuture);
    expect(judgment.abstainReason).toBeNull();
    expect(judgment.primaryDimension).toBe("composicao");
    expect(judgment.move).toBe("aceitar_gap");
    expect(judgment.contributions).toEqual([{ dimension: "composicao", role: "primary" }]);
    expect(judgment.contributions.some((row) => row.dimension === "preco")).toBe(false);
    expect(judgment.contributions.some((row) => row.dimension === "avaliacao")).toBe(false);
  });

  it("picks price for the same tennis model in BRL even when carbon sits in skip", () => {
    const judgment = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 899, currency: "BRL", label: "R$ 899" },
      priceCrowned: { amount: 649, currency: "BRL", label: "R$ 649" },
      ratingClient: "4,7",
      ratingCrowned: "4,8",
      shippingClient: null,
      shippingCrowned: null,
      skipAttrs: ["placa de carbono"],
      useAttrs: ["palmilha"],
      clientDimensions: "par",
      crownedDimensions: "par",
    });
    expect(judgment.primaryDimension).toBe("preco");
    expect(judgment.move).toBe("mudar_preco");
    expect(judgment.contributions[0]).toEqual({ dimension: "preco", role: "primary" });
    expect(judgment.contributions.some((row) => row.dimension === "prazo")).toBe(false);
  });

  it("keeps vegan as the D3K2 week when the BRL gap is small", () => {
    const judgment = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 168, currency: "BRL", label: "R$ 168" },
      priceCrowned: { amount: 147, currency: "BRL", label: "R$ 147" },
      ratingClient: "4,9 / +25.000 clientes",
      ratingCrowned: "4,7",
      shippingClient: "Frete grátis",
      shippingCrowned: "3 a 5 dias",
      skipAttrs: ["Selo vegan"],
    });
    expect(judgment.primaryDimension).toBe("composicao");
    expect(judgment.move).toBe("aceitar_gap");
  });

  it("keeps price as the step and prazo as extra weight when both lost", () => {
    const judgment = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 899, currency: "BRL", label: "R$ 899" },
      priceCrowned: { amount: 649, currency: "BRL", label: "R$ 649" },
      ratingClient: null,
      ratingCrowned: null,
      shippingClient: "8 a 12 dias",
      shippingCrowned: "2 a 4 dias",
      skipAttrs: ["placa de carbono"],
    });
    expect(judgment.move).toBe("mudar_preco");
    expect(judgment.primaryDimension).toBe("preco");
    expect(judgment.contributions).toEqual([
      { dimension: "preco", role: "primary" },
      { dimension: "prazo", role: "extra" },
    ]);
  });

  it("does not treat NSF vs Anvisa as pack, and does not lecture vitamins as formula", () => {
    const seals = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 89, currency: "BRL", label: "R$ 89" },
      priceCrowned: { amount: 89, currency: "BRL", label: "R$ 89" },
      ratingClient: "4,6",
      ratingCrowned: "4,6",
      shippingClient: null,
      shippingCrowned: null,
      skipAttrs: [],
      clientQuality: "Anvisa notificado",
      crownedQuality: "Certificação NSF",
    });
    expect(seals.primaryDimension).toBeNull();
    expect(seals.abstainReason).toBe("no_comparable_loss");

    const vitamins = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 348, currency: "BRL", label: "R$ 348" },
      priceCrowned: { amount: 99, currency: "USD", label: "US$ 99" },
      ratingClient: "4,6",
      ratingCrowned: "4,8",
      shippingClient: null,
      shippingCrowned: null,
      skipAttrs: ["75 vitaminas e minerais"],
    });
    expect(vitamins.contributions.some((row) => row.dimension === "composicao")).toBe(false);
  });

  it("does not count hours as a prazo extra", () => {
    const judgment = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 899, currency: "BRL", label: "R$ 899" },
      priceCrowned: { amount: 649, currency: "BRL", label: "R$ 649" },
      ratingClient: null,
      ratingCrowned: null,
      shippingClient: "24 horas",
      shippingCrowned: "2 a 4 dias",
      skipAttrs: ["placa de carbono"],
    });
    expect(judgment.primaryDimension).toBe("preco");
    expect(judgment.contributions.some((row) => row.dimension === "prazo")).toBe(false);
  });

  it("picks rating for serum when tickets are similar and the note is much worse", () => {
    const judgment = judgeProductWeek({
      confidence: "clear",
      followupReason: null,
      priceClient: { amount: 89, currency: "BRL", label: "R$ 89" },
      priceCrowned: { amount: 89, currency: "BRL", label: "R$ 89" },
      ratingClient: "3,9",
      ratingCrowned: "4,8",
      shippingClient: null,
      shippingCrowned: null,
      skipAttrs: ["estudo de 12 semanas"],
    });
    expect(judgment.primaryDimension).toBe("avaliacao");
    expect(judgment.move).toBe("aceitar_gap");
    expect(judgment.contributions).toEqual([{ dimension: "avaliacao", role: "primary" }]);
  });
});
