import type { ResultWithPrompt } from "../repositories/types.js";

export type ProbeSlotDelta = {
  prompt_id: string;
  prompt_text: string;
  from_cited: boolean;
  to_cited: boolean;
  changed: boolean;
};

export type ProbeCompareOutcome = {
  from_run_id: string;
  to_run_id: string;
  from_cited: number;
  to_cited: number;
  from_total: number;
  to_total: number;
  cited_delta: number;
  slots: ProbeSlotDelta[];
};

export function compareProbeResults(
  fromRunId: string,
  toRunId: string,
  fromResults: ResultWithPrompt[],
  toResults: ResultWithPrompt[],
): ProbeCompareOutcome {
  const fromByPrompt = new Map(fromResults.map((r) => [r.prompt_id, r]));
  const toByPrompt = new Map(toResults.map((r) => [r.prompt_id, r]));

  const promptIds = [...new Set([...fromByPrompt.keys(), ...toByPrompt.keys()])];

  const slots: ProbeSlotDelta[] = promptIds.map((promptId) => {
    const from = fromByPrompt.get(promptId);
    const to = toByPrompt.get(promptId);
    const fromCited = from?.cited ?? false;
    const toCited = to?.cited ?? false;
    return {
      prompt_id: promptId,
      prompt_text: to?.prompt_text ?? from?.prompt_text ?? "",
      from_cited: fromCited,
      to_cited: toCited,
      changed: fromCited !== toCited,
    };
  });

  const fromCited = fromResults.filter((r) => r.cited).length;
  const toCited = toResults.filter((r) => r.cited).length;

  return {
    from_run_id: fromRunId,
    to_run_id: toRunId,
    from_cited: fromCited,
    to_cited: toCited,
    from_total: fromResults.length,
    to_total: toResults.length,
    cited_delta: toCited - fromCited,
    slots,
  };
}
