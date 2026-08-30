import postcss, { type AnyNode, type Declaration as PostcssDeclaration } from "postcss";
import postcssScss from "postcss-scss";

import type { StyleValue } from "../../domain/observations.ts";
import type { Limitation, StyleSyntax } from "../../domain/profile.ts";
import { extensionOf, isStyleModule } from "../../shared/path.ts";
import { sortStrings } from "../../shared/sort.ts";
import { hasUnresolvedSass, type ScssVariableIndex } from "./scss-variables.ts";

/**
 * Stylesheet collection. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/stylesheet.ts:1-169`.
 *
 * postcss is used purely as a parser: no plugins, no transforms, no compilation. What is
 * wanted from a `.scss` file is the set of declarations with their source coordinates, and
 * postcss gives exactly that while tolerating syntax it does not understand — which matters,
 * because a consumer's stylesheet may use any Sass feature at all.
 *
 * Declarations inside at-rules are collected too. `@media (min-width: 900px) { .card {
 * background: #ff1f78 } }` is the same hard-coded colour as outside the media query.
 */

const SCSS_EXTENSIONS = new Set([".scss", ".sass"]);

/** The style syntax label for a stylesheet path, used for `styleSyntaxes` reporting. */
export const styleSyntaxOf = (file: string): StyleSyntax => {
  const extension = extensionOf(file);
  const isModule = isStyleModule(file);

  if (SCSS_EXTENSIONS.has(extension)) {
    return isModule ? "scss-modules" : "scss";
  }
  if (extension === ".less") {
    return "less";
  }

  return isModule ? "css-modules" : "css";
};

/**
 * Bare class names in a selector.
 *
 * Pseudo-classes and their arguments are stripped first so that `.close:hover` and
 * `.item:not(.active)` both attribute to the class the developer wrote, not to the state.
 */
export const classNamesInSelector = (selector: string): string[] => {
  const withoutPseudoArguments = selector
    .replace(/::?[\w-]+\([^)]*\)/g, " ")
    .replace(/::?[\w-]+/g, " ");
  const names = [...withoutPseudoArguments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
    (match) => match[1] ?? "",
  );

  return sortStrings(new Set(names.filter((name) => name.length > 0)));
};

/**
 * Nearest enclosing rule selector, or `null` for declarations at the top level.
 *
 * Walks past at-rules so that a declaration inside `@media` still attributes to the class it
 * styles: a hard-coded colour behind a breakpoint is the same hard-coded colour.
 *
 * The casts step around postcss's `Document` node type, which is only produced by CSS-in-HTML
 * parsers and is not in the `AnyNode` union it would need to be in here.
 */
const selectorOf = (declaration: PostcssDeclaration): string | null => {
  let node = declaration.parent as AnyNode | undefined;

  while (node) {
    if (node.type === "rule") {
      return node.selector;
    }
    node = node.parent as AnyNode | undefined;
  }

  return null;
};

export interface StylesheetCollectionInput {
  /** Project-relative POSIX path. */
  readonly file: string;
  readonly content: string;
  /** `null` for plain CSS, which has no variables to resolve. */
  readonly variables: ScssVariableIndex | null;
}

export interface StylesheetCollectionResult {
  readonly styleValues: StyleValue[];
  readonly limitations: Limitation[];
}

/**
 * Parses one stylesheet into style values.
 *
 * A parse failure yields a limitation and an empty result. No stylesheet, however malformed,
 * is allowed to abort the scan — but neither is it allowed to disappear silently, because a
 * file that produced nothing looks exactly like a file that was clean.
 */
export const collectStylesheet = (input: StylesheetCollectionInput): StylesheetCollectionResult => {
  const { file, content, variables } = input;
  // `postcss.parse` is the CSS grammar. Sass has its own parser object, and comments alone
  // are enough to make the two disagree: `// …` is a fatal error in plain CSS.
  const parse = SCSS_EXTENSIONS.has(extensionOf(file)) ? postcssScss.parse : postcss.parse;
  const source = styleSyntaxOf(file);

  let root;
  try {
    root = parse(content, { from: file });
  } catch (error) {
    return {
      styleValues: [],
      limitations: [
        {
          file,
          line: null,
          reason: "parse-error",
          detail: error instanceof Error ? error.message : "postcss failed to parse the stylesheet",
        },
      ],
    };
  }

  const styleValues: StyleValue[] = [];
  const limitations: Limitation[] = [];

  root.walkDecls((declaration) => {
    // `$brand: #ff1f78` is a declaration to postcss. It is reported through the usage site's
    // rootCause instead, so that one variable does not become N findings.
    if (declaration.prop.startsWith("$") || declaration.prop.startsWith("--")) {
      return;
    }

    const selector = selectorOf(declaration);
    const authored = declaration.value;
    const resolution = variables?.resolveValue(file, authored) ?? null;
    const value = resolution?.value ?? authored;
    const dynamic = hasUnresolvedSass(value);

    if (dynamic) {
      limitations.push({
        file,
        line: declaration.source?.start?.line ?? null,
        reason: "dynamic-styles",
        detail: `${declaration.prop}: ${authored} — value depends on a Sass construct that is not a plain assignment`,
      });
    }

    styleValues.push({
      property: declaration.prop.toLowerCase(),
      value,
      authored: authored === value ? null : authored,
      file,
      line: declaration.source?.start?.line ?? 1,
      column: declaration.source?.start?.column ?? 1,
      source,
      selector,
      classNames: selector === null ? [] : classNamesInSelector(selector),
      important: declaration.important ?? false,
      dynamic,
      rootCause:
        resolution?.rootCause === undefined || resolution.rootCause === null
          ? null
          : {
              file: resolution.rootCause.file,
              line: resolution.rootCause.line,
              name: `$${resolution.rootCause.name}`,
            },
      appliedTo: null,
    });
  });

  return { styleValues, limitations };
};
