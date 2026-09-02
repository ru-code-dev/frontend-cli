/**
 * Loads the EDS 2.x theme by executing its own `*.css.ts` sources under a vanilla-extract stub.
 *
 * ── WHY A STUB RATHER THAN A REFUSAL ────────────────────────────────────────────────────────
 *
 * The v1 loader executes the theme sources and asserts they import nothing
 * (`extract/tokens/loader.ts:146-153`). That assertion is correct for `packages/theme`, which is
 * plain object literals, and it is simply false for EDS 2.x: the v2 theme graph is built out of
 * `createGlobalTheme` calls and therefore imports `@vanilla-extract/css`,
 * `@vanilla-extract/css/functionSerializer`, `@vanilla-extract/recipes` and `clsx` (S1 break V3,
 * `reports/s1-v2-facts.md:384`). The kit's `node_modules` are not installed and this package
 * must not install them, so the four are STUBBED — and `assertSelfContained` becomes the
 * allow-list below: an import the graph grows that is NOT one of the four still fails loudly.
 *
 * ── WHY THE STUB IS EXACT RATHER THAN APPROXIMATE ───────────────────────────────────────────
 *
 * Only two of vanilla-extract's entry points carry a value: `createGlobalTheme` (which both
 * DECLARES custom properties and, in its three-argument form, ASSIGNS them) and `createTheme`
 * (the dark theme, the single call in the repository). Everything else in the graph produces
 * class names, which the token artifact does not describe. So the stub models exactly those two
 * and makes the rest inert.
 *
 * The variable NAMES the stub invents are not a guess either. The kit installs an `identifiers`
 * hook that returns `sds-eng-${debugId}` with NO hash for any file named `tokens`
 * (`../ui-kit-eds-ce-2/vite.config.base.ts:14-21`), all five tier contracts live in
 * `tokens.css.ts` files, and vanilla-extract's own `createThemeContract` joins the object path
 * with `-` as the debugId. Hence `--sds-eng-<path joined by ->`. S1 verified this against the
 * real `@vanilla-extract/css@1.20.1`: 1079 tokens, 0 name mismatches and 0 value mismatches
 * (`reports/s1-v2-facts.md:147-151`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { compareStrings } from "@smart-tools/fg-analyzer-engine";

import { ExtractionError } from "../shared/errors.ts";
import { isPlainRecord, type PlainRecord } from "../shared/object.ts";
import { collectExternalImports, evaluateGraph } from "../tokens/loader.ts";

import type { KitPathsV2 } from "./paths.ts";

/** The kit's own custom-property prefix; hardcoded in three independent places in the kit. */
export const CSS_VARIABLE_PREFIX_V2 = "sds-eng";

/** The object a consumer imports, and the root of every js path this artifact records. */
export const TOKEN_EXPORT_NAME = "themeTokens";

/**
 * Bare specifiers the v2 theme graph is allowed to import.
 *
 * An ALLOW-LIST, not a silence: anything outside it still reaches
 * {@link assertOnlyAllowedExternals} and stops the extraction with the full list, exactly as
 * v1's `assertSelfContained` does. The difference is that four known packages are modelled
 * instead of being a reason to give up.
 */
export const ALLOWED_EXTERNAL_MODULES: readonly string[] = [
  "@vanilla-extract/css",
  "@vanilla-extract/css/functionSerializer",
  "@vanilla-extract/recipes",
  "clsx",
];

/** One flattened leaf of a theme object. */
interface Leaf {
  readonly path: readonly string[];
  readonly value: unknown;
}

const leavesOf = (value: unknown, path: readonly string[] = []): Leaf[] => {
  if (!isPlainRecord(value)) return [{ path, value }];

  return Object.keys(value).flatMap((key) => leavesOf(value[key], [...path, key]));
};

const varNameOf = (path: readonly string[]): string =>
  `--${[CSS_VARIABLE_PREFIX_V2, ...path].join("-")}`;

/** Rebuilds the shape of `source` with `var(--…)` at every leaf — what the real library returns. */
const contractOf = (source: unknown, path: readonly string[] = []): unknown => {
  if (!isPlainRecord(source)) return `var(${varNameOf(path)})`;

  const out: PlainRecord = {};
  for (const key of Object.keys(source)) {
    out[key] = contractOf(source[key], [...path, key]) as PlainRecord[string];
  }
  return out;
};

/** The custom-property name a contract leaf holds, or `null` when it is not one. */
const varOfContractLeaf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = /^var\((--[^),]+)\)$/.exec(value.trim());
  return match?.[1] ?? null;
};

