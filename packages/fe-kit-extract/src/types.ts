/**
 * The output schema of `fe-kit-extract`.
 *
 * Every field is DESCRIPTIVE: it records what the TypeScript checker and the syntax tree say,
 * never a judgment about what a component "is for". There are no ARIA roles, no
 * control/layout/atom classifications, and no kit-specific vocabulary anywhere in here.
 */

export const SCHEMA_VERSION = 1 as const;

/** How sure the tool is about the root DOM element a component renders. */
export type RenderConfidence =
  /** A literal intrinsic JSX tag was reached statically inside this component's own implementation. */
  | "certain"
  /** The root is another kit component; the element below is that component's element. */
  | "delegated"
  /** Not decidable without running the code. `element` is `null` and `reason` says why. */
  | "unknown";

export interface RendersInfo {
  /** Lowercase intrinsic tag name (`"button"`, `"div"`, …) or `null` when unknown. */
  element: string | null;
  confidence: RenderConfidence;
  /** Kit components traversed to reach `element`, outermost first. Empty unless delegated. */
  via: string[];
  /** Machine-stable reason, present only when `confidence` is `"unknown"`. */
  reason: string | null;
}

export interface PropProvenance {
  /** Name of the interface / type alias that declares the property. */
  name: string;
  /** Declaring file, relative to the kit root. */
  file: string;
}

export interface PropEntry {
  name: string;
  /** Exact resolved type text with unions spelled out; `undefined` stripped from optionals. */
  type: string;
  required: boolean;
  from: PropProvenance;
}

export interface PolymorphicInfo {
  /** The prop that selects the rendered element/component (`"as"`, `"forwardedAs"`, …). */
  prop: string;
  /** Statically known default, or `null` when there is none. */
  default: string | null;
}

export type JsxRootKind = "intrinsic" | "component" | "dynamic" | "fragment" | "none";

export interface SnapshotRoot {
  /** Tag exactly as written (`"button"`, `"Box"`, `"Tag"`), or `null` when there is no root. */
  tag: string | null;
  kind: JsxRootKind;
  /** Attribute names on the root, sorted; a spread is recorded as `"..."`. */
  attributes: string[];
  /** Distinct child node kinds on the root, sorted. */
  children: string[];
}

export interface ComponentSnapshot {
  root: SnapshotRoot;
  /** `name: type` / `name?: type` lines, sorted — the flattened kit-authored prop signature. */
  props: string[];
}

export interface ComponentEntry {
  /** Key under which this component appears in `components` (`"Card.Header"` for subcomponents). */
  name: string;
  /** `name` field of the owning package's `package.json`. */
  package: string;
  /** Defining file, relative to the kit root. */
  source: string;
  /** Every kit-authored prop, flattened through the checker, sorted by name. */
  props: PropEntry[];
  /** Collapsed raw DOM prop set, e.g. `"button"`. `null` when the component takes none. */
  extendsHtml: string | null;
  /** Other externally-declared prop sets that carried no element literal, sorted. */
  extendsExternal: string[];
  renders: RendersInfo;
  polymorphic: PolymorphicInfo | null;
  /** Sub-names assigned onto this component (`["Footer", "Header"]`), sorted. */
  subcomponents: string[];
  /** For a subcomponent entry: the parent component key. */
  parent: string | null;
  /** For a subcomponent entry: the standalone export name of the same declaration, if any. */
  alsoExportedAs: string | null;
  snapshot: ComponentSnapshot;
}

export type TypeKind = "interface" | "type-alias" | "enum" | "class" | "unknown";

export interface TypeEntry {
  name: string;
  package: string;
  source: string;
  kind: TypeKind;
  /** Checker-resolved text with unions spelled out. */
  text: string;
}

export interface UnresolvedEntry {
  /** `"<package>"` for package-level problems, `"<package>#<export>"` for a single export. */
  export: string;
  reason: string;
}

export interface KitPackageEntry {
  name: string;
  /** Package directory, relative to the kit root. */
  dir: string;
  version: string;
  /** Resolved entry file relative to the kit root, or `null` when none was found. */
  entry: string | null;
}

export interface KitInfo {
  name: string;
  version: string;
  packages: KitPackageEntry[];
  /** The tsconfig the ts-morph project was built from, relative to the kit root, or `null`. */
  tsconfig: string | null;
  /** Which compiler options were used — see `DEFAULT_COMPILER_OPTIONS_DOC`. */
  compilerOptions: "tsconfig" | "defaults";
}

export interface KitExtract {
  schemaVersion: typeof SCHEMA_VERSION;
  kit: KitInfo;
  components: Record<string, ComponentEntry>;
  types: Record<string, TypeEntry>;
  /** Every export the tool could not fully resolve. Never empty by omission. */
  unresolved: UnresolvedEntry[];
}

export interface ExtractOptions {
  /** Directory holding the kit's packages. */
  packagesDir: string;
  /** Directory-name / package-name globs to skip (`*` and `?` supported). */
  exclude?: readonly string[];
}
