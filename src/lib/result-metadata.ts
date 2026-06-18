export type CitationLayer = "product" | "domain" | "brand" | "none";

export type WhyCode =
  | "cited_brand"
  | "cited_domain"
  | "cited_pdp"
  | "uncited_competitor"
  | "uncited_generic"
  | "uncited_prompt_mismatch"
  | "uncited_no_mention";

export type HighlightSpan = {
  start: number;
  end: number;
  kind: "url" | "domain" | "brand";
};

export type CompetitorMention = {
  name: string;
  url?: string;
  type: "domain" | "brand";
};

export type ResultMetadataV2 = {
  match_signals: string[];
  matched_url: string | null;
  provider_model: string;
  mocked: boolean;
  web_search: boolean;
  citation_layer: CitationLayer;
  why_code: WhyCode;
  highlight_spans: HighlightSpan[];
  competitors: CompetitorMention[];
};

export function citationLayerFromSignals(signals: string[]): CitationLayer {
  if (signals.includes("url_match")) return "product";
  if (signals.some((s) => s === "domain_match" || s === "domain_text_match")) return "domain";
  if (signals.some((s) => s === "brand_match" || s === "brand_token_match")) return "brand";
  return "none";
}

export function whyCodeFromCitation(
  cited: boolean,
  layer: CitationLayer,
  competitors: CompetitorMention[],
  promptText: string,
  storeName: string,
  responseText: string,
): WhyCode {
  if (cited) {
    if (layer === "product") return "cited_pdp";
    if (layer === "domain") return "cited_domain";
    return "cited_brand";
  }

  if (competitors.length > 0) return "uncited_competitor";

  const primaryToken = storeName.trim().split(/\s+/)[0] ?? "";
  const promptLower = promptText.toLowerCase();
  const storeInPrompt =
    promptLower.includes(storeName.toLowerCase()) ||
    (primaryToken.length >= 4 && promptLower.includes(primaryToken.toLowerCase()));

  const genericMarkers = [
    "melhor ",
    "onde comprar",
    "recomendação",
    "marcas de",
    "pela internet",
    "apartamento",
    "sala compacta",
    "direto da fábrica",
  ];
  const promptLooksGeneric =
    !storeInPrompt && genericMarkers.some((marker) => promptLower.includes(marker));

  if (promptLooksGeneric) return "uncited_prompt_mismatch";

  const genericResponseMarkers = [
    "popular brands",
    "major brands",
    "várias marcas",
    "diversas opções",
    "compare features",
    "mercado brasileiro",
  ];
  const responseLower = responseText.toLowerCase();
  if (genericResponseMarkers.some((marker) => responseLower.includes(marker))) {
    return "uncited_generic";
  }

  return "uncited_no_mention";
}
