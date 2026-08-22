import { describe, expect, it } from "vitest";

import {
  citedObjectsFromStructured,
  emptyCitedObject,
  emptyGeminiStructured,
  hydrateGeminiStructured,
  isCitedClientObject,
  mergeCitedObjects,
  minCompetitorPrice,
  parseGeminiStructuredOutput,
} from "../src/lib/llm/gemini-structured.js";

const client = {
  name: "Hero Sofa",
  brand: "Acme",
  url: "https://acme.example/products/hero",
};

describe("parseGeminiStructuredOutput", () => {
  it("keeps only facts stated on each cited object", () => {
    const parsed = parseGeminiStructuredOutput(`
\`\`\`json
{
  "cliente_foi_citado": false,
  "concorrente_citado_nome": "Decathlon",
  "concorrente_citado_url": "https://www.decathlon.com.br/burton",
  "atributos_mencionados_gemini": ["camber"],
  "preco_citado": 1899,
  "nome_marca_citada": "Burton",
  "produto_mencionado": "Custom Flying V",
  "objetos_citados": [
    {
      "marca": "Burton",
      "loja": "Decathlon",
      "produto": "Custom Flying V",
      "url": "https://www.decathlon.com.br/burton",
      "preco": 1899,
      "moeda": "BRL",
      "dimensoes": "158 cm",
      "qualidade": null,
      "prazo_entrega": "2 dias úteis",
      "avaliacao": "4.6",
      "imagem_url": "https://cdn.example/burton.jpg",
      "atributos": ["camber"]
    },
    {
      "marca": null,
      "loja": null,
      "produto": null,
      "url": null,
      "preco": null,
      "atributos": []
    }
  ]
}
\`\`\`
`);

    expect(parsed?.objetos_citados).toHaveLength(1);
    expect(parsed?.objetos_citados[0]).toMatchObject({
      marca: "Burton",
      loja: "Decathlon",
      preco: 1899,
      dimensoes: "158 cm",
      qualidade: null,
      prazo_entrega: "2 dias úteis",
      avaliacao: "4.6",
      imagem_url: "https://cdn.example/burton.jpg",
      atributos: ["camber"],
    });
  });

  it("hydrates a single object from legacy singular fields", () => {
    const parsed = parseGeminiStructuredOutput(
      JSON.stringify({
        cliente_foi_citado: false,
        concorrente_citado_nome: "Other",
        concorrente_citado_url: "https://other.example/p",
        atributos_mencionados_gemini: [],
        preco_citado: 99,
        nome_marca_citada: "Outra Marca",
        produto_mencionado: "Outro Produto",
      }),
    );

    expect(parsed?.objetos_citados).toEqual([
      {
        ...emptyCitedObject(),
        marca: "Outra Marca",
        loja: "Other",
        produto: "Outro Produto",
        url: "https://other.example/p",
        preco: 99,
      },
    ]);
  });

  it("does not invent a profile when the answer named nothing", () => {
    expect(
      parseGeminiStructuredOutput(
        JSON.stringify({
          cliente_foi_citado: false,
          concorrente_citado_nome: null,
          atributos_mencionados_gemini: [],
          preco_citado: null,
        }),
      )?.objetos_citados,
    ).toEqual([]);
  });
});

