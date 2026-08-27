import { describe, expect, it } from "vitest";

import {
  checkoutHostFitsSeller,
  compactIdentity,
  crownCompetitorSku,
  formatCitedOfferLabel,
  groundingHostsFromUrls,
  isClientCitedObject,
  isClientProductElsewhereObject,
  isClientStorefrontObject,
  isLikelyProductUrl,
  lostOccupantSpeech,
  mergeFollowUpCitedObjects,
  occupantsFromLostQueries,
  planCitedFaceFollowUp,
  planCitedOfferFollowUp,
  productIdentityKey,
  sellerFromObject,
  vsRivalPaintKeys,
  vsRivalProductKeys,
} from "../src/lib/cited-offer.js";

const client = {
  name: "Nuture Daily Boost",
  brand: "Nuture",
  url: "https://nuture.com.br/products/nuture-daily-boost",
};

const ag1 = {
  marca: "Athletic Greens",
  produto: "AG1",
  loja: "Athletic Greens",
  url: "https://drinkag1.com/products/ag1",
  preco: 99,
  moeda: "USD",
  prazo_entrega: "5 a 8 dias",
  avaliacao: "4.8",
  dimensoes: "1 scoop por dia",
  qualidade: "Certificação NSF",
  imagem_url: "https://media.post.rvohealth.io/ag1.jpg",
  atributos: ["75 vitamins"],
};

describe("cited offer crown", () => {
  it("crowns a SKU on strict majority when N >= 2", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [ag1], [{ marca: "Bloom", produto: "Greens", loja: "Amazon" }]],
    });
    expect(crown.confidence).toBe("clear");
    expect(crown.produto).toBe("AG1");
    expect(crown.seller).toBe("Athletic Greens");
    expect(crown.dimensoes).toBe("1 scoop por dia");
    expect(crown.qualidade).toBe("Certificação NSF");
    expect(crown.imagem_url).toBe("https://media.post.rvohealth.io/ag1.jpg");
    expect(crown.persistedCount).toBe(3);
  });

  it("does not crown a split and keeps both SKUs", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [{ marca: "Bloom", produto: "Greens", loja: "Amazon" }]],
    });
    expect(crown.confidence).toBe("split");
    expect(crown.produto).toBeNull();
    expect(crown.candidates).toHaveLength(2);
  });

  it("does not treat a store-only name as a winner", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
        [{ loja: "Decathlon" }],
      ],
    });
    expect(crown.confidence).toBe("store_only");
    expect(crown.produto).toBeNull();
    expect(crown.seller).toBe("Decathlon");
    expect(planCitedOfferFollowUp(crown)?.reason).toBe("missing_product");
  });

  it("does not mix two products from the same store into one profile", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [
        [{ marca: "Burton", produto: "Custom Flying V", loja: "Decathlon", preco: 1899 }],
        [{ marca: "Burton", produto: "Custom Flying V", loja: "Decathlon" }],
        [{ marca: "Salomon", produto: "Sight", loja: "Decathlon", preco: 999 }],
      ],
    });
    expect(crown.confidence).toBe("clear");
    expect(crown.produto).toBe("Custom Flying V");
    expect(crown.preco).toBe(1899);
  });

  it("skips follow-up when criticals are already filled", () => {
    const crown = crownCompetitorSku({
      client,
      objectsByQuery: [[ag1], [ag1]],
    });
    expect(planCitedOfferFollowUp(crown)).toBeNull();
  });

  it("asks for the checkout page when Gemini named a SKU with price but no PDP", () => {
    const plan = planCitedFaceFollowUp({
      marca: "Revigoran",
      produto: "A-Z Multivitamínico Completo",
      preco: 49.9,
      avaliacao: "4.4 de 5 estrelas",
      url: null,
    });
    expect(plan?.reason).toBe("missing_facts");
    expect(plan?.query).toMatch(/link direto da página/);
    expect(planCitedFaceFollowUp(ag1)).toBeNull();
  });

  it("does not treat a review host as the seller", () => {
    expect(
      sellerFromObject({
        marca: "Athletic Greens",
        produto: "AG1",
        url: "https://www.healthline.com/nutrition/athletic-greens-review",
      }),
    ).toBeNull();
    expect(
      groundingHostsFromUrls(
        [
          "https://www.healthline.com/nutrition/athletic-greens-review",
          "https://drinkag1.com/products/ag1",
        ],
        "drinkag1.com",
      ).map((row) => row.host),
    ).toEqual(["healthline.com"]);
  });

  it("keys identity as marca+produto", () => {
    expect(productIdentityKey(ag1)).toBe("athletic greens|ag1");
  });

  it("follow-up fills nulls only and keeps every cited SKU", () => {
    const merged = mergeFollowUpCitedObjects(
      [
        { marca: "Athletic Greens", produto: "AG1", preco: 99, loja: null },
        { marca: "Bloom", produto: "Greens", preco: 189 },
      ],
      [{ marca: "Athletic Greens", produto: "AG1", preco: 1, loja: "Athletic Greens" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.preco).toBe(99);
    expect(merged[0]?.loja).toBe("Athletic Greens");
  });

  it("ADR-003 bug fixed: follow-up merge no longer discards a freshly-computed grounding verdict", () => {
    // Regression coverage for the exact bug found in review: turn 1 leaves the object's
    // grounding verdict unset (`undefined`, no signal yet — that ambiguity is why a follow-up
    // was asked in the first place); the follow-up turn resolves it to a confident `false`
    // (grounded elsewhere, not the client). Before the fix, `fillNulls` didn't list
    // `grounding_confirmed_client` at all, so the follow-up's `false` was silently dropped and
    // the object stayed `undefined` forever — reopening the exact same-query co-mention gap
    // ADR-003 closed, specifically for objects that needed a follow-up to resolve.
    const merged = mergeFollowUpCitedObjects(
      [
        {
          marca: "Athletic Greens",
          produto: "AG1",
          preco: null,
          grounding_confirmed_client: undefined,
        },
      ],
      [{ marca: "Athletic Greens", produto: "AG1", preco: 99, grounding_confirmed_client: false }],
    );
    expect(merged[0]?.grounding_confirmed_client).toBe(false);
  });

  it("follow-up merge keeps the first turn's grounding verdict — fills nulls only, never overwrites", () => {
    const merged = mergeFollowUpCitedObjects(
      [{ marca: "Athletic Greens", produto: "AG1", grounding_confirmed_client: true }],
      [{ marca: "Athletic Greens", produto: "AG1", grounding_confirmed_client: false }],
    );
    expect(merged[0]?.grounding_confirmed_client).toBe(true);
  });
});

