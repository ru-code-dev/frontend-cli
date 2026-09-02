/**
 * The eight escapes `compact` paints with, and the one that removes them again.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN IMPORT. `packages/cli-kit/src/ui.ts` owns the same table
 * for the terminal UI, but this package is PURE and dependency-free by contract (`types.ts`
 * header): it may not import cli-kit, and cli-kit may not import it, so the alternative to
 * eleven bytes of duplication would be a shared package holding eleven bytes. The codes are
 * spelled exactly as `ui.ts:162-176` spells them so a reader diffing the two sees zero
 * difference.
 *
 * COLOUR IS A PARAMETER, NEVER A LOOKUP. Nothing here reads `NO_COLOR`, `FORCE_COLOR` or
 * `isTTY` — cli-kit read them once and handed the answer down as `LintInput.color`. A second
 * reader could disagree with the first, and the design's promise (§2.4, U7) is that the
 * coloured and the plain document differ in escapes and in NOTHING else, which is only
 * checkable if one boolean decides the whole document.
 */

const ESC = "\u001b";

const CODE = {
  red: `${ESC}[0;31m`,
  green: `${ESC}[0;32m`,
  yellow: `${ESC}[0;33m`,
  blue: `${ESC}[0;34m`,
  magenta: `${ESC}[0;35m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
} as const;

export type Style = keyof typeof CODE;

const RESET = `${ESC}[0m`;

/**
 * `text` in `styles`, or `text` untouched when `color` is false.
 *
 * Empty input is returned as-is: an escape pair around nothing is invisible on screen but
 * would make the `NO_COLOR` parity check ("same text, no escapes") pass over a document that
 * has more bytes than it needs.
 */
export function paint(text: string, styles: readonly Style[], color: boolean): string {
  if (!color || text.length === 0 || styles.length === 0) return text;

  return `${styles.map((style) => CODE[style]).join("")}${text}${RESET}`;
}

/** Every CSI sequence, not just SGR — see {@link stripAnsi}'s callers. */
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "gu");

/**
 * Remove ANSI escapes.
 *
 * Used for two different jobs, and both are load-bearing. It SANITISES a finding's `actual`,
 * which is a fragment of the analysed project's source and can therefore contain anything its
 * author typed — an escape reaching the terminal verbatim could repaint or reposition the rest
 * of the report. And it is how the width arithmetic measures a row: `line.length` counts the
 * escapes, terminal columns do not.
 */
export function stripAnsi(text: string): string {
  return text.replace(CSI, "");
}

/** Printable width of a string that may already carry colour. */
export function plainWidth(text: string): number {
  return [...stripAnsi(text)].length;
}
