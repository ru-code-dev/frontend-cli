import { Node, type SourceFile, SyntaxKind } from "ts-morph";

import type { StyleValue, TokenReference } from "../../domain/observations.ts";
import type { Limitation } from "../../domain/profile.ts";
import { collectStyleObject, SPREAD_PROPERTY, type ExpressionResolution } from "./style-object.ts";

/**
 * vanilla-extract collection — the sixth style dialect (design §2.1).
 *
 * A `.css.ts` file is ordinary TypeScript that happens to hand style objects to a build-time
 * factory. Nothing is executed here: the objects are read syntactically, exactly as the JSS and
 * inline-style objects already are, and the shared walker in `style-object.ts` does the reading.
 * This module's whole job is to say WHICH object literals in a file are style objects, and WHAT
 * a value that is not a literal refers to.
 *
 * ## Why this dialect needed a token reference at all
 *
 * In every other dialect a token reference is a string — `var(--brand-text-primary)` — that
 * survives into the value a rule reads. Here it is a member expression:
 *
 *     color: tokens.sys.color.textPrimary
 *
 * By the time vanilla-extract has run, that property holds a hashed custom property nobody
 * wrote and no artifact names. A collector that recorded only literals would see the correct
 * line as an empty one, and a project that references tokens on every line would be
 * indistinguishable from a project that references none — which is the exact failure mode
 * (silence that reads as a pass) this engine is built to refuse. So the reference is recorded
 * structurally, in `StyleValue.reference`, and `unresolved` is a limitation rather than a gap.
 *
 * ## Zero kit knowledge
 *
 * No module name, export name or factory name of any design system appears here. The reference
 * a member path becomes is built from the FILE'S OWN import list — module specifier and
 * exported name exactly as authored — so `tokens.sys.color.x` and `tokens.color.x` from
 * some other library are recorded identically. Whether such a path names a token is the
 * connected kit's judgement ({@link KitBinding.tokenIdOfReference}), asked later.
 *
 * The only kit-supplied input is {@link VanillaExtractInput.styleFactories}: extra modules
 * whose exports produce style objects (a kit's own `makeStyles`), which decides whether a file
 * takes part at all. It arrives from `KitBinding.tokenReferenceModel` at run time; with no
 * adapter, the bare `@vanilla-extract/*` packages are the whole of it.
 */

/** Packages whose presence makes a file a vanilla-extract file. */
const VANILLA_EXTRACT_SCOPE = "@vanilla-extract/";

/**
 * What a recognised factory call does with the arguments it is given.
 *
 * Keyed by the factory's LOCAL NAME rather than by its import, and that is deliberate. The
 * canonical way to build a `.css.ts` in a design system is to re-export wrapped factories
 * from a project module — `const { recipe } = makeStyles('some-tag')` written once, then
 * `import { recipe } from './styleFunctions.css'` in the twenty files that use it — so an
 * import-rooted match would see nothing in the majority of real files. The name is
 * matched only INSIDE a participating file, which is what keeps the widened match honest: a
 * `style()` helper in a file that imports no vanilla-extract is not considered.
 */
type FactoryKind = "style" | "styleVariants" | "globalStyle" | "recipe" | "theme" | "globalTheme";

const FACTORY_KINDS: ReadonlyMap<string, FactoryKind> = new Map<string, FactoryKind>([
  ["style", "style"],
  ["styleVariants", "styleVariants"],
  ["globalStyle", "globalStyle"],
  ["recipe", "recipe"],
  ["createTheme", "theme"],
  ["createGlobalTheme", "globalTheme"],
]);

/**
 * Where a local identifier came from.
 *
 * `exportName` is `"default"` for a default import and `"*"` for a namespace import; a
 * namespace's first member is folded back into `exportName` when a path is read off it, so
 * `import * as t` + `t.tokens.sys.x` and `import { tokens }` + `tokens.sys.x`
 * produce the SAME reference. Two spellings of one fact must not become two token ids.
 */
