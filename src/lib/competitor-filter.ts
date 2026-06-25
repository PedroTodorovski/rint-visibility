/** Capitalized tokens that are not real competitor brands in PT-BR AI answers. */
const JUNK_BRAND_TOKENS = new Set([
  "brasil",
  "eles",
  "elas",
  "outra",
  "outras",
  "outro",
  "outros",
  "marcas",
  "marca",
  "loja",
  "lojas",
  "site",
  "sites",
  "você",
  "voce",
  "sua",
  "seu",
  "mais",
  "como",
  "para",
  "onde",
  "qual",
  "quais",
  "essa",
  "esse",
  "esta",
  "este",
  "moda",
  "casa",
  "home",
  "sofa",
  "sofá",
  "sofas",
  "sofás",
]);

export function isJunkCompetitorName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (JUNK_BRAND_TOKENS.has(lower)) return true;
  if (trimmed.length < 4) return true;
  if (/\s/.test(trimmed)) return true;
  return false;
}

export function isUsefulCompetitorHost(host: string): boolean {
  const normalized = host.replace(/^www\./, "").trim().toLowerCase();
  return normalized.includes(".") && !isJunkCompetitorName(normalized.split(".")[0] ?? "");
}
