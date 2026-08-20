import type { LlmClient } from "../lib/llm/types.js";
import { catalogGapPhrase } from "./llm-out-first-action.js";

/** Founder prose for speak / email / fallback. The admin paints URL + attrs from `content_brief`. */

export type TrackLlmContentBriefForCopy = {
  theme: string;
  sku_name?: string;
  brand?: string | null;
  target_url?: string | null;
  target_url_source?: "grounding" | "search_console" | null;
  use_attrs?: string[];
  skip_attrs?: string[];
  grounding_note?: "review_not_listing" | null;
  catalog_first?: boolean;
  catalog_gaps?: Array<"attributes" | "description">;
  existing_content_surface?: "owned_content_directory" | "owned_content_subdomain" | null;
  incoherent?: boolean;
  sourcesWithoutStore?: boolean;
};

export type FounderActionCopyResult = {
  first_action: string;
  copy_source: "llm" | "deterministic_friendly";
  copy_model: string | null;
  copy_fallback_reason: string | null;
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sentenceJoin(parts: string[]): string {
  return parts.filter((part) => part.trim()).join(" ");
}

function attrsLine(attrs: string[] | undefined): string {
  const clean = (attrs ?? [])
    .map((attr) => attr.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (clean.length === 0) return "Use os fatos reais que já estão no cadastro da loja.";
  if (clean.length === 1) return `Use este fato real que já está no cadastro: ${clean[0]}.`;
  return `Use estes fatos reais que já estão no cadastro: ${clean.join(" e ")}.`;
}

function linkLine(brief: TrackLlmContentBriefForCopy): string {
  const skuName = brief.sku_name?.trim() || "este produto";
  return brief.target_url?.trim()
    ? `Reforce nela o caminho para ${skuName}.`
    : `Inclua um caminho claro para ${skuName}.`;
}

function skipLine(brief: TrackLlmContentBriefForCopy): string {
  const skip = (brief.skip_attrs ?? []).find((attr) => attr.trim());
  return skip ? `Não afirme ${skip}, porque isso não está no cadastro do produto.` : "";
}

function whyLine(brief: TrackLlmContentBriefForCopy): string {
  return brief.grounding_note === "review_not_listing"
    ? "Hoje a IA está buscando essa resposta em review, blog ou loja de outra marca."
    : "";
}

export function buildDeterministicFounderActionCopy(brief: TrackLlmContentBriefForCopy): string {
  const skuName = brief.sku_name?.trim() || "este produto";
  const theme = brief.theme?.trim() || skuName;
  const targetUrl = brief.target_url?.trim() || null;
  if (brief.catalog_first) {
    const what = catalogGapPhrase(brief.catalog_gaps ?? []);
    const where = targetUrl ? `: ${targetUrl}` : "";
    const later = brief.existing_content_surface
      ? "Com o cadastro em ordem, melhore o guia no domínio da loja."
      : `Com o cadastro em ordem, crie uma página no seu domínio, fora da ficha do produto, para explicar ${theme}.`;
    return sentenceJoin([
      `Complete no Shopify ${what} de ${skuName}${where}.`,
      "O cadastro é a base: sem isso, um guia novo não tem o que dizer.",
      later,
      skipLine(brief),
      whyLine(brief),
    ]);
  }
  if (brief.incoherent) {
    const base = targetUrl
      ? `A IA já fala de ${skuName}, mas o preço ou a marca não batem com a loja. Melhore esta página do seu site: ${targetUrl}. Deixe nela o preço real e os fatos do cadastro.`
      : `A IA já fala de ${skuName}, mas o preço ou a marca não batem com a loja. Crie uma página no seu domínio, fora da ficha do produto, que deixe o preço real e os fatos do cadastro claros.`;
    return sentenceJoin([base, attrsLine(brief.use_attrs), linkLine(brief), skipLine(brief)]);
  }
  if (brief.sourcesWithoutStore) {
    const base = targetUrl
      ? `A IA já fala do nome de ${skuName}, mas foi buscar a resposta em outros sites. Melhore esta página do seu site: ${targetUrl}. Deixe nela os fatos do cadastro para ela ler a sua loja.`
      : `A IA já fala do nome de ${skuName}, mas foi buscar a resposta em outros sites. Crie uma página no seu domínio, fora da ficha do produto, com os fatos do cadastro para ela ler a sua loja.`;
    return sentenceJoin([base, attrsLine(brief.use_attrs), linkLine(brief), skipLine(brief)]);
  }
  const base = targetUrl
    ? `Melhore esta página do seu site: ${targetUrl}. Ela já pode ser a resposta que a IA deveria encontrar sobre ${theme}.`
    : `Crie uma página no seu domínio, fora da ficha do produto, para explicar ${theme} de um jeito claro para quem está pesquisando na IA.`;
  return sentenceJoin([
    base,
    attrsLine(brief.use_attrs),
    linkLine(brief),
    skipLine(brief),
    whyLine(brief),
  ]);
}

export function buildTrackLlmSupportLine(brief: TrackLlmContentBriefForCopy): string {
  if (brief.catalog_first) {
    const what = catalogGapPhrase(brief.catalog_gaps ?? []);
    return `Por que isso importa: O cadastro é a base. Sem ${what} neste produto, a IA não tem fato seu para repetir — nem na ficha, nem num guia.`;
  }
  if (brief.incoherent) {
    return "Por que isso importa: Ela já te citou. O risco agora é repetir o preço ou a marca errados — a página precisa bater com o Shopify.";
  }
  if (brief.sourcesWithoutStore) {
    return "Por que isso importa: Ela já sabe o nome. Sem uma página sua nas fontes, o comprador vai para o site que ela leu.";
  }
  const targetUrl = brief.target_url?.trim();
  if (targetUrl && brief.target_url_source === "search_console") {
    return "Por que isso importa: O Search Console já encontrou essa página, então ela pode virar a fonte mais clara para a IA entender o produto.";
  }
  if (targetUrl) {
    return "Por que isso importa: A IA já encontrou uma página sua, mas ela ainda precisa explicar melhor o produto e guiar para a compra.";
  }
  if (brief.grounding_note === "review_not_listing") {
    return "Por que isso importa: Hoje a IA está buscando essa resposta fora do seu site; falta uma página sua para concentrar esses fatos.";
  }
  return "Por que isso importa: A IA precisa encontrar uma página clara do seu domínio antes de confiar nessa resposta.";
}

function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match) =>
    match[0].replace(/[.,;:!?]+$/, ""),
  );
}

