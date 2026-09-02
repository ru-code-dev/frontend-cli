/**
 * THE OUTPUT CONTRACT — one shape for every command, whether `-o` was given or not.
 *
 * The owner's law, stated in full: "All tools: `-o` must be optional; if not passed, same-shape
 * output that lists the saved files as absolute paths." Two halves, and this module is the part
 * of both that no command may spell for itself:
 *
 *  1. WHERE the files go when nobody said. Every default lives under one directory,
 *     {@link FE_OUT_DIR}, created on demand beside where the user ran — so a bare `fe --psvg
 *     11:10` leaves one predictable tree instead of scattering artifacts across the cwd, and
 *     `rm -rf fe-out` undoes an experiment completely. The individual paths under it belong to
 *     the feature packages (a pixso face and an HTML report have nothing to say to each other);
 *     the ROOT does not, because a second spelling of it is a second directory users have to
 *     learn.
 *  2. WHAT the run says at the end. {@link resultOf} is the single builder for it: a headline
 *     sentence, then one ABSOLUTE path per line, one line per file actually written. Every
 *     command hands the result to `ctx.stdout` and to `ctx.ui.done`, so the card a user watches
 *     and the bytes a script reads carry the same list, in the same order, in both languages.
 *
 * PURE, like the rest of this package: no `node:path`, no `node:fs`, no `process`. Joining and
 * resolving are the feature packages' business because they are the ones that already import
 * `node:path`; what is here is the vocabulary they must agree on.
 */
import type { Localized } from "./index.ts";

/**
 * The one directory every command writes into when `-o` is omitted, relative to
 * `CommandContext.cwd`.
 *
 * Not `.fe-out`, not `out`, not `dist`: a hidden directory is one a user does not find when the
 * card names it, and `out`/`dist` are names half the projects this tool is pointed at already
 * use for something else. `fe-out` is unambiguous about which tool made it.
 */
export const FE_OUT_DIR = "fe-out";

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
 * THE RESULT MESSAGE — the headline, then one absolute path per line.
 *
 * The paths are NOT folded into the sentence, and that is the whole design. A sentence with a
 * path in it is unreadable at five paths and unpipeable at one; a bare list under a sentence is
 * readable at any count and `tail -n +2 | xargs` works on it. It is also what lets the final
 * card (`./ui.ts`'s `card`) show the files as a column instead of a wrapped paragraph — `card`
 * honours the newlines this builder puts in.
 *
 * Both languages are built from the SAME path list, so the two can never disagree about what
 * was written. An empty list is legal and yields just the headline: a command that wrote
 * nothing still ends with its sentence.
 */
export function resultOf(headline: Localized, paths: readonly string[]): Localized {
  const tail = paths.length === 0 ? "" : `\n${paths.join("\n")}`;
  return { ru: `${headline.ru}${tail}`, en: `${headline.en}${tail}` };
}
