import type { ProductRow } from "../repositories/types.js";
import type { RevenueGapSnapshot } from "./revenue-gap-engine.js";

export type TriageOwner = "narrative" | "product_pricing";

export type DualTrackItem = {
  text: string;
  domain?: string;
  actionType?: string;
};

export type SkuDualTrack = {
  skuRefId: string | null;
  skuLabel: string;
  lacunaRs: number;
  custoCompensar: number;
  track1: DualTrackItem[];
  track2: DualTrackItem[];
  triageOwner: TriageOwner;
};

export type DualTrackOutput = {
  tracks: SkuDualTrack[];
  triageOwner: TriageOwner;
};

type CompetitorFromResult = {
  name: string;
  url?: string;
  type: string;
};

export function deriveTriageOwner(
  results: Array<{ metadata?: Record<string, unknown> }>,
): TriageOwner {
  const productMismatch = results.some((r) => {
    const code = r.metadata?.why_code;
    return code === "uncited_prompt_mismatch" || code === "pdp_missing";
  });
  return productMismatch ? "product_pricing" : "narrative";
}

export function generateDualTracks(
  products: ProductRow[],
  gap: RevenueGapSnapshot,
  results: Array<{ cited: boolean; metadata?: Record<string, unknown> }>,
): DualTrackOutput {
  const triageOwner = deriveTriageOwner(results);
  const competitorDomains = extractTopCompetitorDomains(results, 5);

  const heroProducts = products.length > 0 ? products.slice(0, 3) : [];

  if (heroProducts.length === 0) {
    return {
      tracks: [],
      triageOwner: deriveTriageOwner(results),
    };
  }
  const perSkuLacuna = gap.lacunaRs / heroProducts.length;
  const perSkuCusto = gap.custoCompensar / heroProducts.length;

  const tracks: SkuDualTrack[] = heroProducts.map((product) => {
    const skuLabel = product.title ?? product.url ?? "Hero SKU";

    const track1: DualTrackItem[] = competitorDomains.map((domain) => ({
      domain,
      text: `${domain} cita concorrente, não você — guest post, review patrocinado ou parceria editorial esta semana`,
      actionType: "authority",
    }));

    if (track1.length === 0) {
      track1.push({
        text: "Identificar domínios que citam concorrentes nas respostas Gemini — outreach de autoridade esta semana",
        actionType: "authority",
      });
    }

    const track2: DualTrackItem[] = [
      {
        text: `Realocar budget para compensar R$${Math.round(perSkuCusto)}/mês (Conta 2) via catalog sales / PMax`,
        actionType: "paid",
      },
      {
        text: "Testar creative UGC com hook de custo-benefício alinhado ao cluster",
        actionType: "paid",
      },
      {
        text: "Meta: recuperar citações equivalentes em 30 dias — KPI de share, não ROAS na fórmula",
        actionType: "paid",
      },
    ];

    return {
      skuRefId: product.id ?? null,
      skuLabel,
      lacunaRs: perSkuLacuna,
      custoCompensar: perSkuCusto,
      track1,
      track2,
      triageOwner,
    };
  });

  return { tracks, triageOwner };
}

function extractTopCompetitorDomains(
  results: Array<{ metadata?: Record<string, unknown> }>,
  limit: number,
): string[] {
  const counts = new Map<string, number>();

  for (const result of results) {
    const competitors = result.metadata?.competitors as CompetitorFromResult[] | undefined;
    if (!Array.isArray(competitors)) continue;

    for (const comp of competitors) {
      if (comp.type === "domain" && comp.url) {
        try {
          const host = new URL(comp.url).hostname.replace(/^www\./, "");
          counts.set(host, (counts.get(host) ?? 0) + 1);
        } catch {
          /* skip */
        }
      } else if (comp.name) {
        counts.set(comp.name, (counts.get(comp.name) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}
