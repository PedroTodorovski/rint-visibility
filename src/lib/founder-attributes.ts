/**
 * Founder-facing product chips. Shopify metafields and Gemini `atributos` both
 * arrive as strings; only short human characteristics belong on the mosaic.
 */

const MAX_CHARS = 72;
const MAX_WORDS = 6;
const MACHINE_KEY =
  /html|image|img|gid|file|video|media|json|svg|icon|metaobject|rich[_-]?text|related products|age group|rating count/i;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function isHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function richTextPlain(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map(richTextPlain).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;
  if (record.children) return richTextPlain(record.children);
  return "";
}

function humanKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isListingMetafieldKey(key: string): boolean {
  const folded = fold(key);
  if (/\bsku\b/.test(folded)) return true;
  if (/quantidade/.test(folded)) return true;
  if (/unitario/.test(folded)) return true;
  return false;
}

function isListingNoise(value: string): boolean {
  const folded = fold(value);
  if (folded.startsWith("/")) return true;
  if (/^(new|novo|nova)$/.test(folded)) return true;
  if (/\bsku\b/.test(folded) && /:/.test(value)) return true;
  if (/related products|age group|rating count/.test(folded)) return true;
  if (/quantidade/.test(folded) && /unidade/.test(folded)) return true;
  if (/unitario/.test(folded)) return true;
  return false;
}

function acceptChip(value: string): string[] {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  if (trimmed === "true" || trimmed === "false") return [];
  if (trimmed.includes("gid://shopify")) return [];
  if (isHtml(trimmed)) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return [];
  if (/[[\]{}]/.test(trimmed)) return [];
  if (trimmed.length > MAX_CHARS || wordCount(trimmed) > MAX_WORDS) return [];
  if (isListingNoise(trimmed)) return [];
  return [trimmed];
}

/** Comma+space / semicolon / newline lists. Bare comma stays (pt-BR decimals). */
function splitShortList(value: string): string[] {
  if (!/[;\n]/.test(value) && !/, /.test(value)) return [value];
  const parts = value
    .split(/\s*[;\n]\s*|\s*,\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [value];
  if (parts.some((part) => part.length > 48 || wordCount(part) > 8)) return [value];
  return parts;
}

function labeled(key: string, value: string): string[] {
  const chips = acceptChip(value);
  if (chips.length === 0) return [];
  if (!key) return chips;
  const prefix = humanKey(key);
  if (!prefix) return chips;
  if (fold(chips[0] ?? "").startsWith(fold(prefix))) return chips;
  return acceptChip(`${prefix}: ${chips[0]}`);
}

function expandJson(parsed: unknown, key: string): string[] {
  if (typeof parsed === "string") return expandAttributeSource(key ? `${key}: ${parsed}` : parsed);
  if (typeof parsed === "number" || typeof parsed === "boolean") {
    return labeled(key, String(parsed));
  }
  if (Array.isArray(parsed)) {
    if (parsed.every((item) => typeof item === "string")) {
      return parsed.flatMap((item) => acceptChip(item));
    }
    return parsed.flatMap((item) => expandJson(item, key));
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (record.type === "root" || record.children) {
      return labeled(key, richTextPlain(parsed));
    }
    return [];
  }
  return [];
}

function lookslikeFieldKey(key: string): boolean {
  if (!key || key.length > 48) return false;
  if (key.startsWith("{") || key.startsWith("[")) return false;
  return /^[A-Za-z][A-Za-z0-9_ -]*$/.test(key);
}

export function expandAttributeSource(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return expandJson(JSON.parse(trimmed) as unknown, "");
    } catch {
      return [];
    }
  }

  const sep = trimmed.indexOf(": ");
  if (sep > 0) {
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 2).trim();
    if (lookslikeFieldKey(key)) {
      if (MACHINE_KEY.test(key) || isListingMetafieldKey(key)) return [];
      if (value.startsWith("{") || value.startsWith("[")) {
        try {
          return expandJson(JSON.parse(value) as unknown, key);
        } catch {
          return [];
        }
      }
      if (value.includes("gid://shopify")) return [];
      if (isHtml(value)) return labeled(key, stripHtml(value));
      const parts = splitShortList(value);
      if (parts.length > 1) return parts.flatMap((part) => labeled(key, part));
      return labeled(key, value);
    }
  }

  if (trimmed.includes("gid://shopify")) return [];
  if (isHtml(trimmed)) return acceptChip(stripHtml(trimmed));
  const parts = splitShortList(trimmed);
  if (parts.length > 1) return parts.flatMap((part) => acceptChip(part));
  return acceptChip(trimmed);
}

export function founderFacingAttributes(
  raws: readonly string[],
  options?: { dropNames?: readonly (string | null | undefined)[] },
): string[] {
  const dropped = new Set(
    (options?.dropNames ?? []).map((name) => fold(name ?? "")).filter((name) => name.length >= 2),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of raws) {
    if (typeof raw !== "string") continue;
    for (const item of expandAttributeSource(raw)) {
      const folded = fold(item);
      if (!folded || seen.has(folded)) continue;
      if (dropped.has(folded)) continue;
      seen.add(folded);
      out.push(item);
    }
  }
  return out;
}
