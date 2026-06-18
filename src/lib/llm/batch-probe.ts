export type BatchProbeItem = {
  index: number;
  text: string;
};

/**
 * Wraps a store-configured buyer prompt with Rint probe instructions.
 * The shopper text may not mention the internet — we always require a web-grounded answer.
 */
export function buildSingleProbeMessage(buyerPrompt: string): string {
  const question = buyerPrompt.trim();
  return `You are evaluating how AI assistants answer real shopper questions in Brazil.

Shopper question:
"${question}"

REQUIRED (do not skip):
1. Search the web for current information before answering — brands, stores, product pages, and market context.
2. Ground your answer in what you find online (Brazil-focused when relevant).
3. Name specific brands and stores; include website URLs when you find them.
4. Be assertive: compare players in the segment, not only generic advice.
5. Answer in the same language as the shopper question.

Reply as you would in chat after searching — 2–5 short paragraphs.`;
}

export function parseBatchProbeResponse(
  raw: string,
  expectedIndexes: number[],
): Map<number, string> {
  const map = new Map<number, string>();
  let jsonText = raw.trim();

  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    jsonText = fenced[1]!.trim();
  }

  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonText = objectMatch[0]!;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      responses?: Array<{ index?: number; answer?: string }>;
    };

    for (const row of parsed.responses ?? []) {
      if (typeof row.index !== "number" || typeof row.answer !== "string") continue;
      const answer = row.answer.trim();
      if (!answer) continue;
      map.set(row.index, answer);
    }
  } catch {
    return map;
  }

  void expectedIndexes;
  return map;
}

export async function probeBatchSequential(
  probe: (text: string) => Promise<{ text: string; model: string; mocked: boolean }>,
  items: BatchProbeItem[],
): Promise<{
  responses: Array<{ index: number; text: string }>;
  model: string;
  mocked: boolean;
}> {
  let mocked = false;
  let model = "mock";
  const responses: Array<{ index: number; text: string }> = [];

  for (const item of items) {
    const result = await probe(item.text);
    if (result.mocked) mocked = true;
    model = result.model;
    responses.push({ index: item.index, text: result.text });
  }

  return { responses, model, mocked };
}
