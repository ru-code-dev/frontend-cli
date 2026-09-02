/**
 * THE OUTPUT CONTRACT — one shape for every command, whether `-o` was given or not.
 *
 * The owner's law, stated in full: "All tools: `-o` must be optional; if not passed, same-shape
 * output that lists the saved files as absolute paths." Two halves, and this module is the part
 * of both that no command may spell for itself:
 *
 *  1. WHERE the files go when nobody said. Every default lives under one directory,
 *     {@link FG_OUT_DIR}, created on demand beside where the user ran — so a bare `fg --psvg
 *     11:10` leaves one predictable tree instead of scattering artifacts across the cwd, and
 *     `rm -rf fg-out` undoes an experiment completely. The individual paths under it belong to
 *     the feature packages (a pixso face and an HTML report have nothing to say to each other);
 *     the ROOT does not, because a second spelling of it is a second directory users have to
 *     learn.
 *  2. WHAT REACHES STDOUT when it is over. {@link emitPaths} is the single writer of it, and it
 *     writes nothing at all when stdout is a terminal — design U3. The human-readable list of
 *     the same paths is the summary block's, on stderr (`./ui.ts`), so a terminal shows them
 *     once and a pipe carries them bare.
 *
 * PURE, like the rest of this package: no `node:path`, no `node:fs`, no `process`. Joining and
 * resolving are the feature packages' business because they are the ones that already import
 * `node:path`; what is here is the vocabulary they must agree on.
 */
import type { CommandContext } from "./index.ts";

/**
 * The one directory every command writes into when `-o` is omitted, relative to
 * `CommandContext.cwd`.
 *
 * Not `.fg-out`, not `out`, not `dist`: a hidden directory is one a user does not find when the
 * card names it, and `out`/`dist` are names half the projects this tool is pointed at already
 * use for something else. `fg-out` is unambiguous about which tool made it.
 */
export const FG_OUT_DIR = "fg-out";

/** Everything a filename may safely contain here. Deliberately narrower than any real
 *  filesystem allows: this has to survive a shell copy-paste and a Windows checkout, and the
 *  set below is what does that everywhere. */
const SAFE_CHARS = /[^A-Za-z0-9._-]+/gu;

/** The longest a generated segment may be. 64 is comfortably under every filesystem's
 *  255-byte component limit even after the extension and the `.tmp` suffix core's atomic
 *  writer appends (`ru-code-packages/packages/pixso-core/src/io/artifacts.ts:55-58`). */
const MAX_SEGMENT = 64;

/**
 * An arbitrary identifier → ONE safe path segment. Total: every input produces a usable name.
 *
 * THE RULE, in the order it is applied, and it is documented because the card prints the result
 * and a user has to be able to predict it:
 *
 *  1. every run of characters outside `A-Z a-z 0-9 . _ -` becomes a single `-`
 *     — so a node guid `11:10` becomes `11-10`, and a name with spaces or slashes cannot
 *     escape the directory it was meant for;
 *  2. leading and trailing `-` and `.` are stripped — which is also what makes `..`, `.` and
 *     `.hidden` impossible to produce, so the result can never traverse or hide;
 *  3. the result is cut to {@link MAX_SEGMENT} characters, then step 2 is applied again so the
 *     cut cannot leave a trailing separator;
 *  4. if nothing survives, `fallback` is used.
 *
 * Step 1 collapses RUNS rather than mapping character-for-character on purpose: `a///b` and
 * `a-b` are the same file, and a name of thirty dashes is nobody's idea of a filename.
 */
export function safeSegment(raw: string, fallback: string): string {
  const trimmed = raw.replace(SAFE_CHARS, "-");
  const cleaned = strip(trimmed).slice(0, MAX_SEGMENT);
  const final = strip(cleaned);
  return final === "" ? fallback : final;
}

/** Steps 2 and 4 of the rule above, shared so the pre-cut and post-cut passes cannot differ. */
function strip(value: string): string {
  return value.replace(/^[-.]+/u, "").replace(/[-.]+$/u, "");
}

/**
 * U3, ENFORCED IN ONE PLACE — the paths a run wrote, on stdout, and ONLY when stdout is not a
 * terminal.
 *
 * The design's stream discipline is exact: "the absolute paths of written files, one per line,
 * for file formats — but path lines go to stdout ONLY when stdout is NOT a TTY (piped/CI), so a
 * terminal never shows them twice" (`ux-design.md` U3). A person watching a run reads the paths
 * in the summary block on stderr; a script reads them on stdout. Printing both to a terminal is
 * exactly the duplication the owner rejected.
 *
 * It lives here, and every command calls it, so the rule cannot be half-applied: a command that
 * wrote its own `if (!ctx.stdoutIsTTY)` would be a command that could get the predicate backwards.
 * One path per line, in the order given, each with a trailing newline — `xargs`-shaped.
 */
export function emitPaths(ctx: CommandContext, paths: readonly string[]): void {
  if (ctx.stdoutIsTTY) return;
  for (const path of paths) ctx.stdout(`${path}\n`);
}
