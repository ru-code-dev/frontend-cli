import { Node, type Project, type SourceFile, SyntaxKind } from "ts-morph";

import { looksLikeStyleObject } from "../../css/properties.ts";
import type {
  Declaration,
  ImportRecord,
  JsxElement,
  ReExportRecord,
  StyleRef,
  StyleValue,
} from "../../domain/observations.ts";
import type { Limitation } from "../../domain/profile.ts";
import { extensionOf, isStyleModule } from "../../shared/path.ts";
import { compareStrings, sortStrings } from "../../shared/sort.ts";
import type { Resolution } from "../resolve.ts";
import { collectCssInJs, cssInJsTagInfo } from "./css-in-js.ts";
import { collectStyleObject } from "./style-object.ts";

/**
 * TypeScript and JSX collection. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/typescript.ts:1-968`. Two changes, both
 * consequences of what this package does not carry: the emitted `Declaration` no longer has
 * a `kitComponentsUsed` field (source line 934 — it was filled by a kit-closure pass), and
 * the unresolved-import limitation no longer advises a `ds.config.json` that v1 has no
 * loader for (source line 542).
 *
 * One parse per file produces everything the rest of the pipeline needs: imports,
 * re-exports, rendered elements, local component declarations, and every style value
 * expressible in JavaScript. Splitting these across several passes would mean parsing the
 * same file several times, and parsing is by far the most expensive thing the scanner does.
 *
 * Parsing is purely syntactic — `noResolve`, no type checker. A consumer project's
 * dependencies are usually not installed when an audit runs, and requiring them would make
 * the tool unusable on a fresh checkout. Everything that would need types is either derived
 * structurally or left `null`.
 */

/** JSX attributes whose string value is a colour rather than data. */
const PRESENTATIONAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "fill",
  "stroke",
  "color",
  "stopColor",
  "floodColor",
  "lightingColor",
  "bgcolor",
]);

/**
 * `KeyboardEvent.key` values the APG patterns build their keyboard contracts from.
 *
 * A closed list rather than "any string literal in a handler": handlers are full of strings,
 * and recording all of them would turn a precise signal into a haystack. These are the only
 * names any APG keyboard requirement uses.
 *
 * `event.keyCode` is deliberately absent. It is deprecated, and its numeric literals are
 * indistinguishable from every other number in a handler body — recording them would cost
 * precision to catch code that is already legacy on a different axis.
 */
const KEYBOARD_EVENT_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  "Escape",
  "Tab",
  "Delete",
  "Backspace",
  " ",
  "Spacebar",
]);

/**
 * Components that render a glyph and no text.
 *
 * Needed because `<button><CloseIcon /></button>` is the single most common icon-only
 * control, and a child component is otherwise unknowable: `<Label/>` renders text, `<Icon/>`
 * does not, and nothing in the syntax says which. Matching the naming convention is a
 * heuristic, but a narrow and checkable one — and being wrong here costs a missed finding,
 * not a false one.
 */
const ICON_COMPONENT_PATTERN = /Icon(?:$|[A-Z])|^Svg[A-Z]/;

/** Host tags that render a glyph rather than text. */
const GLYPH_TAGS: ReadonlySet<string> = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "g",
  "use",
  "img",
  "picture",
]);

const jsxTagName = (element: Node): string => {
  if (Node.isJsxElement(element)) {
    return element.getOpeningElement().getTagNameNode().getText();
  }
  if (Node.isJsxSelfClosingElement(element)) {
    return element.getTagNameNode().getText();
  }

  return "";
};

const isHostTag = (name: string): boolean => /^[a-z]/.test(name);

interface SubtreeContent {
  text: boolean;
  expression: boolean;
  component: boolean;
}

/**
 * What a subtree could contribute to an accessible name.
 *
 * Walks the whole subtree rather than the direct children: an accessible name is computed
 * from all descendant content, so `<button><span>Save</span></button>` is named and a rule
 * that looked one level deep would say otherwise.
 */