describe("isClientCitedObject — grounding precedence (ADR-003)", () => {
  const offDomainFuzzyMatch = { marca: "Nuture", url: "https://marketplace.example/listing/1" };

  it("suppresses the fuzzy fallback when the object's own grounding verdict is false", () => {
    expect(isClientCitedObject(offDomainFuzzyMatch, client, false)).toBe(false);
  });

  it("still applies the fuzzy fallback when grounding confirmed the client (disambiguating which object)", () => {
    expect(isClientCitedObject(offDomainFuzzyMatch, client, true)).toBe(true);
  });

  it("still applies the fuzzy fallback with no grounding verdict at all — unmigrated-caller back-compat", () => {
    expect(isClientCitedObject(offDomainFuzzyMatch, client)).toBe(true);
  });

  it("a literal host match always wins, even when the grounding verdict is false", () => {
    const clientHostObject = { url: "https://nuture.com.br/products/nuture-daily-boost" };
    expect(isClientCitedObject(clientHostObject, client, false)).toBe(true);
  });

  it("does not treat a Mercado Livre listing as the client because both titles start with Multivitamínico", () => {
    const completeBari = {
      name: "Multivitamínico Para Usuários de Caneta ou Bariátrico | 23 Nutrientes",
      brand: "CompleteBari",
      url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
    };
    expect(
      isClientCitedObject(
        {
          produto: "Multivitamínico Beleza Saúde Body Bari Pós-Cirurgia Bariátrica",
          loja: "Mercado Livre",
          preco: 71.01,
        },
        completeBari,
        true,
      ),
    ).toBe(false);
    expect(compactIdentity("Complete Bari")).toBe(compactIdentity("CompleteBari"));
  });

  it("treats the same brand on another host as the product elsewhere, not the storefront", () => {
    const completeBari = {
      name: "Multivitamínico Complete Bari Multi",
      brand: "Complete Bari",
      url: "https://completebari.com.br/products/multivitaminico-complete-bari-multi",
    };
    const raia = {
      marca: "Complete Bari",
      url: "https://www.drogaraia.com.br/complete-bari",
    };
    expect(isClientStorefrontObject(raia, completeBari)).toBe(false);
    expect(isClientProductElsewhereObject(raia, completeBari)).toBe(true);
    expect(
      isClientProductElsewhereObject({ ...raia, grounding_confirmed_client: false }, completeBari),
    ).toBe(true);
  });
});