export interface ThemeSourceV2 {
  /** `themeTokens` as a consumer sees it: five tiers whose leaves are `var(--…)` strings. */
  readonly tokens: PlainRecord;
  /** Custom property → the value assigned to it in the default (light) theme. */
  readonly light: ReadonlyMap<string, unknown>;
  /** Custom property → the value the dark theme overrides it with. `edsSys` only. */
  readonly dark: ReadonlyMap<string, unknown>;
  /** The class name the dark theme is applied through, when the graph declared one. */
  readonly darkThemeClassName: string | null;
}

/** Base for `recipeStub`'s return value; `.bind(null)` gives every call its own function object. */
const RECIPE_FN = (): string => "recipe";

/**
 * `@vanilla-extract/recipes`' `recipe()` stub. The real `recipe` hangs `variants()`/`classNames`
 * off the returned function; nothing in the token graph reads them, and the config is handed
 * back so a caller that inspects it sees what it passed. `.bind(null)` (rather than a fresh
 * arrow per call) is what gives two calls two distinct function objects without nesting one.
 */
const recipeStub = (config: unknown): unknown => {
  const fn = RECIPE_FN.bind(null);
  (fn as unknown as PlainRecord)["config"] = config as PlainRecord[string];
  return fn;
};

const assertOnlyAllowedExternals = (externals: readonly string[]): void => {
  const unexpected = externals.filter((name) => !ALLOWED_EXTERNAL_MODULES.includes(name));

  if (unexpected.length > 0) {
    throw new ExtractionError(
      `The EDS 2.x theme graph imports modules this loader does not model: ${unexpected.join(", ")}. ` +
        `Known and stubbed: ${ALLOWED_EXTERNAL_MODULES.join(", ")}.`,
    );
  }
};

/**
 * The four stubs, built fresh per load so two extractions never share a recorder.
 *
 * `record` is where the whole artifact comes from: every `createGlobalTheme`/`createTheme` call
 * in the graph writes its assignments into one of the two maps, and the tokens are those maps
 * plus the shape `themeTokens` ended up with.
 */
const buildStubs = (): {
  readonly stubs: Map<string, PlainRecord>;
  readonly light: Map<string, unknown>;
  readonly dark: Map<string, unknown>;
  readonly darkClassNames: string[];
} => {
  const light = new Map<string, unknown>();
  const dark = new Map<string, unknown>();
  const darkClassNames: string[] = [];
  let anonymous = 0;

  /** Pairs a contract's leaves with a value tree's leaves and records each assignment. */
  const assign = (contract: unknown, values: unknown, into: Map<string, unknown>): void => {
    for (const leaf of leavesOf(contract)) {
      const name = varOfContractLeaf(leaf.value);
      if (name === null) continue;

      let cursor: unknown = values;
      for (const segment of leaf.path) {
        cursor = isPlainRecord(cursor) ? cursor[segment] : undefined;
      }
      if (cursor !== undefined) into.set(name, cursor);
    }
  };

  const createGlobalTheme = (_selector: unknown, second: unknown, third?: unknown): unknown => {
    if (third === undefined) {
      // Two-argument form: the values ARE the contract's shape, and the names are derived from
      // the object path. Both halves come out of one walk.
      for (const leaf of leavesOf(second)) light.set(varNameOf(leaf.path), leaf.value);
      return contractOf(second);
    }
    // Three-argument form: an existing contract, assigned. Never called by this kit today
    // (`assignTokensContract` has no call site — S1 §1b), and modelled anyway because "not
    // called" and "not supported" are different promises.
    assign(second, third, light);
    return second;
  };

  const createTheme = (contract: unknown, values: unknown, debugId?: unknown): string => {
    assign(contract, values, dark);
    const name = typeof debugId === "string" ? debugId : `theme-${String((anonymous += 1))}`;
    darkClassNames.push(name);
    return name;
  };

  const inertString =
    (prefix: string) =>
    (...args: unknown[]): string =>
      `${prefix}-${String(typeof args[0] === "string" ? args[0] : (anonymous += 1))}`;

  const vanillaExtract: PlainRecord = {
    createGlobalTheme: createGlobalTheme as PlainRecord[string],
    createGlobalThemeContract: ((tokens: unknown) => contractOf(tokens)) as PlainRecord[string],
    createThemeContract: ((tokens: unknown) => contractOf(tokens)) as PlainRecord[string],
    createTheme: createTheme as PlainRecord[string],
    createVar: ((debugId?: unknown) =>
      `var(${varNameOf([typeof debugId === "string" ? debugId : `v${String((anonymous += 1))}`])})`) as PlainRecord[string],
    fallbackVar: ((...args: unknown[]) => String(args[0] ?? "")) as PlainRecord[string],
    assignVars: (() => ({})) as PlainRecord[string],
    layer: inertString("layer") as PlainRecord[string],
    globalLayer: inertString("layer") as PlainRecord[string],
    style: inertString("style") as PlainRecord[string],
    styleVariants: ((map: unknown) =>
      isPlainRecord(map)
        ? Object.fromEntries(Object.keys(map).map((key) => [key, `style-${key}`]))
        : {}) as PlainRecord[string],
    globalStyle: (() => undefined) as PlainRecord[string],
    keyframes: inertString("keyframes") as PlainRecord[string],
    globalKeyframes: (() => undefined) as PlainRecord[string],
    fontFace: inertString("font") as PlainRecord[string],
    globalFontFace: (() => undefined) as PlainRecord[string],
    composeStyles: ((...args: unknown[]) => args.filter(Boolean).join(" ")) as PlainRecord[string],
  };

  const stubs = new Map<string, PlainRecord>([
    ["@vanilla-extract/css", vanillaExtract],
    [
      "@vanilla-extract/css/functionSerializer",
      { addFunctionSerializer: (() => undefined) as PlainRecord[string] },
    ],
    ["@vanilla-extract/recipes", { recipe: recipeStub as PlainRecord[string] }],
    [
      "clsx",
      {
        default: ((...args: unknown[]) =>
          args.filter(Boolean).join(" ")) as unknown as PlainRecord[string],
        clsx: ((...args: unknown[]) =>
          args.filter(Boolean).join(" ")) as unknown as PlainRecord[string],
      },
    ],
  ]);

  return { stubs, light, dark, darkClassNames };
};

