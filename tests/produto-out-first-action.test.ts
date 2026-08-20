import { describe, expect, it } from "vitest";

import { formulateTrackProdutoFirstAction } from "../src/services/produto-out-first-action.js";

describe("formulateTrackProdutoFirstAction", () => {
  it("locks Daily Boost clear gold: composition, accept the gap, never the AG1 slogan", () => {
    const brief = formulateTrackProdutoFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
      confidence: "clear",
      crownedName: "Athletic Greens AG1",
      crownedSeller: "Athletic Greens",
      storeHint: null,
      priceClient: "R$ 348",
      priceCrowned: "US$ 99",
      useAttrs: ["59 vitaminas, minerais, bioativos e vegetais", "2 scoops (10 g) ao dia"],
      skipAttrs: ["Certificação NSF"],
      followupReason: null,
      losingDimension: "composicao",
      move: "aceitar_gap",
    });

    expect(brief.move).toBe("aceitar_gap");
    expect(brief.losing_dimension).toBe("composicao");
    expect(brief.first_action).not.toMatch(/A IA recomenda Athletic Greens AG1 no lugar do/);
    expect(brief.first_action).toMatch(/Não foi o preço nem o prazo/);
    expect(brief.first_action).toMatch(/fórmula \(Certificação NSF\)/);
    expect(brief.first_action).toContain("não mude o Nuture Daily Boost");
    expect(brief.first_action).not.toMatch(/elegeu|aceite o gap|página do produto/);
    expect(brief.support_line).toMatch(/fórmula/);
    expect(brief.skip_attrs).toEqual(["Certificação NSF"]);
  });

  it("does not lecture formula when the offer is still empty", () => {
    const brief = formulateTrackProdutoFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
      confidence: "empty",
      crownedName: null,
      crownedSeller: null,
      storeHint: null,
      priceClient: "R$ 348",
      priceCrowned: null,
      useAttrs: ["59 vitaminas"],
      skipAttrs: ["Certificação NSF", "garantia 60 dias"],
      followupReason: null,
    });

    expect(brief.move).toBe("esperar_followup");
    expect(brief.first_action).not.toMatch(/Não foi o preço nem o prazo/);
    expect(brief.skip_attrs).toEqual([]);
  });

  it("names NSF as the formula fact, not a warranty sitting first in skip", () => {
    const brief = formulateTrackProdutoFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
      confidence: "clear",
      crownedName: "Athletic Greens AG1",
      crownedSeller: "Athletic Greens",
      storeHint: null,
      priceClient: "R$ 348",
      priceCrowned: "US$ 99",
      useAttrs: ["59 vitaminas"],
      skipAttrs: ["garantia 60 dias", "Certificação NSF", "1 scoop por dia"],
      followupReason: null,
      losingDimension: "composicao",
      move: "aceitar_gap",
    });

    expect(brief.first_action).toMatch(/fórmula \(Certificação NSF\)/);
    expect(brief.first_action).not.toMatch(/fórmula \(garantia/);
    expect(brief.skip_attrs).toEqual(["Certificação NSF"]);
  });

  it("names preço and prazo in the phrase when prazo is extra weight", () => {
    const brief = formulateTrackProdutoFirstAction({
      skuName: "Runner Pro",
      brand: "Marca",
      productUrl: "https://loja.com/products/runner-pro",
      confidence: "clear",
      crownedName: "Nike Pegasus",
      crownedSeller: "Nike",
      storeHint: null,
      priceClient: "R$ 899",
      priceCrowned: "R$ 649",
      useAttrs: ["palmilha"],
      skipAttrs: ["placa de carbono"],
      followupReason: null,
      losingDimension: "preco",
      move: "mudar_preco",
      contributions: [
        { dimension: "preco", role: "primary" },
        { dimension: "prazo", role: "extra" },
      ],
    });

    expect(brief.first_action).toMatch(/Não foi só a fórmula/);
    expect(brief.first_action).toContain("R$ 899 vs R$ 649");
    expect(brief.first_action).toMatch(/prazo também perdeu/);
    expect(brief.first_action).toContain("ajuste o preço no Shopify");
  });

  it("does not lecture formula when the judge found no comparable loss", () => {
    const brief = formulateTrackProdutoFirstAction({
      skuName: "Nuture Daily Boost",
      brand: "Nuture",
      productUrl: "https://nuture.com.br/products/nuture-daily-boost",
      confidence: "clear",
      crownedName: "Athletic Greens AG1",
      crownedSeller: "Athletic Greens",
      storeHint: null,
      priceClient: "R$ 348",
      priceCrowned: "US$ 99",
      useAttrs: ["59 vitaminas"],
      skipAttrs: [],
      followupReason: null,
      losingDimension: null,
      move: "aceitar_gap",
    });

    expect(brief.losing_dimension).toBeNull();
    expect(brief.first_action).toContain("não deu para apontar preço, prova nem fórmula");
    expect(brief.first_action).not.toMatch(/pela fórmula/);
  });
});