export interface ImportedBinding {
  readonly module: string;
  readonly exportName: string;
}

/** Modules whose named exports produce style objects, beyond `@vanilla-extract/*`. */
export interface StyleFactoryModule {
  readonly module: string;
  readonly names: readonly string[];
}

export interface VanillaExtractInput {
  /** Project-relative POSIX path. */
  readonly file: string;
  readonly sourceFile: SourceFile;
  /** Local identifier → the import it was bound by, value imports only. */
  readonly bindings: ReadonlyMap<string, ImportedBinding>;
  /** @see StyleFactoryModule */
  readonly styleFactories?: readonly StyleFactoryModule[];
}

export interface VanillaExtractResult {
  readonly styleValues: StyleValue[];
  readonly limitations: Limitation[];
  /**
   * Start offsets of every object literal read here, so the generic passes that follow do not
   * read the same decision a second time under a worse name.
   */
  readonly collectedObjects: number[];
}

/**
 * The file-name convention every vanilla-extract bundler integration is keyed on.
 *
 * A second, independent trigger rather than the only one, and both are needed. Measured
 * against four real `.css.ts` files from a shipping design system, the import test alone read
 * two of them: the other two import their factories from a RELATIVE project module
 * (`import { globalStyle, recipe } from '../../styles/styleFunctions.css'`) that no adapter
 * can enumerate, because the path differs per directory. The extension is what those files
 * have in common — it is the thing the bundler itself matches on — and a file that carries it
 * and calls nothing recognisable still yields nothing.
 */
const VANILLA_EXTRACT_FILE_PATTERN = /\.css\.[cm]?[jt]sx?$/;

/**
 * `true` when this file takes part in the dialect at all.
 *
 * Not gated on the file name ALONE: a project that puts vanilla-extract in `styles.ts` is
 * writing the same dialect, and the import list is what catches it there.
 */
export const isVanillaExtractFile = (
  file: string,
  bindings: ReadonlyMap<string, ImportedBinding>,
  styleFactories: readonly StyleFactoryModule[] = [],
): boolean => {
  if (VANILLA_EXTRACT_FILE_PATTERN.test(file)) {
    return true;
  }

  for (const binding of bindings.values()) {
    if (binding.module.startsWith(VANILLA_EXTRACT_SCOPE)) {
      return true;
    }
    if (
      styleFactories.some(
        (factory) =>
          factory.module === binding.module && factory.names.includes(binding.exportName),
      )
    ) {
      return true;
    }
  }

  return false;
};

/** Trailing identifier of a callee: `recipe` for both `recipe(…)` and `styles.recipe(…)`. */
const calleeName = (call: Node): string | null => {
  const expression = Node.isCallExpression(call) ? call.getExpression() : null;

  if (expression === null) {
    return null;
  }
  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }

  return null;
};

interface MemberPath {
  readonly root: string;
  readonly segments: readonly string[];
  /** `true` when a segment was `[expr]` with a non-literal subscript. */
  readonly computed: boolean;
}

/**
 * Splits a member expression into its root identifier and the names read off it.
 *
 * `tokens['sys'].color.x` and `tokens.sys.color.x` are the same path — a string
 * subscript is a spelling, not a computation. `tokens.sys.color[role]` is not: nothing
 * static says which member it reads, and guessing would attach a finding to a token the code
 * may never use.
 */
const memberPathOf = (node: Node): MemberPath | null => {
  const segments: string[] = [];
  let computed = false;
  let current: Node = node;

  for (;;) {
    if (Node.isIdentifier(current)) {
      return { root: current.getText(), segments: segments.toReversed(), computed };
    }

    if (Node.isPropertyAccessExpression(current)) {
      segments.push(current.getName());
      current = current.getExpression();
      continue;
    }

    if (Node.isElementAccessExpression(current)) {
      const argument = current.getArgumentExpression();
      if (argument !== undefined && Node.isStringLiteral(argument)) {
        segments.push(argument.getLiteralValue());
      } else {
        computed = true;
      }
      current = current.getExpression();
      continue;
    }

    return null;
  }
};

