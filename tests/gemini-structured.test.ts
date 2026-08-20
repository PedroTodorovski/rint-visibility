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