/** The two entry modules the token graph is reached through. */
const ENTRY_FILES = ["themeTokens.css.ts", "darkTheme.css.ts"] as const;

/**
 * Compiles and evaluates the EDS 2.x theme sources.
 *
 * @param paths The resolved v2 checkout.
 */
export const loadThemeSourceV2 = (paths: KitPathsV2): ThemeSourceV2 => {
  const entries = ENTRY_FILES.map((file) => {
    const candidate = join(paths.themeDir, file);
    if (!existsSync(candidate)) {
      throw new ExtractionError(
        `Theme entry "${file}" not found under "${paths.themeDir}". ` +
          "Check that the checkout is an EDS 2.x monorepo.",
      );
    }
    return candidate;
  });

  assertOnlyAllowedExternals(collectExternalImports(entries));

  const { stubs, light, dark, darkClassNames } = buildStubs();
  const namespaces = evaluateGraph(entries, stubs);

  const themeModule = namespaces.get(entries[0] ?? "");
  const tokens = themeModule?.[TOKEN_EXPORT_NAME];

  if (!isPlainRecord(tokens)) {
    throw new ExtractionError(
      `"${ENTRY_FILES[0]}" does not export an object named "${TOKEN_EXPORT_NAME}".`,
    );
  }

  return {
    tokens,
    light,
    dark,
    darkThemeClassName: [...darkClassNames].toSorted(compareStrings)[0] ?? null,
  };
};

/**
 * Resolves a value through the custom-property maps until no `var(--…)` is left.
 *
 * `mode` picks which map wins for the FIRST lookup of each name — the dark theme overrides only
 * `edsSys`, so everything it does not name falls through to the light map by design. The depth
 * cap turns a cyclic authoring mistake in the kit into a value that is returned as it stands
 * rather than into a hung extraction.
 */
export const resolveThemeValue = (
  value: unknown,
  theme: ThemeSourceV2,
  mode: "light" | "dark",
  depth = 0,
): unknown => {
  if (typeof value !== "string" || depth > 16) return value;

  const lookup = (name: string): unknown =>
    mode === "dark" && theme.dark.has(name) ? theme.dark.get(name) : theme.light.get(name);

  const whole = /^var\((--[^),]+)\)$/.exec(value.trim());
  if (whole?.[1] !== undefined) {
    const next = lookup(whole[1]);
    return next === undefined ? value : resolveThemeValue(next, theme, mode, depth + 1);
  }

  if (!value.includes("var(")) return value;

  const replaced = value.replace(/var\((--[^),]+)\)/g, (match, name: string) => {
    const next = lookup(name);
    return typeof next === "string" || typeof next === "number" ? String(next) : match;
  });

  return replaced === value ? value : resolveThemeValue(replaced, theme, mode, depth + 1);
};