/**
 * The reference a member path is, or why it is not one.
 *
 * `null` means "not import-rooted": a local constant, a parameter, a call result. That is an
 * ordinary dynamic value and is reported as one — calling it an unresolved TOKEN reference
 * would inflate the count of things this engine failed to check with things that were never
 * references.
 */
const referenceOf = (
  node: Node,
  bindings: ReadonlyMap<string, ImportedBinding>,
): { readonly reference: TokenReference | null; readonly computed: boolean } | null => {
  const path = memberPathOf(node);
  if (path === null) {
    return null;
  }

  const binding = bindings.get(path.root);
  if (binding === undefined) {
    return null;
  }

  if (path.computed) {
    return { reference: null, computed: true };
  }

  // A namespace import is a container, not a value: its first member is the export.
  const [first, ...rest] = path.segments;
  const namespaced = binding.exportName === "*";

  if (namespaced && first === undefined) {
    // The namespace object itself is not a token reference.
    return null;
  }

  return {
    reference: {
      kind: "js-path",
      // THE MODULE SPECIFIER AS WRITTEN, never the identifier's name. A project may have a
      // token object of its own called exactly what the kit calls its own — the showroom of a
      // real design system does — so identity is the import, and only the import.
      module: binding.module,
      exportName: namespaced ? (first as string) : binding.exportName,
      path: namespaced ? rest : [...path.segments],
      // Set by the caller that saw a spread; a member path read as a value is not one.
      spread: false,
    },
    computed: false,
  };
};

/** Literal spans of a template, with every `${…}` removed — the css-in-js convention. */
const templateLiteralText = (node: Node): string => {
  if (!Node.isTemplateExpression(node)) {
    return "";
  }

  return [
    node.getHead().getLiteralText(),
    ...node.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()),
  ]
    .join("")
    .trim();
};

/**
 * How a value expression that yielded no literal should be recorded.
 *
 * Four shapes, in the order they matter:
 *
 *  1. a member path off an import — the resolved case, the whole point of the dialect;
 *  2. the same with a computed segment — a reference that EXISTS and was not resolved, so a
 *     `unresolved-token-reference` limitation and a `dynamic` value (design E5);
 *  3. a template literal holding either of the above — its literal parts are still real CSS
 *     and are kept, exactly as `collectCssInJs` keeps them around an interpolation;
 *  4. anything else — `null`, which leaves the caller's existing `dynamic-styles` handling
 *     untouched. A local constant is not a token reference and must not be counted as one.
 */
const expressionResolver =
  (bindings: ReadonlyMap<string, ImportedBinding>) =>
  (node: Node, property: string): ExpressionResolution | null => {
    const direct = referenceOf(node, bindings);

    if (direct !== null) {
      const text = node.getText();

      return direct.computed
        ? {
            value: text,
            authored: null,
            dynamic: true,
            reference: null,
            unresolved: `${property}: ${text} — в ссылке на токен есть вычисляемый сегмент`,
          }
        : {
            value: text,
            authored: null,
            dynamic: false,
            reference: direct.reference,
            unresolved: null,
          };
    }

    if (property === SPREAD_PROPERTY) {
      // A spread that is not an import-rooted path — `...base`, `...(dense ? a : b)` — hides an
      // unknown number of declarations behind it. Recording nothing would leave the object
      // looking like whatever its remaining keys happen to say.
      return {
        value: node.getText(),
        authored: null,
        dynamic: true,
        reference: null,
        unresolved: `${SPREAD_PROPERTY}${node.getText()} — spread не разрешается в путь к токену`,
      };
    }

    if (!Node.isTemplateExpression(node)) {
      return null;
    }

    let resolved: TokenReference | null = null;
    let computed = false;

    for (const span of node.getTemplateSpans()) {
      const inner = referenceOf(span.getExpression(), bindings);
      if (inner === null) {
        continue;
      }
      if (inner.computed) {
        computed = true;
        continue;
      }
      // `StyleValue.reference` is one reference; the first is the one the report points at,
      // and a second in the same declaration is visible in `authored` beside it.
      resolved ??= inner.reference;
    }

    if (resolved === null && !computed) {
      // No interpolation was import-rooted: an ordinary dynamic value.
      return null;
    }

    const text = node.getText();

    return {
      value: templateLiteralText(node),
      authored: text,
      dynamic: true,
      reference: resolved,
      unresolved: computed
        ? `${property}: ${text} — в ссылке на токен есть вычисляемый сегмент`
        : null,
    };
  };