const subtreeContentOf = (element: Node): SubtreeContent => {
  const content: SubtreeContent = { text: false, expression: false, component: false };

  const visitChildren = (node: Node): void => {
    if (!Node.isJsxElement(node)) {
      return;
    }

    for (const child of node.getJsxChildren()) {
      if (Node.isJsxText(child)) {
        if (child.getText().trim().length > 0) {
          content.text = true;
        }
        continue;
      }

      if (Node.isJsxExpression(child)) {
        // `{' '}` and `{/* comment */}` carry no name; anything else might.
        const inner = child.getExpression();
        if (inner !== undefined && inner.getText().trim().length > 0) {
          content.expression = true;
        }
        continue;
      }

      if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
        const tag = jsxTagName(child);

        if (!isHostTag(tag) && !ICON_COMPONENT_PATTERN.test(tag)) {
          content.component = true;
        }

        // A glyph subtree holds no text worth walking, and `<title>` inside an SVG names the
        // SVG itself rather than the control around it.
        if (!GLYPH_TAGS.has(tag)) {
          visitChildren(child);
        }
      }
    }
  };

  visitChildren(element);

  return content;
};

/** `true` when a `<label>` element encloses `element`. */
const hasLabelAncestorOf = (element: Node): boolean => {
  let current: Node | undefined = element.getParent();

  while (current !== undefined) {
    if (Node.isJsxElement(current) && jsxTagName(current).toLowerCase() === "label") {
      return true;
    }
    current = current.getParent();
  }

  return false;
};

/** `onClick`, `onKeyDown` — the React convention, which no host attribute collides with. */
const isEventHandlerProp = (name: string): boolean => /^on[A-Z]/.test(name);

/**
 * Key names named literally anywhere inside a handler's expression.
 *
 * Walks the subtree rather than matching a shape, because the same requirement is written as
 * `event.key === 'ArrowRight'`, as a `switch` case, and as `['ArrowLeft','ArrowRight']
 * .includes(event.key)`. What matters to a conformance rule is only whether the key is named
 * at all; which comparison form was used carries no signal.
 */
const keysNamedIn = (node: Node): string[] => {
  const found = new Set<string>();

  for (const literal of [
    ...node.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...node.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]) {
    const value = literal.getLiteralValue();
    if (KEYBOARD_EVENT_KEYS.has(value)) {
      found.add(value);
    }
  }

  return sortStrings(found);
};

/**
 * A colour written in a plain TypeScript string.
 *
 * Six and eight digits only. Three-digit hex is legal CSS, but a bare four-character token in
 * TypeScript — `#add`, `#fab`, `#dec` — is far more likely to be a fragment of an identifier
 * or a URL anchor than a colour, and design constants in JavaScript are emitted by tooling in
 * the long form. Inside actual CSS the short form is accepted, because there the property
 * name guarantees the context.
 */
const TS_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/;

/** A string made up entirely of unit-bearing lengths, e.g. `5px 11px`. */
const TS_LENGTHS_PATTERN = /^(?:-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)\s*)+$/;

const MAX_JSX_SHAPE_ENTRIES = 40;
const MAX_AST_SIGNATURE_TOKENS = 400;

export interface TypeScriptCollectionInput {
  /** Project-relative POSIX path. */
  readonly file: string;
  readonly content: string;
  readonly project: Project;
  /** Resolves a specifier as written in this file. */
  readonly resolveModule: (specifier: string) => Resolution;
}

export interface TypeScriptCollectionResult {
  readonly styleValues: StyleValue[];
  readonly jsxElements: JsxElement[];
  readonly imports: ImportRecord[];
  readonly reExports: ReExportRecord[];
  readonly declarations: Declaration[];
  readonly limitations: Limitation[];
}

const columnOf = (node: Node): number => node.getStart() - node.getStartLinePos() + 1;

/**
 * Normalised token stream of a subtree.
 *
 * Identifiers and literals are collapsed to their kind so that a copy renamed from `Card` to
 * `OldCard` still hashes alike, while host tags survive verbatim because `<button>` versus
 * `<div>` is exactly the structural difference clone detection needs to see.
 */
