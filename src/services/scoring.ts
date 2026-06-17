import type { ProductRow, PromptRow, StoreRow } from "../repositories/types.js";
import type { CatalogFix, ResultProvider } from "../repositories/types.js";

export type FailedSlot = {
  prompt: PromptRow;
  provider: ResultProvider;
};

export function generateCatalogFixes(
  products: ProductRow[],
  failedSlots: FailedSlot[],
): CatalogFix[] {
  const fixes: CatalogFix[] = [];
  const usedTypes = new Set<string>();

  const keywords = [
    ...new Set(
      failedSlots.flatMap((s) =>
        s.prompt.prompt_text
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4)
          .slice(0, 5),
      ),
    ),
  ].slice(0, 6);

  const keywordPhrase = keywords.length > 0 ? keywords.join(", ") : "termos que compradores usam na IA";

  for (const product of products) {
    if (fixes.length >= 3) break;

    const productLabel = product.title ?? product.url;

    if (!usedTypes.has(`${product.id}:title`)) {
      fixes.push({
        type: "title",
        product_url: product.url,
        product_title: productLabel,
        suggestion: `Inclua no título atributos buscados em IA: ${keywordPhrase}. Ex.: "${productLabel} — ${keywords[0] ?? "benefício principal"}"`,
        reason: "Títulos com termos de intenção de compra aumentam citações em respostas de IA.",
      });
      usedTypes.add(`${product.id}:title`);
    }

    if (fixes.length >= 3) break;

    if (!usedTypes.has(`${product.id}:description`)) {
      fixes.push({
        type: "description",
        product_url: product.url,
        product_title: productLabel,
        suggestion: `Expanda a descrição respondendo: "${failedSlots[0]?.prompt.prompt_text ?? "o que o comprador pergunta"}". Use linguagem natural com ${keywordPhrase}.`,
        reason: "Descrições que espelham perguntas reais de compradores melhoram recall nos LLMs.",
      });
      usedTypes.add(`${product.id}:description`);
    }

    if (fixes.length >= 3) break;

    if (!usedTypes.has(`${product.id}:schema`)) {
      fixes.push({
        type: "schema",
        product_url: product.url,
        product_title: productLabel,
        suggestion: `Adicione JSON-LD Product com name, description, url (${product.url}), brand e offers. Crawlers de IA usam schema estruturado.`,
        reason: "Schema Product ajuda modelos com grounding a associar URL e atributos do produto.",
      });
      usedTypes.add(`${product.id}:schema`);
    }
  }

  return fixes.slice(0, 3);
}

export function weekStartUtc(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function aggregateScore(
  results: Array<{ cited: boolean }>,
  promptCount: number,
  providerCount: number,
) {
  const citationSlotsTotal = promptCount * providerCount;
  const citationsCount = results.filter((r) => r.cited).length;
  const scorePct =
    citationSlotsTotal > 0
      ? Math.round((citationsCount / citationSlotsTotal) * 10000) / 100
      : 0;

  return { citationSlotsTotal, citationsCount, scorePct, promptsTotal: promptCount };
}
