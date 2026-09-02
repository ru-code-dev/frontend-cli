/**
 * Expressing an accessibility fix as an edit to the text that is actually on the line.
 * Ported verbatim from `hackathon2026/ds-analyzer/src/rules/a11y/source-edit.ts:1-101`.
 *
 * A finding becomes a diff when `actual` occurs verbatim in the source and `replaceWith` says
 * what to put there instead (`buildSnippet`). Most accessibility problems can never satisfy
 * that — the right alt text or the right label depends on what the control does — but a
 * handful are purely mechanical, and for those a reader should get a patch rather than a
 * paragraph.
 *
 * Everything here returns `null` the moment the source does not look the way it was expected
 * to. That asymmetry is the point: a missing diff costs the reader one manual edit, while a
 * wrong diff costs them their trust in every other diff in the report.
 */

export interface MechanicalFix {
  /** Text to find on the finding's line; must occur verbatim or no diff is produced. */
  readonly actual: string;
  /** What to put in its place. Empty string deletes. */
  readonly replaceWith: string;
}

/**
 * The exact text to delete in order to remove `attribute` from its line.
 *
 * Takes the preceding space with it when there is one, so dropping an attribute from the
 * middle of a tag yields `<ul className>` rather than `<ul  className>`. A diff nobody wants
 * to look at is a diff nobody applies.
 */
export const deletionOf = (sourceLine: string | undefined, attribute: string): string | null => {
  if (sourceLine === undefined) {
    return null;
  }

  const at = sourceLine.indexOf(attribute);

  if (at === -1) {
    return null;
  }

  return at > 0 && sourceLine[at - 1] === " " ? ` ${attribute}` : attribute;
};

/** `true` when a line-replacement fix is possible at all — the honest basis for `autoFixable`. */
export const occursOn = (sourceLine: string | undefined, text: string): boolean =>
  sourceLine?.includes(text) === true;

/**
 * Attribute forms these builders recognise. Anchored at the reported column, so a match is
 * the attribute the linter complained about and not a similarly-named one further along.
 */
const POSITIVE_TABINDEX = /^(tabIndex|tabindex)(\s*=\s*)(\{\s*\d+\s*\}|"\d+"|'\d+')/;
const AUTOFOCUS = /^(?:autoFocus|autofocus)(?:\s*=\s*(?:\{[^{}]*\}|"[^"]*"|'[^']*'))?/;

/** Quoting style of the value, so the replacement stays in the file's own idiom. */
const zeroLike = (value: string): string =>
  value.startsWith("{") ? "{0}" : value.startsWith('"') ? '"0"' : "'0'";

type FixBuilder = (sourceLine: string, at: number) => MechanicalFix | null;

/**
 * The plugin rules whose remedy is a single unambiguous edit.
 *
 * Deliberately two entries. `alt-text`, `label-has-associated-control` and the rest of the
 * table need a human to decide the words; inventing them here would produce patches that
 * compile and still say nothing.
 */
const BUILDERS: Readonly<Record<string, FixBuilder>> = {
  "tabindex-no-positive": (sourceLine, at) => {
    const match = POSITIVE_TABINDEX.exec(sourceLine.slice(at));
    const [text, name, equals, value] = match ?? [];

    if (text === undefined || name === undefined || equals === undefined || value === undefined) {
      return null;
    }

    return { actual: text, replaceWith: `${name}${equals}${zeroLike(value)}` };
  },
  "no-autofocus": (sourceLine, at) => {
    const [text] = AUTOFOCUS.exec(sourceLine.slice(at)) ?? [];

    if (text === undefined) {
      return null;
    }

    return { actual: at > 0 && sourceLine[at - 1] === " " ? ` ${text}` : text, replaceWith: "" };
  },
};

/**
 * A mechanical fix for a linter report, or `null` when the rule has none and when the source
 * at the reported position is not the shape the builder expects.
 *
 * @param column 1-based, as the linter reports it.
 */
export const lintSourceFix = (
  rule: string,
  sourceLine: string | undefined,
  column: number,
): MechanicalFix | null => {
  const build = BUILDERS[rule];

  if (build === undefined || sourceLine === undefined || column < 1 || column > sourceLine.length) {
    return null;
  }

  return build(sourceLine, column - 1);
};
