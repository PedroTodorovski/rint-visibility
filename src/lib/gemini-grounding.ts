export type GroundingChunk = {
  uri: string;
  title?: string;
};

export type GeminiGroundingMetadata = {
  chunks: GroundingChunk[];
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
};

export function extractGroundingMetadata(data: GeminiApiResponse): GeminiGroundingMetadata {
  const meta = data.candidates?.[0]?.groundingMetadata;
  const chunks: GroundingChunk[] = [];

  for (const chunk of meta?.groundingChunks ?? []) {
    const uri = chunk.web?.uri?.trim();
    if (!uri) continue;
    chunks.push({ uri, title: chunk.web?.title });
  }

  return { chunks };
}

export function groundingUrlsToCitationText(chunks: GroundingChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks.map((c) => `${c.title ?? "Source"}: ${c.uri}`).join("\n");
}
