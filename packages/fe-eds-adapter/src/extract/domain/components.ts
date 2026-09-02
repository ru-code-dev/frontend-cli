import { z } from "zod";

import { diagnosticSchema } from "./tokens.ts";

/**
 * Wire contract for `artifacts/components.json`.
 *
 * What this artifact must answer for the downstream project analyser:
 *
 *  1. **Is symbol `X` part of the kit's public API?** → `publicSymbols`
 *  2. **What are the legal values of prop `view` on `Button`?** → `components[].variants`
 *  3. **Which style slots can be overridden?** → `components[].slots`
 *  4. **Which `@v-uik` package does a kit component wrap?** → `components[].externalDependencies`
 *     (a direct `@v-uik/*` import in consumer code bypasses the kit and is a violation)
 *  5. **What does the kit re-export wholesale from `@v-uik`?** → `externalReExports`
 *
 * Extraction is purely syntactic. The kit's `node_modules` are not installed, so no
 * type checker is available and nothing that requires cross-package type resolution is
 * claimed. Fields that could not be resolved are `null`/empty rather than guessed, and
 * every such gap is reported in `diagnostics`.
 */

export const exportKindSchema = z.enum([
  /** A React component (function/forwardRef/memo returning JSX). */
  "component",
  /** An interface or type alias. */
  "type",
  /** A runtime value that is not a component: constants, hooks, providers. */
  "value",
  /** Re-exported from a module the extractor could not resolve. */
  "unresolved",
]);

export const symbolOriginSchema = z.enum([
  /** Declared inside `packages/base/src`. */
  "local",
  /** Re-exported from a `@v-uik/*` package. */
  "external",
]);

export const componentDetectionSchema = z.enum([
  "forwardRef",
  "memo",
  "functionWithJsx",
  "arrowWithJsx",
  "classComponent",
  "reExportedAlias",
]);

export const sourceLocationSchema = z.object({
  /** Path relative to the UI kit root, POSIX separators. */
  file: z.string(),
  line: z.number().int().positive(),
});

export const docSchema = z.object({
  /** Leading JSDoc description with tags stripped; `null` when undocumented. */
  text: z.string().nullable(),
  deprecated: z.boolean(),
  /** Reason text from `@deprecated`, when present. */
  deprecationNote: z.string().nullable(),
  /** `true` when tagged `@inner` — internal API not intended for consumers. */
  inner: z.boolean(),
});

export const exportedSymbolSchema = z.object({
  /** Name as exported (after `as` renaming). */
  name: z.string().min(1),
  /** Name in the declaring module, when it differs from `name`. */
  localName: z.string().nullable(),
  kind: exportKindSchema,
  origin: symbolOriginSchema,
  /** Module specifier the symbol came from, for re-exports. */
  from: z.string().nullable(),
  location: sourceLocationSchema.nullable(),
  doc: docSchema,
});

export const propSchema = z.object({
  name: z.string().min(1),
  optional: z.boolean(),
  /** Type as written in source. Not normalised — unresolved cross-package types stay verbatim. */
  type: z.string(),
  doc: docSchema,
});

export const propsTypeSchema = z.object({
  /** Name of the interface or type alias, e.g. `ButtonProps`. */
  name: z.string().min(1),
  location: sourceLocationSchema,
  /**
   * Types this one extends, verbatim. Frequently references `@v-uik` types that cannot
   * be resolved, which is why `members` is a partial view of the real prop surface.
   */
  extends: z.array(z.string()),
  members: z.array(propSchema),
  doc: docSchema,
});

export const variantSetSchema = z.object({
  /** Identifier of the declaration, e.g. `views`, `sizes`, `ButtonIconSize`. */
  name: z.string().min(1),
  location: sourceLocationSchema,
  kind: z.enum([
    /** `const x = { a: 'A' } as const` — the kit's prop-value mapping convention. */
    "constObject",
    /** `type X = 'a' | 'b'` — a string-literal union. */
    "literalUnion",
  ]),
  /** Public keys, i.e. the values a consumer writes in JSX. */
  keys: z.array(z.string()),
  /** Key → underlying value passed down to `@v-uik`; empty for literal unions. */
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  /** Keys carrying a `@deprecated` JSDoc tag. */
  deprecatedKeys: z.array(z.string()),
});

export const slotSetSchema = z.object({
  /** Name of the classes type, e.g. `ButtonClasses`. */
  name: z.string().min(1),
  location: sourceLocationSchema,
  /** Slot names that can be targeted through the `classes` prop. */
  slots: z.array(
    z.object({
      name: z.string().min(1),
      doc: docSchema,
    }),
  ),
  /** Types the classes type intersects/extends but that could not be resolved. */
  unresolvedBases: z.array(z.string()),
});

export const componentAssetsSchema = z.object({
  stories: z.array(z.string()),
  docs: z.array(z.string()),
  testFiles: z.array(z.string()),
  /** Playwright visual-regression PNGs — a proxy for how thoroughly a component is pinned. */
  e2eSnapshots: z.number().int().nonnegative(),
  /** Files under `examples/` — usable as ground truth for correct component usage. */
  examples: z.number().int().nonnegative(),
});

export const reactComponentSchema = z.object({
  name: z.string().min(1),
  detection: componentDetectionSchema,
  location: sourceLocationSchema,
  /** Statically attached sub-components, e.g. `Button.Icon`. */
  subcomponents: z.array(z.string()),
  doc: docSchema,
});

