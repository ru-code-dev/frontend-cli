import type { Severity } from "../contract.js";

/**
 * The two orderings every screen sorts by, in one place with no DOM behind them.
 *
 * They were defined in `data.ts` and `model.ts` respectively, which both reach for the
 * browser and so cannot be imported by the analyzer's test suite. Sitting here — types only,
 * like `contract.ts` — they are testable from outside the bundle, and the modules that used
 * to own them re-export them, so nothing that reads them had to change.
 */

/** Mirror of the analyzer's health weights; used only for ordering, never recomputed into a score. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 3,
  warning: 1,
  info: 0.25,
  candidate: 0,
};

/** Worst first. Lower is more severe, so a plain `<` comparison reads correctly. */
export const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  candidate: 3,
};
