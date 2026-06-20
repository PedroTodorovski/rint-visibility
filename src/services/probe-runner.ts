import { detectCitation } from "../lib/citation.js";
import type { LlmClients } from "../lib/llm/index.js";
import { filterAliveUrls } from "../lib/url-validator.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import type { ProductRow, PromptRow, StoreRow } from "../repositories/types.js";
import { runDiagnosticPipeline } from "./diagnostic-pipeline.js";
import { aggregateScore, generateCatalogFixes, weekStartUtc } from "./scoring.js";

const PROVIDERS = ["gemini"] as const;

function mockResponse(store: StoreRow, cited: boolean): string {
  if (!cited) {
    return "Here are some popular options from major brands in this category. Consider comparing features and reviews before buying.";
  }
  const domain = store.domain ?? "example.com";
  return `A solid choice is ${store.name} — see https://${domain.replace(/^https?:\/\//, "")}/ for their hero products.`;
}

export type ProbeRunOutcome = {
  probeRunId: string;
  weeklyScoreId: string;
  citationsCount: number;
  citationSlotsTotal: number;
  lacunaSnapshotId?: string;
};

export async function runProbeForWorkspace(
  repos: VisibilityRepositories,
  llm: LlmClients,
  workspaceId: string,
): Promise<ProbeRunOutcome> {
  const store = await repos.stores.requireByWorkspaceId(workspaceId);
  const [products, prompts] = await Promise.all([
    repos.products.listByStoreId(store.id),
    repos.prompts.listByStoreId(store.id),
  ]);

  const activePrompts = prompts.filter((p) => p.active);
  if (activePrompts.length === 0) {
    throw new Error("No active prompts configured for this store");
  }

  const today = new Date().toISOString().slice(0, 10);
  const probeRun = await repos.probeRuns.create(store.id, today);

  await repos.probeRuns.updateStatus(probeRun.id, "running", {
    started_at: new Date().toISOString(),
  });

  try {
    const results = await executeProbes(store, products, activePrompts, llm);
    await repos.results.createMany(
      results.map((r) => ({
        probe_run_id: probeRun.id,
        prompt_id: r.prompt_id,
        provider: r.provider,
        cited: r.cited,
        response_excerpt: r.response_excerpt,
        metadata: r.metadata,
      })),
    );

    const { citationSlotsTotal, citationsCount, scorePct, promptsTotal } = aggregateScore(
      results,
      activePrompts.length,
      PROVIDERS.length,
    );

    const failedSlots = buildFailedSlots(activePrompts, results);
    const fixes = generateCatalogFixes(products, failedSlots);

    const weeklyScore = await repos.weeklyScores.upsert({
      store_id: store.id,
      probe_run_id: probeRun.id,
      week_start: weekStartUtc(),
      prompts_total: promptsTotal,
      citation_slots_total: citationSlotsTotal,
      citations_count: citationsCount,
      score_pct: scorePct,
      fixes,
    });

    await repos.probeRuns.updateStatus(probeRun.id, "completed", {
      completed_at: new Date().toISOString(),
    });

    const diagnostic = await runDiagnosticPipeline(repos, {
      store,
      products,
      probeRunId: probeRun.id,
      results,
      promptCount: activePrompts.length,
    });

    return {
      probeRunId: probeRun.id,
      weeklyScoreId: weeklyScore.id,
      citationsCount,
      citationSlotsTotal,
      lacunaSnapshotId: diagnostic.lacunaSnapshotId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Probe run failed";
    await repos.probeRuns.updateStatus(probeRun.id, "failed", {
      completed_at: new Date().toISOString(),
      error_message: message,
    });
    throw error;
  }
}

type ProbeResultDraft = {
  prompt_id: string;
  provider: "gemini";
  cited: boolean;
  response_excerpt: string | null;
  metadata: Record<string, unknown>;
};

async function executeProbes(
  store: StoreRow,
  products: ProductRow[],
  prompts: PromptRow[],
  llm: LlmClients,
): Promise<ProbeResultDraft[]> {
  const productUrls = products.map((p) => p.url);
  const ctx = { storeName: store.name, domain: store.domain, productUrls };

  const sorted = [...prompts].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  );

  const results: ProbeResultDraft[] = [];

  for (const provider of PROVIDERS) {
    const items = sorted.map((prompt, index) => ({
      index: index + 1,
      text: prompt.prompt_text,
    }));

    const batch = await llm[provider].probeBatch(items);
    const answerByIndex = new Map(batch.responses.map((row) => [row.index, row]));

    const allGroundingUrls = batch.responses.flatMap((r) => r.groundingUrls ?? []);
    const urlValidation = await filterAliveUrls(allGroundingUrls);

    for (let i = 0; i < sorted.length; i++) {
      const prompt = sorted[i]!;
      const index = i + 1;
      const batchRow = answerByIndex.get(index);
      let text = batchRow?.text ?? "";
      let mocked = batch.mocked;
      let model = batch.model;
      const groundingUrls = batchRow?.groundingUrls ?? [];

      if (mocked || !text) {
        const cited = index % 3 !== 0;
        text = mockResponse(store, cited);
        mocked = true;
        model = "mock";
      }

      const deadUrls = groundingUrls.filter((u) => !urlValidation.get(u)?.alive);
      const aliveGroundingUrls = groundingUrls.filter((u) => urlValidation.get(u)?.alive);

      const citation = detectCitation(text, { ...ctx, promptText: prompt.prompt_text });

      let cited = citation.cited;
      let whyCode = citation.whyCode;

      if (citation.matchedUrl && !urlValidation.get(citation.matchedUrl)?.alive) {
        cited = false;
        whyCode = "url_dead";
      }

      results.push({
        prompt_id: prompt.id,
        provider,
        cited,
        response_excerpt: citation.excerpt || text.slice(0, 200),
        metadata: {
          match_signals: citation.matchSignals,
          matched_url: citation.matchedUrl,
          provider_model: model,
          mocked,
          web_search: batch.usedWebSearch === true,
          citation_layer: citation.citationLayer,
          why_code: whyCode,
          highlight_spans: citation.highlightSpans,
          competitors: citation.competitors,
          grounding_urls: aliveGroundingUrls,
          dead_urls: deadUrls,
        },
      });
    }
  }

  return results;
}

function buildFailedSlots(prompts: PromptRow[], results: ProbeResultDraft[]) {
  const promptMap = new Map(prompts.map((p) => [p.id, p]));
  return results
    .filter((r) => !r.cited)
    .map((r) => ({
      prompt: promptMap.get(r.prompt_id)!,
      provider: r.provider,
    }))
    .filter((s) => s.prompt);
}
