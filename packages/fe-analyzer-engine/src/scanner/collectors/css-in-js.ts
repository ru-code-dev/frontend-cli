import postcssScss from "postcss-scss";

import type { StyleValue } from "../../domain/observations.ts";
import type { Limitation, StyleSyntax } from "../../domain/profile.ts";
import { classNamesInSelector } from "./stylesheet.ts";

/**
 * CSS-in-JS collection. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/css-in-js.ts:1-163`.
 *
 * ``styled.div`…` `` and emotion's ``css`…` `` hold ordinary CSS inside a template literal,
 * so the parser problem is already solved — the interesting part is the interpolations.
 *
 * Each `${…}` is replaced by an inert identifier before parsing, which keeps the CSS
 * grammatically valid and keeps every subsequent character in the same place, so source
 * coordinates survive. A declaration whose value contains a placeholder is marked dynamic:
 * its literal parts are still checked, and the fact that part of it is unknowable is
 * reported rather than hidden.
 *
 * `postcss-scss` rather than plain postcss, because styled-components supports the same
 * `&:hover { … }` nesting Sass does.
 */

/** Identifier substituted for an interpolation. Deliberately unlike anything real. */
const placeholder = (index: number): string => `__dsx${index}__`;

const PLACEHOLDER_PATTERN = /__dsx\d+__/;

export interface TemplatePart {
  /** Literal text of one template span. */
  readonly text: string;
}

export interface CssInJsInput {
  readonly file: string;
  /** Literal spans, in order; there is always one more span than interpolation. */
  readonly parts: readonly TemplatePart[];
  /** 1-based line of the opening backtick. */
  readonly startLine: number;
  /** 1-based column of the opening backtick. */
  readonly startColumn: number;
  /** Styled component name, or the enclosing declaration name, for display. */
  readonly selectorName: string | null;
  readonly source: Extract<StyleSyntax, "styled-components" | "emotion">;
}

export interface CssInJsResult {
  readonly styleValues: StyleValue[];
  readonly limitations: Limitation[];
}

/** Joins literal spans with placeholders, reproducing the template's character layout. */
const stitch = (parts: readonly TemplatePart[]): string =>
  parts
    .map((part, index) => (index === 0 ? part.text : `${placeholder(index - 1)}${part.text}`))
    .join("");

/**
 * Extracts declarations from a tagged template.
 *
 * Coordinates are mapped back to the file: the first line of the template continues the line
 * the backtick is on, so its columns are offset; every later line stands alone.
 */
export const collectCssInJs = (input: CssInJsInput): CssInJsResult => {
  const { file, parts, startLine, startColumn, selectorName, source } = input;
  const text = stitch(parts);

  let root;
  try {
    root = postcssScss.parse(text, { from: file });
  } catch (error) {
    return {
      styleValues: [],
      limitations: [
        {
          file,
          line: startLine,
          reason: "parse-error",
          detail: `template literal is not parseable as CSS: ${error instanceof Error ? error.message : "unknown"}`,
        },
      ],
    };
  }

  const styleValues: StyleValue[] = [];
  const limitations: Limitation[] = [];

  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith("$")) {
      return;
    }

    const templateLine = declaration.source?.start?.line ?? 1;
    const templateColumn = declaration.source?.start?.column ?? 1;
    const dynamic =
      PLACEHOLDER_PATTERN.test(declaration.value) || PLACEHOLDER_PATTERN.test(declaration.prop);

    const line = startLine + templateLine - 1;
    const column = templateLine === 1 ? startColumn + templateColumn : templateColumn;

    if (dynamic) {
      limitations.push({
        file,
        line,
        reason: "dynamic-styles",
        detail: `${declaration.prop} depends on a runtime interpolation`,
      });
    }

    // A property name that is itself an interpolation carries no checkable design decision,
    // only the limitation recorded above.
    if (PLACEHOLDER_PATTERN.test(declaration.prop)) {
      return;
    }

    const selector =
      declaration.parent?.type === "rule"
        ? (declaration.parent as { selector: string }).selector
        : null;

    styleValues.push({
      property: declaration.prop.toLowerCase(),
      // Placeholders are stripped so the value shows only what was actually authored.
      value: declaration.value.replace(/__dsx\d+__/g, "").trim(),
      authored: dynamic ? declaration.value : null,
      file,
      line,
      column,
      source,
      selector: selector ?? selectorName,
      classNames: selector === null ? [] : classNamesInSelector(selector),
      important: declaration.important ?? false,
      dynamic,
      rootCause: null,
      appliedTo: null,
    });
  });

  return { styleValues, limitations };
};

/** Tag expressions that mean "this template is CSS". */
export const CSS_IN_JS_TAGS: ReadonlySet<string> = new Set([
  "styled",
  "css",
  "createGlobalStyle",
  "keyframes",
  "injectGlobal",
]);

/**
 * Classifies a tag expression's text.
 *
 * Covers `styled.div`, `styled(Button)`, `styled.div.attrs({…})`, bare `css` and emotion's
 * `styled` — the shapes differ but all of them start with a recognised root identifier.
 */
export const cssInJsTagInfo = (
  tagText: string,
): {
  readonly isCssInJs: boolean;
  readonly wraps: string | null;
  readonly hostTag: string | null;
} => {
  const root = /^([A-Za-z_$][\w$]*)/.exec(tagText)?.[1] ?? "";

  if (!CSS_IN_JS_TAGS.has(root)) {
    return { isCssInJs: false, wraps: null, hostTag: null };
  }

  const wrapped = /^styled\(\s*([A-Za-z_$][\w$.]*)\s*\)/.exec(tagText)?.[1] ?? null;
  const host = /^styled\.([a-z][\w-]*)/.exec(tagText)?.[1] ?? null;

  return { isCssInJs: true, wraps: wrapped, hostTag: host };
};