describe("crownCompetitorSku — grounding precedence (ADR-003)", () => {
  it("this repo's own crownCompetitorSku (used by track_produto/completeCitedOffers) now honors per-object and per-query grounding — was previously wired to nothing", () => {
    // Regression coverage for the exact bug found in review: this file has its own
    // `isClientCitedObject`/`crownCompetitorSku`, separate from the twins in
    // `gemini-structured.ts` and `rint-app/src/lib/cited-offer.ts` — it never received the
    // ADR-003 grounding parameter at all, so a competitor whose name fuzzy-matched the client
    // brand was always excluded from crowning (silently treated as "the client"), regardless of
    // any grounding signal, via every one of this repo's four call sites
    // (dominant-diagnostic-runner.ts x2, diagnostic-output.ts x2).
    const lookalike = { marca: "Nuture Studio", produto: "Suplemento", preco: 50 };
    const crownStillCompetitor = crownCompetitorSku({
      client,
      objectsByQuery: [[lookalike], [lookalike]],
      citedByQuery: [false, false],
    });
    expect(crownStillCompetitor.confidence).toBe("clear");
    expect(crownStillCompetitor.produto).toBe("Suplemento");

    const clientObject = { ...lookalike, grounding_confirmed_client: true };
    const crownExcludedAsClient = crownCompetitorSku({
      client,
      objectsByQuery: [[clientObject], [clientObject]],
    });
    expect(crownExcludedAsClient.confidence).toBe("empty");
  });
});

describe("occupantsFromLostQueries", () => {
  it("lists who took each lost query, not the job crown", () => {
    expect(
      occupantsFromLostQueries(
        [
          {
            cliente_foi_citado: false,
            gemini_structured: {
              objetos_citados: [
                {
                  marca: "Biostévi Nutrition",
                  produto: "Biostévi",
                  url: "https://drogaraia.com.br/biostevi",
                },
              ],
            },
          },
          {
            cliente_foi_citado: false,
            gemini_structured: {
              objetos_citados: [
                {
                  marca: "Centrum",
                  produto: "Centrum Bariátrico",
                  url: "https://beltnutrition.com.br/centrum",
                },
              ],
            },
          },
          {
            cliente_foi_citado: true,
            gemini_structured: {
              objetos_citados: [{ marca: "Nuture", produto: "Daily Boost", url: client.url }],
            },
          },
        ],
        client,
      ),
    ).toEqual([
      { name: "Biostévi Nutrition", href: "https://drogaraia.com.br/biostevi" },
      { name: "Centrum Bariátrico", href: "https://beltnutrition.com.br/centrum" },
    ]);
  });

  it("does not elect a spoken name when two SKUs took the losses", () => {
    expect(
      lostOccupantSpeech([
        { name: "Biostévi Nutrition", href: "https://drogaraia.com.br/biostevi" },
        { name: "Centrum Bariátrico", href: "https://beltnutrition.com.br/centrum" },
      ]),
    ).toEqual({ kind: "several" });
    expect(
      lostOccupantSpeech([
        { name: "Centrum Bariátrico", href: "https://beltnutrition.com.br/centrum" },
      ]),
    ).toEqual({
      kind: "one",
      name: "Centrum Bariátrico",
      href: "https://beltnutrition.com.br/centrum",
    });
  });

  it("folds Centrum Centrum Bariátrico into one spoken name", () => {
    expect(formatCitedOfferLabel("Centrum", "Centrum Bariátrico")).toBe("Centrum Bariátrico");
  });
});

describe("vsRivalProductKeys", () => {
  const bari = {
    name: "Multivitamínico Complete Bari Multi",
    brand: "CompleteBari",
    url: "https://completebari.com.br/products/multi",
  };
  const centrum = { marca: "Centrum", produto: "Centrum Bariátrico" };
  const biostevi = { marca: "Biostévi", produto: "Nutrition" };
  const bloom = { marca: "Bloom", produto: "Greens" };

  it("shows the two category-loss SKUs instead of an empty empate", () => {
    const keys = vsRivalProductKeys({
      client: bari,
      queries: [
        { text: "melhor vitamina bariátrica", cited: false, objects: [centrum] },
        { text: "multivitamínico para bariátrico", cited: false, objects: [biostevi] },
        { text: "Complete Bari vale a pena", cited: false, objects: [bloom] },
      ],
      candidates: [
        { productKey: "bloom|greens", marca: "Bloom", produto: "Greens", count: 1, seller: null },
        {
          productKey: "centrum|centrum bariatrico",
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          count: 1,
          seller: null,
        },
        {
          productKey: "biostevi|nutrition",
          marca: "Biostévi",
          produto: "Nutrition",
          count: 1,
          seller: null,
        },
      ],
    });
    expect(keys).toHaveLength(2);
    expect(keys).toContain("centrum|centrum bariatrico");
    expect(keys).toContain("biostevi|nutrition");
    expect(keys).not.toContain("bloom|greens");
  });
});

