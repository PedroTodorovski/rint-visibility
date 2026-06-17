import { detectCitation } from "../lib/citation.js";
import type { LlmClients, LlmProvider } from "../lib/llm/index.js";
import type { VisibilityRepositories } from "../repositories/index.js";
import type { ProductRow, PromptRow, StoreRow } from "../repositories/types.js";
import { aggregateScore, generateCatalogFixes, weekStartUtc } from "./scoring.js";

const PROVIDERS: LlmProvider[] = ["chatgpt", "gemini"];

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

    return {
      probeRunId: probeRun.id,
      weeklyScoreId: weeklyScore.id,
      citationsCount,
      citationSlotsTotal,
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
  provider: "chatgpt" | "gemini";
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

  const slots = prompts.flatMap((prompt) =>
    PROVIDERS.map((provider) => ({ prompt, provider })),
  );

  return Promise.all(
    slots.map(async ({ prompt, provider }, index) => {
      const client = llm[provider];
      let probe = await client.probe(prompt.prompt_text);

      if (probe.mocked || !probe.text) {
        const cited = index % 3 !== 0;
        probe = { text: mockResponse(store, cited), model: "mock", mocked: true };
      }

      const citation = detectCitation(probe.text, ctx);

      return {
        prompt_id: prompt.id,
        provider,
        cited: citation.cited,
        response_excerpt: citation.excerpt || probe.text.slice(0, 200),
        metadata: {
          match_signals: citation.matchSignals,
          matched_url: citation.matchedUrl,
          provider_model: probe.model,
          mocked: probe.mocked,
        },
      };
    }),
  );
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