export const uiKitComponentSchema = z.object({
  /** Directory name, which is also the conventional component name, e.g. `Button`. */
  name: z.string().min(1),
  directory: z.string(),
  /** Resolved barrel file for the directory; `null` when the directory has no entry point. */
  entryFile: z.string().nullable(),
  /** `true` when re-exported from `packages/base/src/components/index.ts`. */
  public: z.boolean(),
  deprecated: z.boolean(),

  exports: z.array(exportedSymbolSchema),
  components: z.array(reactComponentSchema),
  props: z.array(propsTypeSchema),
  variants: z.array(variantSetSchema),
  slots: z.array(slotSetSchema),
  assets: componentAssetsSchema,

  /** Non-relative packages imported anywhere in the directory, sorted. */
  externalDependencies: z.array(z.string()),
  /** Subset of `externalDependencies` under the `@v-uik` scope — the wrapped upstream. */
  wraps: z.array(z.string()),
});

export const barrelEntrySchema = z.object({
  /** Module specifier as written, e.g. `./Button` or `@v-uik/grid`. */
  specifier: z.string(),
  resolvedFile: z.string().nullable(),
  origin: symbolOriginSchema,
  /** `true` for `export * from '…'`. */
  star: z.boolean(),
  /** Explicitly named exports; empty for star re-exports. */
  names: z.array(z.string()),
  typeOnly: z.boolean(),
  location: sourceLocationSchema,
});

export const externalReExportSchema = z.object({
  /** The `@v-uik/*` (or other) package re-exported. */
  package: z.string(),
  star: z.boolean(),
  names: z.array(z.string()),
  /**
   * Always `false` in the current setup: the kit's `node_modules` are absent, so the
   * package's export list cannot be enumerated. Recorded explicitly so a consumer knows
   * this is a *known* gap and not an empty result.
   */
  resolved: z.boolean(),
  reExportedFrom: z.array(z.string()),
});

export const publicSymbolSchema = z.object({
  name: z.string().min(1),
  kind: exportKindSchema,
  origin: symbolOriginSchema,
  /** Owning component directory, when the symbol comes from one. */
  component: z.string().nullable(),
  /** Module specifier the symbol ultimately came from. */
  from: z.string().nullable(),
  deprecated: z.boolean(),
  /**
   * Reason text from `@deprecated`, when the kit gave one.
   *
   * Carried on the symbol rather than looked up through its owning component, because the
   * kit deprecates some exports in the barrel itself — `Input` is declared there and
   * belongs to no component directory, so there is nowhere else for the note to live.
   */
  deprecationNote: z.string().nullable(),
});

export const componentsArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/components@1"),
  meta: z.object({
    sourceRoot: z.string(),
    basePackageVersion: z.string().nullable(),
    /** Entry barrels the public surface was computed from. */
    barrels: z.array(z.string()),
    /**
     * `false` because the kit's dependencies are not installed. Everything derived from
     * cross-package types is therefore best-effort and marked as such.
     */
    typeCheckerAvailable: z.boolean(),
    counts: z.object({
      componentDirectories: z.number().int().nonnegative(),
      publicComponentDirectories: z.number().int().nonnegative(),
      reactComponents: z.number().int().nonnegative(),
      propsTypes: z.number().int().nonnegative(),
      props: z.number().int().nonnegative(),
      variantSets: z.number().int().nonnegative(),
      slotSets: z.number().int().nonnegative(),
      slots: z.number().int().nonnegative(),
      publicSymbols: z.number().int().nonnegative(),
      externalReExports: z.number().int().nonnegative(),
      deprecatedSymbols: z.number().int().nonnegative(),
    }),
  }),
  barrel: z.array(barrelEntrySchema),
  components: z.array(uiKitComponentSchema),
  externalReExports: z.array(externalReExportSchema),
  publicSymbols: z.array(publicSymbolSchema),
  diagnostics: z.array(diagnosticSchema),
});

export type ExportKind = z.infer<typeof exportKindSchema>;
export type SymbolOrigin = z.infer<typeof symbolOriginSchema>;
export type ComponentDetection = z.infer<typeof componentDetectionSchema>;
export type SourceLocationDto = z.infer<typeof sourceLocationSchema>;
export type DocDto = z.infer<typeof docSchema>;
export type ExportedSymbolDto = z.infer<typeof exportedSymbolSchema>;
export type PropDto = z.infer<typeof propSchema>;
export type PropsTypeDto = z.infer<typeof propsTypeSchema>;
export type VariantSetDto = z.infer<typeof variantSetSchema>;
export type SlotSetDto = z.infer<typeof slotSetSchema>;
export type ComponentAssetsDto = z.infer<typeof componentAssetsSchema>;
export type ReactComponentDto = z.infer<typeof reactComponentSchema>;
export type UiKitComponentDto = z.infer<typeof uiKitComponentSchema>;
export type BarrelEntryDto = z.infer<typeof barrelEntrySchema>;
export type ExternalReExportDto = z.infer<typeof externalReExportSchema>;
export type PublicSymbolDto = z.infer<typeof publicSymbolSchema>;
export type ComponentsArtifact = z.infer<typeof componentsArtifactSchema>;