describe("cited object identity", () => {
  it("treats a cheaper competitor as another object, not a lie about the client price", () => {
    const structured = hydrateGeminiStructured({
      ...emptyGeminiStructured(),
      preco_citado: 99,
      nome_marca_citada: "Outra Marca",
      concorrente_citado_nome: "Other",
      produto_mencionado: "Outro Produto",
      objetos_citados: [
        {
          ...emptyCitedObject(),
          marca: "Outra Marca",
          loja: "Other",
          produto: "Outro Produto",
          preco: 99,
        },
      ],
    });

    const cited = structured.objetos_citados[0];
    expect(cited).toBeDefined();
    if (!cited) return;
    expect(isCitedClientObject(cited, client)).toBe(false);
    expect(minCompetitorPrice(structured, client)).toBe(99);
  });

  it("matches the client PDP by host even when the brand field is empty", () => {
    expect(
      isCitedClientObject(
        { ...emptyCitedObject(), url: "https://www.acme.example/products/hero", preco: 99 },
        client,
      ),
    ).toBe(true);
  });

  describe("groundingConfirmedClient — strict grounding wins over the fuzzy name fallback", () => {
    // Object hosted off the client's domain, but its `marca` field fuzzy-matches the client
    // brand ("acme"). Grounding is the source of truth for whether this query cited the
    // client at all; a name-substring match alone must not override a grounded "not cited".
    const fuzzyMatchOffDomain = {
      ...emptyCitedObject(),
      marca: "Acme",
      url: "https://marketplace.example/listing/123",
    };

    it("suppresses the fuzzy fallback when grounding already said this query did not cite the client", () => {
      expect(isCitedClientObject(fuzzyMatchOffDomain, client, false)).toBe(false);
    });

    it("still applies the fuzzy fallback when grounding confirmed the client was cited (disambiguating which object it is)", () => {
      expect(isCitedClientObject(fuzzyMatchOffDomain, client, true)).toBe(true);
    });

    it("still applies the fuzzy fallback when no grounding verdict is provided (unmigrated callers keep prior behavior)", () => {
      expect(isCitedClientObject(fuzzyMatchOffDomain, client)).toBe(true);
    });

    it("a literal host match always wins, even when groundingConfirmedClient is false", () => {
      // The host check must stay unconditional: a query-level "not cited" vote (e.g. a
      // majority-vote aggregate across multiple executions, see ADR-003) must never override
      // an object that is directly hosted on the client's own domain.
      const clientHostObject = {
        ...emptyCitedObject(),
        url: "https://www.acme.example/products/hero",
      };
      expect(isCitedClientObject(clientHostObject, client, false)).toBe(true);
    });
  });

  it("merges the same object across executions without dropping stated facts", () => {
    const merged = mergeCitedObjects([
      [{ ...emptyCitedObject(), marca: "Burton", loja: "Decathlon" }],
      [
        {
          ...emptyCitedObject(),
          marca: "Burton",
          loja: "Decathlon",
          preco: 1899,
          dimensoes: "158 cm",
          imagem_url: "https://cdn.example/burton.jpg",
        },
      ],
    ]);
    expect(merged).toEqual([
      {
        ...emptyCitedObject(),
        marca: "Burton",
        loja: "Decathlon",
        preco: 1899,
        dimensoes: "158 cm",
        imagem_url: "https://cdn.example/burton.jpg",
      },
    ]);
  });

  it("stamps grounding_confirmed_client as an OR across the executions that contributed each object (ADR-003)", () => {
    const object = { ...emptyCitedObject(), marca: "Burton", loja: "Decathlon" };

    // A minority execution's `true` beats two majority `false`s — one confirming execution
    // is enough, independent of the query-level majority vote computed elsewhere.
    expect(mergeCitedObjects([[object], [object], [object]], [false, false, true])).toMatchObject([
      { grounding_confirmed_client: true },
    ]);

    // Every contributing execution said `false` — stays `false`, not just "no fallback".
    expect(mergeCitedObjects([[object], [object]], [false, false])).toMatchObject([
      { grounding_confirmed_client: false },
    ]);

    // No second argument at all — no field is stamped, byte-identical to pre-fix behavior.
    expect(mergeCitedObjects([[object]])).toEqual([object]);
  });

  it("a per-object grounding verdict (already stamped by the runner) wins over the per-execution fallback", () => {
    // ADR-003 residual gap: within a query the per-execution boolean says `true` (the query
    // *was* grounding-confirmed to the client overall), but this specific object's own sentence
    // was grounded to a different host — a competitor co-mentioned in the same answer. The
    // finer, already-computed per-object value must not be clobbered by the coarser fallback.
    const competitorAlreadyStamped = {
      ...emptyCitedObject(),
      marca: "AG1",
      grounding_confirmed_client: false,
    };
    expect(mergeCitedObjects([[competitorAlreadyStamped]], [true])).toMatchObject([
      { grounding_confirmed_client: false },
    ]);

    const clientAlreadyStamped = {
      ...emptyCitedObject(),
      marca: "Nuture",
      grounding_confirmed_client: true,
    };
    expect(mergeCitedObjects([[clientAlreadyStamped]], [false])).toMatchObject([
      { grounding_confirmed_client: true },
    ]);
  });

  it("rebuilds the array from singular fields when old snapshots omitted it", () => {
    const objects = citedObjectsFromStructured({
      ...emptyGeminiStructured(),
      nome_marca_citada: "Burton",
      concorrente_citado_nome: "Decathlon",
      objetos_citados: [],
    });
    expect(objects).toHaveLength(1);
    expect(objects[0]?.marca).toBe("Burton");
  });
});