describe("checkoutHostFitsSeller", () => {
  it("ties the cited store to that host, not another pharmacy", () => {
    expect(checkoutHostFitsSeller("https://www.paguemenos.com.br/kit-flora/p", "Pague Menos")).toBe(
      true,
    );
    expect(checkoutHostFitsSeller("https://www.extrafarma.com.br/kit-flora/p", "Pague Menos")).toBe(
      false,
    );
  });
});

describe("vsRivalPaintKeys", () => {
  it("drops a Magalu search face that has no checkout fact", () => {
    const keys = vsRivalPaintKeys(
      ["centrum|centrum bariatrico", "flora nativa|multivitaminico bariatrico"],
      [
        {
          marca: "Centrum",
          produto: "Centrum Bariátrico",
          url: "https://www.magazineluiza.com.br/busca/multivitaminico+bariatrico/",
          loja: "Magazine Luiza",
          qualidade: "bom custo-benefício",
        },
        {
          marca: "Flora Nativa",
          produto: "Multivitamínico Bariátrico",
          url: "https://www.paguemenos.com.br/kit-flora/p",
          preco: 39.9,
          imagem_url: "https://paguemenos.vteximg.com.br/arquivos/ids/1/flora.jpg",
        },
      ],
    );
    expect(keys).toEqual(["flora nativa|multivitaminico bariatrico"]);
  });

  it("does not fall back to blog names when no face has a PDP", () => {
    const keys = vsRivalPaintKeys(
      ["revigoran|a z multivitaminico completo", "nutrify|multi all"],
      [
        {
          marca: "Revigoran",
          produto: "A-Z Multivitamínico Completo",
          preco: 49.9,
          avaliacao: "4.4 de 5 estrelas",
          url: null,
        },
        {
          marca: "Nutrify",
          produto: "Multi All",
          preco: 100,
          avaliacao: "4.9 (752 opiniões)",
          url: null,
        },
      ],
    );
    expect(keys).toEqual([]);
  });

  it("does not treat a Mercado Livre login wall as checkout", () => {
    const keys = vsRivalPaintKeys(
      ["lavitan|lavitan az mulher"],
      [
        {
          marca: "Lavitan",
          produto: "Lavitan AZ Mulher",
          loja: "Mercado Livre",
          url: "https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Fwww.mercadolivre.com.br%2Flavitan-super-formula-a-z-mulher-c-60-comprimidos%2Fp%2FMLB20000000195000000000000000000000",
        },
      ],
    );
    expect(keys).toEqual([]);
  });
});

describe("isLikelyProductUrl", () => {
  it("accepts pharmacy slugs, VTEX /p and Amazon /dp, and refuses blog and Google redirects", () => {
    expect(isLikelyProductUrl("https://barisaude.com.br/barimax-multi-3-meses")).toBe(true);
    expect(isLikelyProductUrl("https://www.drogariasaopaulo.com.br/centrum-bariatrico/p")).toBe(
      true,
    );
    expect(isLikelyProductUrl("https://www.amazon.com.br/dp/B0EXAMPLE")).toBe(true);
    expect(isLikelyProductUrl("https://drinkag1.com/products/ag1")).toBe(true);
    expect(isLikelyProductUrl("https://loja.com/blog/post")).toBe(false);
    expect(
      isLikelyProductUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"),
    ).toBe(false);
    expect(
      isLikelyProductUrl(
        "https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Flista.mercadolivre.com.br%2Flavitan-az-mulher",
      ),
    ).toBe(false);
    expect(
      isLikelyProductUrl(
        "https://www.mercadolivre.com.br/lavitan-super-formula-a-z-mulher-c-60-comprimidos/p/MLB46241161",
      ),
    ).toBe(true);
  });
});
