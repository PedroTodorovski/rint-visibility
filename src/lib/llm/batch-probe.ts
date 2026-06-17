export type BatchProbeItem = {
  index: number;
  text: string;
};

export function buildBatchProbeMessage(items: BatchProbeItem[]): string {
  const lines = items.map((item) => `${item.index}. ${item.text}`).join("\n");
  return `You answer buyer shopping questions the way a helpful AI assistant would in chat.

For each numbered prompt below, write a realistic short answer (2–4 sentences). Mention specific brands, stores, or product URLs when relevant.

Reply with ONLY valid JSON — no markdown fences, no commentary:
{"responses":[{"index":1,"answer":"..."}]}

Prompts:
${lines}`;
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

  return map;
}

export function batchMaxTokens(itemCount: number): number {
  return Math.min(8192, 512 + itemCount * 400);
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