const astSignatureOf = (node: Node): string[] => {
  const tokens: string[] = [];

  const visit = (current: Node): void => {
    if (tokens.length >= MAX_AST_SIGNATURE_TOKENS) {
      return;
    }

    if (Node.isJsxElement(current) || Node.isJsxSelfClosingElement(current)) {
      const tag = jsxTagName(current);
      tokens.push(isHostTag(tag) ? `jsx:${tag}` : "jsx:component");
    } else if (Node.isIdentifier(current) || Node.isPrivateIdentifier(current)) {
      tokens.push("id");
    } else if (Node.isStringLiteral(current) || Node.isNoSubstitutionTemplateLiteral(current)) {
      tokens.push("str");
    } else if (Node.isNumericLiteral(current)) {
      tokens.push("num");
    } else {
      tokens.push(current.getKindName());
    }

    for (const child of current.getChildren()) {
      visit(child);
    }
  };

  visit(node);

  return tokens;
};

/**
 * A short label for where a bare literal was written.
 *
 * A `ts-literal` observation has no CSS property to name it by, but the report still has to
 * say *what* the value was: `primary` reads very differently from `argument to darken`.
 * Purely for display — no rule branches on it.
 */
const describeLiteralOwner = (literal: Node): string => {
  const parent = literal.getParent();

  if (Node.isPropertyAssignment(parent)) {
    return parent.getName().replace(/^['"]|['"]$/g, "");
  }
  if (Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  if (Node.isCallExpression(parent)) {
    return `аргумент ${parent.getExpression().getText().slice(0, 40)}()`;
  }
  if (Node.isReturnStatement(parent) || Node.isArrowFunction(parent)) {
    return "возвращаемое значение";
  }
  if (Node.isArrayLiteralExpression(parent)) {
    return "элемент массива";
  }

  return "(литерал)";
};

/** Prop names from a destructuring pattern or a plain parameter. */
const propNamesOf = (declaration: Node): string[] => {
  const functionLike = Node.isVariableDeclaration(declaration)
    ? (declaration.getInitializerIfKind(SyntaxKind.ArrowFunction) ??
      declaration.getInitializerIfKind(SyntaxKind.FunctionExpression) ??
      declaration.getInitializer())
    : declaration;

  const candidates: Node[] = [];

  if (
    functionLike &&
    (Node.isArrowFunction(functionLike) || Node.isFunctionExpression(functionLike))
  ) {
    candidates.push(...functionLike.getParameters());
  } else if (Node.isFunctionDeclaration(declaration)) {
    candidates.push(...declaration.getParameters());
  } else if (functionLike && Node.isCallExpression(functionLike)) {
    // `forwardRef((props, ref) => …)` / `memo(({ a, b }) => …)`
    for (const argument of functionLike.getArguments()) {
      if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) {
        candidates.push(...argument.getParameters());
      }
    }
  }

  const names = new Set<string>();

  for (const parameter of candidates) {
    if (!Node.isParameterDeclaration(parameter)) {
      continue;
    }
    const nameNode = parameter.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const propertyName = element.getPropertyNameNode()?.getText() ?? element.getName();
        if (propertyName !== "...") {
          names.add(propertyName);
        }
      }
    }
  }

  return sortStrings(names);
};

/**
 * Prop names declared on an interface or type alias whose name matches the component.
 *
 * A destructuring pattern only lists the props the body happens to use; the declared type is
 * the real surface, and the prop-similarity heuristic needs the real surface to be comparable
 * across components.
 */
const declaredPropNamesOf = (sourceFile: SourceFile, componentName: string): string[] => {
  const typeName = `${componentName}Props`;
  const names = new Set<string>();

  for (const declaration of sourceFile.getInterfaces()) {
    if (declaration.getName() === typeName) {
      for (const member of declaration.getProperties()) {
        names.add(member.getName());
      }
    }
  }

  for (const alias of sourceFile.getTypeAliases()) {
    if (alias.getName() !== typeName) {
      continue;
    }
    for (const member of alias.getDescendantsOfKind(SyntaxKind.PropertySignature)) {
      names.add(member.getName());
    }
  }

  return sortStrings(names);
};

interface ComponentCandidate {
  readonly name: string;
  readonly node: Node;
  readonly kind: Declaration["kind"];
}

/**
 * Top-level declarations that render JSX.
 *
 * Detection is structural: something is a component if it produces JSX, whatever wrapper it
 * is written with. Wrappers proliferate (`forwardRef`, `memo`, `observer`, `styled`), and
 * enumerating them would guarantee missing the next one.
 */
