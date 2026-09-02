import { Node, type JSDoc, type JSDocableNode } from "ts-morph";

import type { DocDto } from "../domain/components.ts";

/**
 * JSDoc extraction.
 *
 * Three tags carry meaning for the analyser:
 *
 *  - `@deprecated` — a consumer using this symbol has a migration to do. The kit uses it
 *    heavily (`Input`, `TextField.fullWidth`, `Tag` size `lg`).
 *  - `@inner`      — internal API. Slots marked `@inner` are implementation detail; a
 *    consumer targeting them is overriding private styling.
 *  - the description — surfaced verbatim in analyser findings, and it is written in
 *    Russian throughout the kit, so it must not be normalised or truncated.
 *
 * The kit also contains a misspelled `@depreated` (in `Tag/constants.ts`); it is
 * recognised so those entries are not silently treated as current API.
 */

const DEPRECATED_TAG_NAMES = ["deprecated", "depreated"] as const;
const INNER_TAG_NAMES = ["inner"] as const;

export const EMPTY_DOC: DocDto = {
  text: null,
  deprecated: false,
  deprecationNote: null,
  inner: false,
};

const isJsDocable = (node: Node): node is Node & JSDocableNode =>
  typeof (node as Partial<JSDocableNode>).getJsDocs === "function";

const normaliseText = (raw: string): string | null => {
  const text = raw.trim().replace(/\r\n/g, "\n");
  return text.length > 0 ? text : null;
};

const tagText = (doc: JSDoc, names: readonly string[]): string | null => {
  for (const tag of doc.getTags()) {
    if (names.includes(tag.getTagName())) {
      return normaliseText(tag.getCommentText() ?? "");
    }
  }
  return null;
};

const hasTag = (doc: JSDoc, names: readonly string[]): boolean =>
  doc.getTags().some((tag) => names.includes(tag.getTagName()));

/**
 * Resolves the node that actually owns the JSDoc.
 *
 * For `/** … *\/ export const Button = …` the comment is attached to the
 * `VariableStatement`, not to the `VariableDeclaration` the callers hold. Reading the
 * declaration alone silently loses the documentation of every `const`-declared
 * component in the kit — which is most of them.
 */
const docOwner = (node: Node): Node => {
  if (Node.isVariableDeclaration(node)) {
    const statement = node.getVariableStatement();
    if (statement && statement.getJsDocs().length > 0) {
      return statement;
    }
  }
  return node;
};

/**
 * Fallback parser for nodes TypeScript does not model as JSDoc-able.
 *
 * Object-literal property assignments are the important case: the kit documents
 * individual variant keys this way (`/** @depreated *\/ lg: 'lg'`), and those comments
 * are only reachable as raw leading trivia.
 */
const readLeadingJsDocComment = (node: Node): DocDto => {
  const comment = node
    .getLeadingCommentRanges()
    .map((range) => range.getText())
    .filter((text) => text.startsWith("/**"))
    .at(-1);

  if (comment === undefined) {
    return EMPTY_DOC;
  }

  const lines = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/, "").trim());

  const descriptionLines: string[] = [];
  let deprecated = false;
  let deprecationNote: string | null = null;
  let inner = false;

  for (const line of lines) {
    const tagMatch = /^@(\w+)\s*(.*)$/.exec(line);
    if (!tagMatch) {
      descriptionLines.push(line);
      continue;
    }

    const [, tagName = "", tagValue = ""] = tagMatch;
    if ((DEPRECATED_TAG_NAMES as readonly string[]).includes(tagName)) {
      deprecated = true;
      deprecationNote ??= normaliseText(tagValue);
    }
    if ((INNER_TAG_NAMES as readonly string[]).includes(tagName)) {
      inner = true;
    }
  }

  return {
    text: normaliseText(descriptionLines.join("\n")),
    deprecated,
    deprecationNote,
    inner,
  };
};

/** Reads the JSDoc attached to a node, returning {@link EMPTY_DOC} when there is none. */
export const readDoc = (node: Node | undefined): DocDto => {
  if (!node) {
    return EMPTY_DOC;
  }

  const owner = docOwner(node);

  const docs = isJsDocable(owner) ? owner.getJsDocs() : [];
  if (docs.length === 0) {
    return readLeadingJsDocComment(owner);
  }

  const descriptions: string[] = [];
  let deprecated = false;
  let deprecationNote: string | null = null;
  let inner = false;

  for (const doc of docs) {
    const description = normaliseText(doc.getDescription());
    if (description !== null) {
      descriptions.push(description);
    }
    if (hasTag(doc, DEPRECATED_TAG_NAMES)) {
      deprecated = true;
      deprecationNote ??= tagText(doc, DEPRECATED_TAG_NAMES);
    }
    if (hasTag(doc, INNER_TAG_NAMES)) {
      inner = true;
    }
  }

  return {
    text: descriptions.length > 0 ? descriptions.join("\n\n") : null,
    deprecated,
    deprecationNote,
    inner,
  };
};
