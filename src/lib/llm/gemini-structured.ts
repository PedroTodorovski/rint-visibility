/** Probe derivative: objects Gemini named in the shopper answer. Not a catalog. */

export type GeminiCitedObject = {
  marca: string | null;
  loja: string | null;
  produto: string | null;
  url: string | null;
  preco: number | null;
  moeda: string | null;
  dimensoes: string | null;
  qualidade: string | null;
  prazo_entrega: string | null;
  avaliacao: string | null;
  atributos: string[];
};

export type GeminiStructuredOutput = {
  cliente_foi_citado: boolean;
  concorrente_citado_nome: string | null;
  concorrente_citado_url: string | null;
  atributos_mencionados_gemini: string[];
  preco_citado: number | null;
  nome_marca_citada: string | null;
  produto_mencionado: string | null;
  objetos_citados: GeminiCitedObject[];
};

export type ClientIdentity = {
  name: string;
  brand: string | null;
  url?: string | null;
};

export function emptyGeminiStructured(): GeminiStructuredOutput {
  return {
    cliente_foi_citado: false,
    concorrente_citado_nome: null,
    concorrente_citado_url: null,
    atributos_mencionados_gemini: [],
    preco_citado: null,
    nome_marca_citada: null,
    produto_mencionado: null,
    objetos_citados: [],
  };
}

