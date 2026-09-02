import type { Payload, Summary, Usage } from "../contract.js";

/**
 * THE ONE DECISION: does this report carry design-system data, or not?
 *
 * The hackathon dashboard was written for a tool that always had a `KitSpec`, so every
 * kit panel read `payload.usage.…` and `summary.healthScore` unconditionally. This build
 * runs both ways — with a `KitAdapter` connected and without one — and the panels those
 * fields feed must be *absent* in the second case rather than drawn empty or drawn with
 * zeros, which would read as "your project uses none of the kit" instead of "nobody
 * measured".
 *
 * The decision lives here, once, for three reasons:
 *
 *  1. **It is all-or-nothing.** A report carrying `usage` but no `healthScore` is not a
 *     half-kit report, it is a bug upstream; returning `null` for it keeps the screens from
 *     rendering a ring around `undefined`. The engine emits the two together or not at all
 *     (`packages/fe-analyzer-engine/src/index.ts:222-238`), so the strict reading costs
 *     nothing and catches the case where that stops being true.
 *  2. **It is the seam the tests drive.** No DOM is available in this repo, so "the panels
 *     are hidden without an adapter" cannot be asserted by rendering. It is asserted here
 *     instead, as a pure function over a payload, plus the separate assertion that the
 *     panels' markup is in the built template at all.
 *  3. **The screens stay verbatim.** Destructuring `kit` gives the restored source markup
 *     the same identifiers it had when `usage` was mandatory.
 *
 * Types only, no DOM, no React — the arrangement `lib/a11y.ts` and `lib/shares.ts` already
 * use so the analyzer's own suite can import it.
 */
export interface KitData {
  readonly usage: Usage;
  /** 0-100. */
  readonly healthScore: number;
  /** Published beside the number, because a hidden derivation gets argued with. */
  readonly healthFormula: string;
  /** Share of style values written as a token rather than a literal, 0-1. */
  readonly tokenCoverage: number;
  readonly kitGaps: NonNullable<Summary["kitGaps"]>;
}

/** The adapter-domain slice of a payload, or `null` when the report carries none. */
export const kitDataOf = (payload: Payload): KitData | null => {
  const { usage, summary } = payload;
  if (
    usage === undefined ||
    summary.healthScore === undefined ||
    summary.healthFormula === undefined ||
    summary.tokenCoverage === undefined ||
    summary.kitGaps === undefined
  ) {
    return null;
  }

  return {
    usage,
    healthScore: summary.healthScore,
    healthFormula: summary.healthFormula,
    tokenCoverage: summary.tokenCoverage,
    kitGaps: summary.kitGaps,
  };
};
