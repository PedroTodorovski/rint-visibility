import { describe, expect, it } from "vitest";

import {
  crownCompetitorSku,
  groundingHostsFromUrls,
  isClientCitedObject,
  mergeFollowUpCitedObjects,
  planCitedOfferFollowUp,
  productIdentityKey,
  sellerFromObject,
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