export function emptyCitedObject(): GeminiCitedObject {
  return {
    marca: null,
    loja: null,
    produto: null,
    url: null,
    preco: null,
    moeda: null,
    dimensoes: null,
    qualidade: null,
    prazo_entrega: null,
    avaliacao: null,
    atributos: [],
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fencedBody = fenced?.[1]?.trim();
  if (fencedBody) text = fencedBody;
  const object = text.match(/\{[\s\S]*\}/);
  const objectBody = object?.[0];
  if (objectBody) text = objectBody;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseCitedObject(value: unknown): GeminiCitedObject | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const parsed: GeminiCitedObject = {
    marca: stringOrNull(row.marca),
    loja: stringOrNull(row.loja),
    produto: stringOrNull(row.produto),
    url: stringOrNull(row.url),
    preco: numberOrNull(row.preco),
    moeda: stringOrNull(row.moeda),
    dimensoes: stringOrNull(row.dimensoes),
    qualidade: stringOrNull(row.qualidade),
    prazo_entrega: stringOrNull(row.prazo_entrega),
    avaliacao: stringOrNull(row.avaliacao),
    atributos: stringArray(row.atributos),
  };
  const hasSignal =
    parsed.marca ||
    parsed.loja ||
    parsed.produto ||
    parsed.url ||
    parsed.preco !== null ||
    parsed.dimensoes ||
    parsed.qualidade ||
    parsed.prazo_entrega ||
    parsed.avaliacao ||
    parsed.atributos.length > 0;
  return hasSignal ? parsed : null;
}

function fold(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function listedCitedObjects(structured: GeminiStructuredOutput): GeminiCitedObject[] {
  return Array.isArray(structured.objetos_citados) ? structured.objetos_citados : [];
}

function fallbackObjectFromSingular(structured: GeminiStructuredOutput): GeminiCitedObject | null {
  return parseCitedObject({
    marca: structured.nome_marca_citada,
    loja: structured.concorrente_citado_nome,
    produto: structured.produto_mencionado,
    url: structured.concorrente_citado_url,
    preco: structured.preco_citado,
    atributos: structured.atributos_mencionados_gemini,
  });
}

function objectKey(object: GeminiCitedObject): string {
  return [fold(object.marca), fold(object.loja), fold(object.produto), fold(object.url)].join("|");
}

function mergeObject(left: GeminiCitedObject, right: GeminiCitedObject): GeminiCitedObject {
  return {
    marca: left.marca ?? right.marca,
    loja: left.loja ?? right.loja,
    produto: left.produto ?? right.produto,
    url: left.url ?? right.url,
    preco: left.preco ?? right.preco,
    moeda: left.moeda ?? right.moeda,
    dimensoes: left.dimensoes ?? right.dimensoes,
    qualidade: left.qualidade ?? right.qualidade,
    prazo_entrega: left.prazo_entrega ?? right.prazo_entrega,
    avaliacao: left.avaliacao ?? right.avaliacao,
    atributos: [...new Set([...left.atributos, ...right.atributos])],
  };
}

export function mergeCitedObjects(lists: GeminiCitedObject[][]): GeminiCitedObject[] {
  const map = new Map<string, GeminiCitedObject>();
  for (const object of lists.flat()) {
    const key = objectKey(object);
    const previous = map.get(key);
    map.set(key, previous ? mergeObject(previous, object) : object);
  }
  return [...map.values()];
}

export function citedObjectsFromStructured(
  structured: GeminiStructuredOutput,
): GeminiCitedObject[] {
  const listed = listedCitedObjects(structured);
  if (listed.length > 0) return listed;
  const fallback = fallbackObjectFromSingular(structured);
  return fallback ? [fallback] : [];
}

export function hydrateGeminiStructured(parsed: GeminiStructuredOutput): GeminiStructuredOutput {
  const objects = citedObjectsFromStructured(parsed);
  const primary = objects[0];
  const mentioned = parsed.atributos_mencionados_gemini ?? [];
  const attrs =
    mentioned.length > 0 ? mentioned : [...new Set(objects.flatMap((object) => object.atributos))];
  return {
    ...parsed,
    objetos_citados: objects,
    concorrente_citado_nome:
      parsed.concorrente_citado_nome || primary?.loja || primary?.marca || null,
    concorrente_citado_url: parsed.concorrente_citado_url || primary?.url || null,
    nome_marca_citada: parsed.nome_marca_citada || primary?.marca || null,
    produto_mencionado: parsed.produto_mencionado || primary?.produto || null,
    preco_citado: parsed.preco_citado ?? primary?.preco ?? null,
    atributos_mencionados_gemini: attrs,
  };
}

export function parseGeminiStructuredOutput(raw: string): GeminiStructuredOutput | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const objects = Array.isArray(parsed.objetos_citados)
    ? parsed.objetos_citados
        .map((item) => parseCitedObject(item))
        .filter((item): item is GeminiCitedObject => Boolean(item))
    : [];

  return hydrateGeminiStructured({
    cliente_foi_citado: parsed.cliente_foi_citado === true,
    concorrente_citado_nome: stringOrNull(parsed.concorrente_citado_nome),
    concorrente_citado_url: stringOrNull(parsed.concorrente_citado_url),
    atributos_mencionados_gemini: stringArray(parsed.atributos_mencionados_gemini),
    preco_citado: numberOrNull(parsed.preco_citado),
    nome_marca_citada: stringOrNull(parsed.nome_marca_citada),
    produto_mencionado: stringOrNull(parsed.produto_mencionado),
    objetos_citados: objects,
  });
}

export function isCitedClientObject(object: GeminiCitedObject, identity: ClientIdentity): boolean {
  const citedHost = hostOf(object.url);
  const clientHost = hostOf(identity.url);
  if (citedHost && clientHost && citedHost === clientHost) return true;

  const cited = fold(object.marca) || fold(object.produto);
  if (!cited) return false;
  const names = [identity.name, identity.brand].map(fold).filter(Boolean);
  return names.some((name) => name.includes(cited) || cited.includes(name.split(" ")[0] ?? name));
}

export function competitorCitedObjects(
  structured: GeminiStructuredOutput,
  client: ClientIdentity,
): GeminiCitedObject[] {
  return citedObjectsFromStructured(structured).filter(
    (object) => !isCitedClientObject(object, client),
  );
}

export function minCompetitorPrice(
  structured: GeminiStructuredOutput,
  client: ClientIdentity,
): number | null {
  const prices = competitorCitedObjects(structured, client)
    .map((object) => object.preco)
    .filter((price): price is number => price != null && price > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export const GEMINI_STRUCTURE_PROMPT_SHAPE = `{
  "cliente_foi_citado": boolean,
  "concorrente_citado_nome": string | null,
  "concorrente_citado_url": string | null,
  "atributos_mencionados_gemini": string[],
  "preco_citado": number | null,
  "nome_marca_citada": string | null,
  "produto_mencionado": string | null,
  "objetos_citados": [
    {
      "marca": string | null,
      "loja": string | null,
      "produto": string | null,
      "url": string | null,
      "preco": number | null,
      "moeda": string | null,
      "dimensoes": string | null,
      "qualidade": string | null,
      "prazo_entrega": string | null,
      "avaliacao": string | null,
      "atributos": string[]
    }
  ]
}`;