/** Name of the declaration a call is the initializer of, for display. */
const ownerNameOf = (call: Node): string | null =>
  call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? null;

/** Object literals in `style(obj)` / `style([base, obj])` — array entries compose classes. */
const styleObjectsOf = (node: Node | undefined): Node[] => {
  if (node === undefined) {
    return [];
  }
  if (Node.isObjectLiteralExpression(node)) {
    return [node];
  }
  if (Node.isArrayLiteralExpression(node)) {
    // `[base, { … }]` — the identifiers are composed classes, which carry no value of their own.
    return node.getElements().filter((element) => Node.isObjectLiteralExpression(element));
  }

  return [];
};

/** Key of an object property, whether written bare, quoted or computed-with-a-literal. */
const propertyKeyOf = (property: Node): string | null => {
  if (!Node.isPropertyAssignment(property)) {
    return null;
  }
  const nameNode = property.getNameNode();

  return Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
};

/** Collects every vanilla-extract style object in one already-parsed file. */
export const collectVanillaExtract = (input: VanillaExtractInput): VanillaExtractResult => {
  const { file, sourceFile, bindings } = input;
  const styleValues: StyleValue[] = [];
  const limitations: Limitation[] = [];
  const collectedObjects: number[] = [];

  if (!isVanillaExtractFile(file, bindings, input.styleFactories ?? [])) {
    return { styleValues, limitations, collectedObjects };
  }

  const resolveExpression = expressionResolver(bindings);

  /** Reads one style object and files everything it produced. */
  const read = (object: Node, selector: string | null): void => {
    const result = collectStyleObject({
      file,
      object,
      source: "vanilla-extract",
      selector,
      // A `.css.ts` class name is generated at build time and appears nowhere in the source,
      // so a declaration here can never be linked to JSX by class name.
      classNames: [],
      nesting: "vanilla-extract",
      resolveExpression,
    });

    styleValues.push(...result.styleValues);
    collectedObjects.push(object.getStart());
    for (const nested of object.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      collectedObjects.push(nested.getStart());
    }

    for (const dynamic of result.dynamicProperties) {
      limitations.push({
        file,
        line: dynamic.line,
        reason: "dynamic-styles",
        detail: `${dynamic.property} in ${selector ?? "style object"} is computed`,
      });
    }
    for (const unresolved of result.unresolvedReferences) {
      limitations.push({
        file,
        line: unresolved.line,
        reason: "unresolved-token-reference",
        detail: unresolved.detail,
      });
    }
  };

  const readAll = (node: Node | undefined, selector: string | null): void => {
    for (const object of styleObjectsOf(node)) {
      read(object, selector);
    }
  };

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeName(call);
    const kind = name === null ? undefined : FACTORY_KINDS.get(name);

    if (kind === undefined) {
      continue;
    }

    // Everything under a recognised factory call belongs to this dialect, whether or not this
    // collector had a name for it: `variants: { size: 'md' }` and `defaultVariants` are recipe
    // configuration, not CSS, and the shape-based pass downstream would otherwise read them as
    // a style object and report their literals under invented property names.
    for (const nested of call.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      collectedObjects.push(nested.getStart());
    }

    const args = call.getArguments();
    const owner = ownerNameOf(call);

    if (kind === "style") {
      readAll(args[0], owner);
      continue;
    }

    if (kind === "styleVariants") {
      const map = args[0];
      if (map !== undefined && Node.isObjectLiteralExpression(map)) {
        collectedObjects.push(map.getStart());
        for (const property of map.getProperties()) {
          const key = propertyKeyOf(property);
          if (key === null || !Node.isPropertyAssignment(property)) {
            continue;
          }
          readAll(property.getInitializer(), owner === null ? key : `${owner}.${key}`);
        }
      }
      continue;
    }

    if (kind === "globalStyle") {
      // `globalStyle(`${root}:has(input)::after`, { … })` — the selector is a build-time class
      // reference, so its source text is the most honest thing to show.
      const target = args[0];
      const selector =
        target === undefined
          ? owner
          : Node.isStringLiteral(target) || Node.isNoSubstitutionTemplateLiteral(target)
            ? target.getLiteralValue()
            : target.getText();
      readAll(args[1], selector);
      continue;
    }

    if (kind === "recipe") {
      const config = args[0];
      if (config === undefined || !Node.isObjectLiteralExpression(config)) {
        continue;
      }
      collectedObjects.push(config.getStart());
      const label = owner ?? "recipe";

      for (const property of config.getProperties()) {
        const key = propertyKeyOf(property);
        if (key === null || !Node.isPropertyAssignment(property)) {
          continue;
        }
        const value = property.getInitializer();

        if (key === "base") {
          readAll(value, label);
          continue;
        }

        if (key === "variants" && value !== undefined && Node.isObjectLiteralExpression(value)) {
          collectedObjects.push(value.getStart());
          for (const group of value.getProperties()) {
            const groupKey = propertyKeyOf(group);
            const groupValue = Node.isPropertyAssignment(group)
              ? group.getInitializer()
              : undefined;
            if (groupKey === null || groupValue === undefined) {
              continue;
            }
            if (!Node.isObjectLiteralExpression(groupValue)) {
              continue;
            }
            collectedObjects.push(groupValue.getStart());
            for (const variant of groupValue.getProperties()) {
              const variantKey = propertyKeyOf(variant);
              if (variantKey === null || !Node.isPropertyAssignment(variant)) {
                continue;
              }
              readAll(variant.getInitializer(), `${label}:${groupKey}=${variantKey}`);
            }
          }
          continue;
        }

        if (
          key === "compoundVariants" &&
          value !== undefined &&
          Node.isArrayLiteralExpression(value)
        ) {
          value.getElements().forEach((element, index) => {
            if (!Node.isObjectLiteralExpression(element)) {
              return;
            }
            collectedObjects.push(element.getStart());
            for (const entry of element.getProperties()) {
              if (propertyKeyOf(entry) === "style" && Node.isPropertyAssignment(entry)) {
                readAll(entry.getInitializer(), `${label}:compound[${String(index)}]`);
              }
            }
          });
        }
      }
      continue;
    }

    // `createTheme(contract, values)` / `createTheme(values)` /
    // `createGlobalTheme(selector, values)` / `createGlobalTheme(selector, contract, values)`
    // — the VALUES are always the last argument, whichever overload was used.
    //
    // Collected, and the design says why: a consumer that builds its own theme out of raw hex
    // is making exactly the decision the token rules exist to find, and the theme object is
    // where it is written. The keys are token names rather than CSS properties, which is the
    // same shape `ts-literal` already records — a display label, with the value carrying the
    // decision. `createThemeContract` is deliberately absent: it declares names against `null`
    // placeholders and holds no value at all.
    if (kind === "theme" || kind === "globalTheme") {
      const values = args.at(-1);
      const minimum = kind === "theme" ? 1 : 2;
      if (values !== undefined && args.length >= minimum) {
        readAll(values, owner ?? (kind === "theme" ? "createTheme" : "createGlobalTheme"));
      }
    }
  }

  return { styleValues, limitations, collectedObjects };
};