const componentCandidatesOf = (sourceFile: SourceFile): ComponentCandidate[] => {
  const candidates: ComponentCandidate[] = [];

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }

      if (
        Node.isTaggedTemplateExpression(initializer) &&
        cssInJsTagInfo(initializer.getTag().getText()).isCssInJs
      ) {
        candidates.push({
          name: declaration.getName(),
          node: declaration,
          kind: "styled-component",
        });
        continue;
      }

      const rendersJsx =
        initializer.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
        initializer.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
        initializer.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined;

      if (rendersJsx) {
        candidates.push({ name: declaration.getName(), node: declaration, kind: "component" });
      }
    }
  }

  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (name === undefined) {
      continue;
    }
    const rendersJsx =
      declaration.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
      declaration.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined;

    if (rendersJsx) {
      candidates.push({ name, node: declaration, kind: "component" });
    }
  }

  return candidates;
};

/** Reads `classes={{ root: styles.root }}` and `className={styles.field}` into style refs. */
const styleRefsOf = (attribute: Node, attributeName: string): StyleRef[] => {
  const refs: StyleRef[] = [];

  const readAccess = (node: Node, slot: string | null): void => {
    if (Node.isPropertyAccessExpression(node)) {
      refs.push({ slot, module: node.getExpression().getText(), className: node.getName() });
      return;
    }
    if (Node.isElementAccessExpression(node)) {
      const argument = node.getArgumentExpression();
      if (argument && Node.isStringLiteral(argument)) {
        refs.push({
          slot,
          module: node.getExpression().getText(),
          className: argument.getLiteralValue(),
        });
      }
      return;
    }
    // `clsx(styles.a, styles.b)` and template literals both hold several accesses.
    for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      refs.push({ slot, module: access.getExpression().getText(), className: access.getName() });
    }
  };

  if (attributeName === "classes") {
    const object = attribute.getFirstDescendantByKind(SyntaxKind.ObjectLiteralExpression);
    if (object) {
      for (const property of object.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          continue;
        }
        const initializer = property.getInitializer();
        if (initializer) {
          readAccess(initializer, property.getName().replace(/^['"]|['"]$/g, ""));
        }
      }
    }
    return refs;
  }

  readAccess(attribute, null);

  return refs;
};

/** Collects everything of interest from one TypeScript or JSX file. */
export const collectTypeScript = (input: TypeScriptCollectionInput): TypeScriptCollectionResult => {
  const { file, content, project, resolveModule } = input;

  const styleValues: StyleValue[] = [];
  const jsxElements: JsxElement[] = [];
  const imports: ImportRecord[] = [];
  const reExports: ReExportRecord[] = [];
  const declarations: Declaration[] = [];
  const limitations: Limitation[] = [];

  const scriptExtension = extensionOf(file);
  const virtualPath = `/scan${scriptExtension === ".tsx" || scriptExtension === ".jsx" ? ".tsx" : ".ts"}`;

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(virtualPath, content, { overwrite: true });
  } catch (error) {
    return {
      styleValues,
      jsxElements,
      imports,
      reExports,
      declarations,
      limitations: [
        {
          file,
          line: null,
          reason: "parse-error",
          detail: error instanceof Error ? error.message : "TypeScript failed to parse the file",
        },
      ],
    };
  }

  try {
    /** Local identifier of a style-module import → project-relative path of that module. */
    const styleModules = new Map<string, string>();

    /**
     * Start offsets of object literals already read as style maps.
     *
     * A style object reached through `style={…}` must not be collected a second time by the
     * shape-based pass, and the literals inside it must not be reported again as bare
     * TypeScript values.
     */
    const collectedObjects = new Set<number>();

    const markCollected = (object: Node): void => {
      collectedObjects.add(object.getStart());
      for (const nested of object.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
        collectedObjects.add(nested.getStart());
      }
    };

    for (const declaration of sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const resolution = resolveModule(specifier);
      const defaultImport = declaration.getDefaultImport()?.getText() ?? null;

      if (resolution.kind === "unresolved") {
        limitations.push({
          file,
          line: declaration.getStartLineNumber(),
          reason: "unresolved-import",
          detail: `"${specifier}" could not be resolved to a file inside the project`,
        });
      }

      if (defaultImport !== null && isStyleModule(specifier) && resolution.file !== null) {
        styleModules.set(defaultImport, resolution.file);
      }

      imports.push({
        specifier,
        names: declaration.getNamedImports().map((named) => ({
          imported: named.getName(),
          local: named.getAliasNode()?.getText() ?? named.getName(),
          typeOnly: named.isTypeOnly() || declaration.isTypeOnly(),
        })),
        defaultImport,
        namespaceImport: declaration.getNamespaceImport()?.getText() ?? null,
        typeOnly: declaration.isTypeOnly(),
        resolution: { kind: resolution.kind, file: resolution.file },
        file,
        line: declaration.getStartLineNumber(),
        column: columnOf(declaration),
      });
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier === undefined) {
        // `export { x }` without a source re-exports a local binding, which says nothing
        // about another module.
        continue;
      }

      const resolution = resolveModule(specifier);

      reExports.push({
        specifier,
        names: declaration.getNamedExports().map((named) => ({
          exported: named.getAliasNode()?.getText() ?? named.getName(),
          local: named.getName(),
          typeOnly: named.isTypeOnly() || declaration.isTypeOnly(),
        })),
        star: declaration.getNamedExports().length === 0,
        resolution: { kind: resolution.kind, file: resolution.file },
        file,
        line: declaration.getStartLineNumber(),
        column: columnOf(declaration),
      });
    }

    // --- Tagged templates: styled-components and emotion -----------------------------
    for (const tagged of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
      const info = cssInJsTagInfo(tagged.getTag().getText());
      if (!info.isCssInJs) {
        continue;
      }

      const template = tagged.getTemplate();
      const parts = Node.isNoSubstitutionTemplateLiteral(template)
        ? [{ text: template.getLiteralText() }]
        : [
            { text: template.getHead().getLiteralText() },
            ...template
              .getTemplateSpans()
              .map((span) => ({ text: span.getLiteral().getLiteralText() })),
          ];

      const owner = tagged.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const result = collectCssInJs({
        file,
        parts,
        startLine: template.getStartLineNumber(),
        startColumn: columnOf(template),
        selectorName: owner?.getName() ?? info.wraps ?? info.hostTag,
        source: "styled-components",
      });

      styleValues.push(...result.styleValues);
      limitations.push(...result.limitations);
    }

    // --- JSX elements ----------------------------------------------------------------
    const jsxNodes = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    for (const element of jsxNodes) {
      const name = element.getTagNameNode().getText();
      const props: Record<string, string | null> = {};
      const propExpressions: Record<string, string> = {};
      const propLines: Record<string, number> = {};
      const eventHandlers: string[] = [];
      const keysHandled = new Set<string>();
      const styleRefs: StyleRef[] = [];
      let hasInlineStyle = false;

      // Opening elements carry the attributes but not the children: the subtree hangs off
      // the enclosing `JsxElement`, which is where the name has to be read from.
      const parent = element.getParent();
      const owner =
        parent !== undefined && Node.isJsxElement(parent) && parent.getOpeningElement() === element
          ? parent
          : element;

      const content = subtreeContentOf(owner);
      const hasLabelAncestor = hasLabelAncestorOf(owner);

      for (const attribute of element.getAttributes()) {
        if (!Node.isJsxAttribute(attribute)) {
          continue;
        }

        const attributeName = attribute.getNameNode().getText();
        const initializer = attribute.getInitializer();
        propLines[attributeName] = attribute.getStartLineNumber();

        if (isEventHandlerProp(attributeName)) {
          eventHandlers.push(attributeName);

          if (initializer !== undefined) {
            for (const key of keysNamedIn(initializer)) {
              keysHandled.add(key);
            }
          }
        }

        if (initializer === undefined) {
          // A bare attribute is `true`.
          props[attributeName] = "true";
          continue;
        }

        if (Node.isStringLiteral(initializer)) {
          const literal = initializer.getLiteralValue();
          props[attributeName] = literal;

          if (PRESENTATIONAL_ATTRIBUTES.has(attributeName)) {
            styleValues.push({
              property: attributeName === "stopColor" ? "stop-color" : attributeName.toLowerCase(),
              value: literal,
              authored: null,
              file,
              line: initializer.getStartLineNumber(),
              column: columnOf(initializer),
              source: "inline-style",
              selector: name,
              classNames: [],
              important: false,
              dynamic: false,
              rootCause: null,
              appliedTo: null,
            });
          }
          continue;
        }

        const expression = Node.isJsxExpression(initializer)
          ? initializer.getExpression()
          : undefined;
        const literalValue =
          expression &&
          (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression))
            ? expression.getLiteralValue()
            : null;

        props[attributeName] = literalValue;

        if (literalValue === null) {
          // Maintains the `props[k] === null ⇔ propExpressions[k]` invariant the schema
          // documents: every prop that could not be reduced keeps its source text.
          propExpressions[attributeName] = (expression ?? initializer).getText();
        }

        if (attributeName === "style" && expression) {
          hasInlineStyle = true;
          if (Node.isObjectLiteralExpression(expression)) {
            markCollected(expression);
          }
          const result = collectStyleObject({
            file,
            object: expression,
            source: "inline-style",
            selector: name,
            classNames: [],
          });
          styleValues.push(...result.styleValues);
          for (const dynamic of result.dynamicProperties) {
            limitations.push({
              file,
              line: dynamic.line,
              reason: "dynamic-styles",
              detail: `inline style ${dynamic.property} is computed`,
            });
          }
        }

        if (attributeName === "className" || attributeName === "classes") {
          styleRefs.push(...styleRefsOf(initializer, attributeName));
        }
      }

      jsxElements.push({
        name,
        resolvedFrom: null,
        kitComponent: null,
        props,
        propExpressions,
        eventHandlers: sortStrings(new Set(eventHandlers)),
        keysHandled: sortStrings(keysHandled),
        content,
        hasLabelAncestor,
        propLines,
        styleRefs: styleRefs.map((ref) => ({
          ...ref,
          module: styleModules.get(ref.module) ?? ref.module,
        })),
        hasInlineStyle,
        file,
        line: element.getStartLineNumber(),
        column: columnOf(element),
      });
    }

    // --- Style objects written outside a `style={…}` attribute ----------------------
    // `const styleFor = (active) => ({ color: …, padding: … })` is CSS that never reaches a
    // JSX attribute the collector can see, because the call cannot be evaluated.
    for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      if (collectedObjects.has(object.getStart())) {
        continue;
      }

      const keys = object
        .getProperties()
        .filter((property) => Node.isPropertyAssignment(property))
        .map((property) => {
          const nameNode = property.getNameNode();
          return Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
        });

      if (!looksLikeStyleObject(keys)) {
        continue;
      }

      const owner =
        object.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? null;
      const result = collectStyleObject({
        file,
        object,
        source: "inline-style",
        selector: owner,
        classNames: [],
      });

      styleValues.push(...result.styleValues);
      markCollected(object);

      for (const dynamic of result.dynamicProperties) {
        limitations.push({
          file,
          line: dynamic.line,
          reason: "dynamic-styles",
          detail: `${dynamic.property} in style object ${owner ?? ""} is computed`,
        });
      }
    }

    // --- Design literals in plain TypeScript ----------------------------------------
    for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      const parent = literal.getParent();

      // Module specifiers are paths, not values.
      if (
        Node.isImportDeclaration(parent) ||
        Node.isExportDeclaration(parent) ||
        Node.isImportTypeNode(parent)
      ) {
        continue;
      }

      // An object key is a name; only the value side carries a decision.
      if (Node.isPropertyAssignment(parent) && parent.getNameNode() === literal) {
        continue;
      }

      // Anything reached through JSX or a style object was already collected with its real
      // property, and recording it again would double-count the same decision.
      if (
        literal.getFirstAncestorByKind(SyntaxKind.JsxAttribute) !== undefined ||
        collectedObjects.has(
          literal.getFirstAncestorByKind(SyntaxKind.ObjectLiteralExpression)?.getStart() ?? -1,
        )
      ) {
        continue;
      }

      const text = literal.getLiteralValue().trim();

      // Position is not what keeps this honest — the value pattern is. A six-digit hex or a
      // run of unit-bearing lengths is a design decision wherever it was written: in a
      // constant, in a `return`, or as an argument to a colour helper.
      if (!TS_COLOR_PATTERN.test(text) && !TS_LENGTHS_PATTERN.test(text)) {
        continue;
      }

      styleValues.push({
        property: describeLiteralOwner(literal),
        value: text,
        authored: null,
        file,
        line: literal.getStartLineNumber(),
        column: columnOf(literal),
        source: "ts-literal",
        selector: null,
        classNames: [],
        important: false,
        dynamic: false,
        rootCause: null,
        appliedTo: null,
      });
    }

    // --- Local component declarations ------------------------------------------------
    for (const candidate of componentCandidatesOf(sourceFile)) {
      const ariaRoles = new Set<string>();
      const ariaAttributes = new Set<string>();
      const nativeTags = new Set<string>();
      const jsxShape = new Set<string>();
      const declarationHandlers = new Set<string>();
      const declarationKeys = new Set<string>();
      const cssProperties = new Set<string>();
      let elementCount = 0;
      let hasInlineSvg = false;

      const elements = [
        ...candidate.node.getDescendantsOfKind(SyntaxKind.JsxElement),
        ...candidate.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ];

      for (const element of elements) {
        elementCount += 1;
        const tag = jsxTagName(element);

        if (isHostTag(tag)) {
          nativeTags.add(tag);
          if (tag === "svg") {
            hasInlineSvg = true;
          }
        }

        const attributes = Node.isJsxElement(element)
          ? element.getOpeningElement().getAttributes()
          : element.getAttributes();

        for (const attribute of attributes) {
          if (!Node.isJsxAttribute(attribute)) {
            continue;
          }
          const attributeName = attribute.getNameNode().getText();

          if (attributeName.startsWith("aria-")) {
            ariaAttributes.add(attributeName);
          }
          if (isEventHandlerProp(attributeName)) {
            declarationHandlers.add(attributeName);
          }
          if (attributeName === "role") {
            const initializer = attribute.getInitializer();
            if (initializer && Node.isStringLiteral(initializer)) {
              ariaRoles.add(initializer.getLiteralValue());
            }
          }
        }

        if (Node.isJsxElement(element)) {
          for (const child of element.getJsxChildren()) {
            if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
              if (jsxShape.size < MAX_JSX_SHAPE_ENTRIES) {
                jsxShape.add(`${tag}>${jsxTagName(child)}`);
              }
            }
          }
        }
      }

      // The style fingerprint must only contain real CSS properties — an object key from a
      // `ts-literal` is not one.
      for (const styleValue of styleValues) {
        if (
          styleValue.source !== "ts-literal" &&
          styleValue.line >= candidate.node.getStartLineNumber() &&
          styleValue.line <= candidate.node.getEndLineNumber()
        ) {
          cssProperties.add(styleValue.property);
        }
      }

      const destructured = propNamesOf(candidate.node);
      const declared = declaredPropNamesOf(sourceFile, candidate.name);

      // Keys are gathered from the whole declaration, not just its JSX attributes: a dialog
      // frequently closes on `Escape` from a `useEffect` listener that never appears as a
      // prop, and a rule that only looked at attributes would call it unhandled.
      for (const key of keysNamedIn(candidate.node)) {
        declarationKeys.add(key);
      }

      declarations.push({
        name: candidate.name,
        kind: candidate.kind,
        props: sortStrings(new Set([...destructured, ...declared])),
        ariaRoles: sortStrings(ariaRoles),
        ariaAttributes: sortStrings(ariaAttributes),
        nativeTags: sortStrings(nativeTags),
        jsxShape: sortStrings(jsxShape),
        cssProperties: sortStrings(cssProperties),
        hasInlineSvg,
        eventHandlers: sortStrings(declarationHandlers),
        keysHandled: sortStrings(declarationKeys),
        astSignature: astSignatureOf(candidate.node),
        elementCount,
        file,
        line: candidate.node.getStartLineNumber(),
        column: columnOf(candidate.node),
      });
    }
  } catch (error) {
    limitations.push({
      file,
      line: null,
      reason: "parse-error",
      detail: error instanceof Error ? error.message : "collection failed",
    });
  } finally {
    project.removeSourceFile(sourceFile);
  }

  return {
    styleValues: styleValues.sort(
      (left, right) =>
        left.line - right.line ||
        left.column - right.column ||
        compareStrings(left.property, right.property),
    ),
    jsxElements,
    imports,
    reExports,
    declarations,
    limitations,
  };
};
