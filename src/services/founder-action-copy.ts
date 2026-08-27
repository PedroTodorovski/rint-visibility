import type { LlmClient } from "../lib/llm/types.js";
import { catalogGapPhrase, type LlmContentBrief } from "./llm-out-first-action.js";
import { isLlmWeekReason, type LlmWeekReason, resolveLlmWeekReason } from "./llm-week-reason.js";

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
  week_reason?: LlmWeekReason | null;
  surface?: LlmContentBrief["surface"] | null;
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

function pageVerb(brief: TrackLlmContentBriefForCopy, create: string, improve: string): string {
  return brief.target_url?.trim() ? improve : create;
}

function pdpExistsLede(): string {
  return "A sua página do produto já existe. Falta a IA enxergar o que ela diz para quem ainda não sabe o seu nome. Não crie outra página.";
}

function catalogLaterSentence(brief: TrackLlmContentBriefForCopy, theme: string): string {
  if (brief.existing_content_surface) {
    return "Com o cadastro em ordem, melhore o guia no domínio da loja.";
  }
  if (brief.target_url?.trim()) {
    return "Com o cadastro em ordem, a IA passa a enxergar a ficha que já existe.";
  }
  return `Com o cadastro em ordem, crie uma página no seu domínio, fora da ficha do produto, para explicar ${theme}.`;
}

export function weekReasonFromBrief(brief: TrackLlmContentBriefForCopy): LlmWeekReason {
  if (isLlmWeekReason(brief.week_reason)) return brief.week_reason;
  return resolveLlmWeekReason({
    catalogFirst: Boolean(brief.catalog_first),
    storefrontIncoherent: Boolean(brief.incoherent),
    sourcesWithoutStore: Boolean(brief.sourcesWithoutStore),
    citationClient: 0,
    citationTotal: 0,
    split: null,
  });
}

export function buildDeterministicFounderActionCopy(brief: TrackLlmContentBriefForCopy): string {
  const theme = brief.theme?.trim() || "este produto";
  const reason = weekReasonFromBrief(brief);
  switch (reason) {
    case "catalog_first": {
      const what = catalogGapPhrase(brief.catalog_gaps ?? []);
      return sentenceJoin([
        `Complete no Shopify ${what} deste produto.`,
        "O cadastro é a base: sem isso, um guia novo não tem o que dizer.",
        catalogLaterSentence(brief, theme),
      ]);
    }
    case "incoherent":
      return pageVerb(
        brief,
        "A IA já fala de você, mas o preço ou a marca não batem com a loja. Crie uma página no seu site que deixe preço e marca iguais à loja.",
        "A IA já fala de você, mas o preço ou a marca não batem com a loja. Deixe o cadastro claro nesta página do produto.",
      );
    case "sources_without_store":
      return pageVerb(
        brief,
        "A IA já fala o nome, mas foi ler em outros sites. Publique uma página sua com os fatos da loja.",
        "A IA já fala o nome, mas foi ler em outros sites. Escreva nesta página do produto os fatos da loja.",
      );
  }
  if (brief.surface === "blog_indice_existente") {
    return "Crie um conteúdo neste blog para quem busca sem o nome da loja. Não invente outro endereço.";
  }
  if (brief.surface === "pdp_medida") {
    return brief.target_url?.trim()
      ? pdpExistsLede()
      : "Falta a IA enxergar uma página sua para quem ainda não sabe o seu nome.";
  }
  switch (reason) {
    case "named_only":
    case "category_partial":
      return pageVerb(
        brief,
        `Falta a IA enxergar uma página sua para quem busca ${theme} sem saber o nome da loja.`,
        `Nesta página do produto, escreva para quem busca ${theme} sem saber o nome da loja.`,
      );
    case "out":
    case "partial":
    case "article":
      return pageVerb(
        brief,
        `Falta a IA enxergar uma página sua sobre ${theme}.`,
        `Melhore esta página. Ela pode ser a fonte da IA sobre ${theme}.`,
      );
  }
}

export function buildTrackLlmSupportLine(brief: TrackLlmContentBriefForCopy): string {
  const reason = weekReasonFromBrief(brief);
  switch (reason) {
    case "catalog_first": {
      const what = catalogGapPhrase(brief.catalog_gaps ?? []);
      return `Por que isso importa: O cadastro é a base. Sem ${what} neste produto, a IA não tem fato seu para repetir — nem na ficha, nem num guia.`;
    }
    case "incoherent":
      return "Por que isso importa: A IA já te citou. O risco agora é repetir o preço ou a marca errados.";
    case "sources_without_store":
      return "Por que isso importa: A IA já sabe o nome. Sem uma página sua nas fontes, o comprador vai para o site que ela leu.";
    case "named_only":
      return "Por que isso importa: Quem já sabe o nome te encontra. Quem busca a categoria ainda ouve o concorrente.";
    case "category_partial":
      return "Por que isso importa: A IA já te acha quando digitam o nome. O furo é quem ainda não te conhece.";
    case "out":
    case "partial":
    case "article": {
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
  }
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
  if (trimmed.length < 40) return "copy_too_short";
  if (trimmed.length > 700) return "copy_too_long";
  if (/^```|[{}[\]]/.test(trimmed)) return "copy_not_plain_text";

  const targetUrl = brief.target_url?.trim() || null;
  const urls = urlsIn(trimmed);
  if (!targetUrl && urls.length > 0) return "invented_url";
  if (targetUrl && urls.some((url) => url !== targetUrl)) return "invented_url";

  const reason = weekReasonFromBrief(brief);
  if (targetUrl && reason !== "catalog_first" && /crie uma (página|landing)/i.test(trimmed)) {
    return "create_page_on_existing_url";
  }
  const folded = fold(trimmed);
  if (reason === "catalog_first" && !/\b(cadastro|shopify)\b/.test(folded)) {
    return "missing_catalog_first";
  }
  if (reason === "incoherent" && !/\b(preco|marca)\b/.test(folded)) return "missing_incoherent";
  if (reason === "sources_without_store" && !/\b(nome|fontes|outros sites)\b/.test(folded)) {
    return "missing_sources_without_store";
  }
  if ((reason === "category_partial" || reason === "named_only") && !/\bnome\b/.test(folded)) {
    return "missing_category_partial";
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
