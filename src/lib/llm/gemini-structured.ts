import { citedNameAlignsWithClient, isClientStorefrontObject } from "../cited-offer.js";
import { founderFacingAttributes } from "../founder-attributes.js";

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
  imagem_url: string | null;
  atributos: string[];
  /**
   * Engine-computed, not part of Gemini's own output. Two layers, finer one wins:
   * (1) true per-object attribution — a grounded sentence that actually names this object
   * resolved to the client's own host (see `objectHostMatchFromSupports` in gemini-grounding.ts),
   * stamped in `recordDiagnoseExecution` before merge. (2) where no sentence names the object at
   * all, falls back to the coarser per-execution `cliente_foi_citado` OR'd across every execution
   * that contributed this object (see `mergeCitedObjects`). Absent when neither layer had a signal
   * (a single, unmerged parse, or persisted data from before this field existed). Lets
   * `isCitedClientObject` resolve grounding per object instead of only per query or per execution —
   * closes both the multi-execution majority-vote gap and the same-query co-mention gap from
   * ADR-003.
   */
  grounding_confirmed_client?: boolean;
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
    imagem_url: null,
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
  const raw: string[] = [];
  if (typeof value === "string") raw.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") raw.push(item);
    }
  }
  return founderFacingAttributes(raw);
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
    imagem_url: stringOrNull(row.imagem_url),
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
    parsed.imagem_url ||
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

/** `true` beats `false` beats `undefined` — one confirming execution is enough to trust the object. */
function orGroundingConfirmed(
  left: boolean | undefined,
  right: boolean | undefined,
): boolean | undefined {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return left ?? right;
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
    imagem_url: left.imagem_url ?? right.imagem_url,
    atributos: [...new Set([...left.atributos, ...right.atributos])],
    grounding_confirmed_client: orGroundingConfirmed(
      left.grounding_confirmed_client,
      right.grounding_confirmed_client,
    ),
  };
}

/**
 * `groundingConfirmedByList[i]` — pass execution `i`'s own `cliente_foi_citado` when known
 * (`dominant-diagnostic-runner.ts` passes one per execution). Used as a per-execution *fallback*
 * only: when an object already carries its own `grounding_confirmed_client` (the finer per-object
 * attribution stamped in `recordDiagnoseExecution` — see the field's doc comment), that value wins
 * and the coarser per-execution one is not applied over it. Objects with no per-object signal keep
 * getting the per-execution fallback, OR'd across every execution that contributed them — a
 * minority execution that genuinely grounded the client is enough, even if the query-level majority
 * vote disagrees. Omit the second argument to preserve the exact prior behavior (no field set).
 */
export function mergeCitedObjects(
  lists: GeminiCitedObject[][],
  groundingConfirmedByList?: Array<boolean | undefined>,
): GeminiCitedObject[] {
  const map = new Map<string, GeminiCitedObject>();
  lists.forEach((list, index) => {
    const grounded = groundingConfirmedByList?.[index];
    for (const object of list) {
      const stamped =
        object.grounding_confirmed_client !== undefined || grounded === undefined
          ? object
          : { ...object, grounding_confirmed_client: grounded };
      const key = objectKey(stamped);
      const previous = map.get(key);
      map.set(key, previous ? mergeObject(previous, stamped) : stamped);
    }
  });
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

function citedIdentityNames(
  parsed: GeminiStructuredOutput,
  objects: GeminiCitedObject[],
): Array<string | null | undefined> {
  return [
    parsed.nome_marca_citada,
    parsed.produto_mencionado,
    parsed.concorrente_citado_nome,
    ...objects.flatMap((object) => [object.marca, object.produto]),
  ];
}

export function hydrateGeminiStructured(parsed: GeminiStructuredOutput): GeminiStructuredOutput {
  const objects = citedObjectsFromStructured(parsed);
  const dropNames = citedIdentityNames(parsed, objects);
  const cleanedObjects = objects.map((object) => ({
    ...object,
    atributos: founderFacingAttributes(object.atributos, { dropNames }),
  }));
  const primary = cleanedObjects[0];
  const mentioned = parsed.atributos_mencionados_gemini ?? [];
  const attrs =
    mentioned.length > 0
      ? founderFacingAttributes(mentioned, { dropNames })
      : founderFacingAttributes(
          cleanedObjects.flatMap((object) => object.atributos),
          { dropNames },
        );
  return {
    ...parsed,
    objetos_citados: cleanedObjects,
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

/**
 * `groundingConfirmedClient` — pass the query's grounded citation result (`citation-gold.ts`'s
 * strict, grounding-host-based `cited`/`cliente_foi_citado`) when known. Grounding is the source
 * of truth: once it has decided this query did NOT cite the client, a loose name/brand substring
 * match must not override that and misclassify a competitor object as the client (or the reverse).
 * The fuzzy fallback stays in play only to disambiguate WHICH object represents the client among
 * several `objetos_citados` in a query grounding already confirmed as cited (`true`), or when the
 * caller has no grounding verdict to offer (`undefined` — back-compat for unmigrated callers).
 */
export function isCitedClientObject(
  object: GeminiCitedObject,
  identity: ClientIdentity,
  groundingConfirmedClient?: boolean,
): boolean {
  if (isClientStorefrontObject(object, identity)) return true;
  if (groundingConfirmedClient === false) return false;

  return (
    citedNameAlignsWithClient(object.marca, identity) ||
    citedNameAlignsWithClient(object.produto, identity)
  );
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
      "imagem_url": string | null,
      "atributos": string[]
    }
  ]
}`;