export function validateFounderActionCopy(
  text: string,
  brief: TrackLlmContentBriefForCopy,
): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 60) return "copy_too_short";
  if (trimmed.length > 700) return "copy_too_long";
  if (/^```|[{}[\]]/.test(trimmed)) return "copy_not_plain_text";

  const targetUrl = brief.target_url?.trim() || null;
  const urls = urlsIn(trimmed);
  if (!targetUrl && urls.length > 0) return "invented_url";
  if (targetUrl) {
    if (!trimmed.includes(targetUrl)) return "missing_target_url";
    if (urls.some((url) => url !== targetUrl)) return "invented_url";
  }

  const folded = fold(trimmed);
  const skuName = brief.sku_name?.trim();
  if (skuName && !folded.includes(fold(skuName))) return "missing_sku_name";
  if (brief.catalog_first && !/\b(cadastro|shopify)\b/.test(folded)) return "missing_catalog_first";
  if (brief.incoherent && !/\b(preco|marca)\b/.test(folded)) return "missing_incoherent";
  if (brief.sourcesWithoutStore && !/\b(nome|fontes|outros sites)\b/.test(folded)) {
    return "missing_sources_without_store";
  }

  for (const attr of (brief.use_attrs ?? []).slice(0, 2)) {
    if (attr.trim() && !folded.includes(fold(attr))) return "missing_allowed_attr";
  }

  for (const attr of brief.skip_attrs ?? []) {
    const needle = fold(attr);
    if (!needle || !folded.includes(needle)) continue;
    const index = folded.indexOf(needle);
    const before = folded.slice(Math.max(0, index - 35), index);
    if (!/\b(nao|sem|evite|nunca)\b/.test(before)) return "forbidden_attr_as_positive";
  }

  return null;
}

export async function renderFounderActionWithGuardrails(input: {
  deterministicAction: string;
  brief: TrackLlmContentBriefForCopy;
  llm: LlmClient | null | undefined;
}): Promise<FounderActionCopyResult> {
  const fallback = buildDeterministicFounderActionCopy(input.brief);
  const copywriter = input.llm?.renderFounderAction;
  if (!copywriter) {
    return {
      first_action: fallback,
      copy_source: "deterministic_friendly",
      copy_model: null,
      copy_fallback_reason: "copywriter_not_configured",
    };
  }

  try {
    const result = await copywriter({
      deterministicAction: input.deterministicAction,
      contentBrief: input.brief,
      fallbackCopy: fallback,
      language: "pt-BR",
    });
    if (result.mocked) {
      return {
        first_action: fallback,
        copy_source: "deterministic_friendly",
        copy_model: result.model,
        copy_fallback_reason: "copywriter_mocked",
      };
    }
    const reason = validateFounderActionCopy(result.text, input.brief);
    if (reason) {
      if (
        !input.brief.catalog_first &&
        (reason === "missing_sku_name" || reason === "missing_allowed_attr")
      ) {
        const repaired = sentenceJoin([
          result.text.trim(),
          attrsLine(input.brief.use_attrs),
          linkLine(input.brief),
          skipLine(input.brief),
          whyLine(input.brief),
        ]);
        if (!validateFounderActionCopy(repaired, input.brief)) {
          return {
            first_action: repaired,
            copy_source: "llm",
            copy_model: result.model,
            copy_fallback_reason: null,
          };
        }
      }
      return {
        first_action: fallback,
        copy_source: "deterministic_friendly",
        copy_model: result.model,
        copy_fallback_reason: reason,
      };
    }
    return {
      first_action: result.text.trim(),
      copy_source: "llm",
      copy_model: result.model,
      copy_fallback_reason: null,
    };
  } catch {
    return {
      first_action: fallback,
      copy_source: "deterministic_friendly",
      copy_model: null,
      copy_fallback_reason: "copywriter_error",
    };
  }
}
