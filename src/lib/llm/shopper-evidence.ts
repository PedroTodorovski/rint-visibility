import { isLlmProviderId, type LlmProviderId } from "./types.js";

/** Job/query failed because no enabled provider returned shopper text. Not vendor-specific. */
export const SHOPPER_EVIDENCE_MISSING = "shopper_evidence_missing";

export type ShopperEvidenceInput = {
  rawText?: string | null;
  raw_text?: string | null;
  mocked?: boolean;
  follow_up?: boolean;
  provider?: string | null;
};

export function isUsableShopperEvidence(result: ShopperEvidenceInput): boolean {
  const text = (result.rawText ?? result.raw_text ?? "").trim();
  return text.length > 0 && result.mocked !== true;
}

export function assertUsableShopperEvidence(result: ShopperEvidenceInput): void {
  if (!isUsableShopperEvidence(result)) {
    throw new Error(SHOPPER_EVIDENCE_MISSING);
  }
}

export function shopperEvidenceProvider(execution: { provider?: string | null }): LlmProviderId {
  return isLlmProviderId(execution.provider) ? execution.provider : "gemini";
}

export function queryHasUsableShopperEvidence(query: {
  gemini_raw?: string | null;
  executions?: ShopperEvidenceInput[] | null;
}): boolean {
  const primary = (query.executions ?? []).filter((execution) => execution.follow_up !== true);
  if (primary.length > 0) {
    return primary.some((execution) => isUsableShopperEvidence(execution));
  }
  return isUsableShopperEvidence({ raw_text: query.gemini_raw ?? "", mocked: false });
}

export function queryCoversProviders(
  query: { executions?: ShopperEvidenceInput[] | null },
  providers: LlmProviderId[],
): boolean {
  if (providers.length === 0) return false;
  return providers.every((provider) =>
    (query.executions ?? []).some(
      (execution) =>
        execution.follow_up !== true &&
        shopperEvidenceProvider(execution) === provider &&
        isUsableShopperEvidence(execution),
    ),
  );
}
