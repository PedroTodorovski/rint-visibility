/**
 * Shared shape for the per-run decision trace (the "X-ray" of a diagnostic).
 * Every pure decision function (computeTriage + the 4 track judges) appends
 * one DecisionStep per gate it evaluates, in the exact order it evaluates
 * them — mirroring rint-visibility/docs/MAPA-DO-DIAGNOSTICO.md. This is
 * purely additive observation: it never changes what a function decides,
 * only records why.
 */

export type DecisionStep = {
  /** Stable id, matches a row in the admin UI's translation table. */
  id: string;
  /** Plain-language question, no jargon — same voice as MAPA-DO-DIAGNOSTICO.md. */
  question: string;
  /** Whether this gate is the one that decided the outcome (first "yes" wins). */
  fired: boolean;
  /** Plain-language answer, e.g. "Sim", "Não", "2 de 5 perguntas". */
  answer: string;
  /** Raw values behind the answer, for anyone who wants the receipts. */
  data?: Record<string, unknown>;
  /** Optional extra context — why this gate matters, or why it was skipped. */
  note?: string;
};

export function step(
  id: string,
  question: string,
  fired: boolean,
  answer: string,
  data?: Record<string, unknown>,
  note?: string,
): DecisionStep {
  return { id, question, fired, answer, data, note };
}
