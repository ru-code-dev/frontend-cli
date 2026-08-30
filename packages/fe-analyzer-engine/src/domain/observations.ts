import { z } from "zod";

import { limitationSchema, styleSyntaxSchema } from "./profile.ts";

/**
 * The facts the collectors record. Ported from
 * `hackathon2026/ds-analyzer/src/domain/observations.ts:1-285`, field for field.
 *
 * This is the boundary where style syntax stops mattering. Above it live five collectors
 * that each know one dialect; below it live rules that know none. A new dialect is a new
 * collector and zero rule changes — that property is the whole reason the boundary exists,
 * and it only holds if nothing here leaks syntax.
 *
 * There is deliberately no notion of a *deviation* in this file. These are facts about what
 * the code contains, recorded without judgement.
 */

export const styleValueSourceSchema = styleSyntaxSchema;

/**
 * Where a class ultimately lands. Filled in by the linking pass, which is the only step
 * that can see style declarations and JSX at the same time.
 */
export const appliedToSchema = z.object({
  kind: z.enum(["kit-component", "local-component", "host-element", "unused"]),
  /** Component name for `local-component`, tag name for `host-element`. */
  name: z.string().nullable(),
  /** `classes` slot the declaration reaches, when it was applied through a slot map. */
  slot: z.string().nullable(),
});

export const styleValueSchema = z.object({
  /** CSS property name, always in CSS spelling (`font-size`, never `fontSize`). */
  property: z.string().min(1),
  /** Declaration value exactly as authored, after variable resolution where possible. */
  value: z.string(),
  /** Value before SCSS variable resolution, when it differed. */
  authored: z.string().nullable(),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  source: styleValueSourceSchema,
  /**
   * Selector or styled-component name the declaration belongs to, for display.
   * `null` for inline styles, which have no selector.
   */
  selector: z.string().nullable(),
  /** Bare CSS class names in `selector`, used to link declarations to JSX. */
  classNames: z.array(z.string()),
  important: z.boolean(),
  /**
   * `true` when the authored value contained an interpolation that could not be resolved.
   * The literal parts are still recorded; the finding is downgraded and the file is listed
   * under limitations rather than silently treated as clean.
   */
  dynamic: z.boolean(),
  /**
   * Declaration site of the variable the value came from, when it came from one. Fixing the
   * root repairs every usage, so the report groups by this rather than emitting N identical
   * findings.
   */
  rootCause: z
    .object({
      file: z.string(),
      line: z.number().int().positive(),
      name: z.string(),
    })
    .nullable(),
  appliedTo: appliedToSchema.nullable(),
});

export const styleRefSchema = z.object({
  /** `classes` slot name, or `null` when applied through plain `className`. */
  slot: z.string().nullable(),
  /** Local identifier of the style-module import, e.g. `styles`. */
  module: z.string(),
  /** Member read off it, e.g. `root`. */
  className: z.string(),
});

export const jsxElementSchema = z.object({
  /** Element name as written, e.g. `Button` or `div`. */
  name: z.string().min(1),
  /** Module specifier the name was imported from; `null` for host elements and locals. */
  resolvedFrom: z.string().nullable(),
  /**
   * Design-system component this element is.
   *
   * Structurally retained from the source contract and **never set** by this engine: naming
   * a component as "the kit's" requires the extracted kit artifacts this package does not
   * load. The rules that skip `kitComponent !== null` elements keep that guard as a
   * documented dead-false check rather than silently changing shape — see the DELTAS table.
   */
  kitComponent: z.string().nullable(),
  /** Literal prop values; `null` marks a prop whose value is an expression. */
  props: z.record(z.string(), z.string().nullable()),
  /**
   * Source text of the props {@link jsxElementSchema.shape.props} could not reduce to a
   * literal.
   *
   * Invariant, asserted in the collector's tests: a key is present here **if and only if**
   * `props[key] === null`. The two maps are one fact split by whether it is evaluable, not
   * two independent records — ``aria-controls={`panel-${id}`}`` has to be visible to the
   * rules as *something*, or a widget whose ARIA relations are built from a template reads
   * as a widget with no ARIA relations at all.
   *
   * This is source text, deliberately not an evaluated value: relation checks compare
   * whether two attributes are built from the same expression, which does not require
   * knowing what it evaluates to.
   */
  propExpressions: z.record(z.string(), z.string()),
  /** Event handler prop names present on the element, e.g. `['onClick', 'onKeyDown']`. */
  eventHandlers: z.array(z.string()),
  /**
   * Key names named literally inside this element's inline handlers, e.g. `['ArrowRight']`.
   *
   * Empty means one of two different things, and the rules must not conflate them: no keys
   * are referenced, or the handler is a bare reference (`onKeyDown={handleKey}`) whose body
   * lives elsewhere.
   */
  keysHandled: z.array(z.string()),
  /**
   * What the element's subtree could contribute to an accessible name.
   *
   * Three separate facts rather than one "has a label" boolean, because the accname
   * algorithm treats them differently and collapsing them is what makes a naming rule
   * useless. A first version of this recorded only direct text children and reported eleven
   * false positives out of eleven on the first real project it saw: every one was a button
   * whose text sat inside a `<span>`, or came from an expression.
   *
   *  - `text`       literal JSX text anywhere in the subtree — a name, definitively
   *  - `expression` an expression child anywhere — usually text, but unknowable
   *  - `component`  a child component that is not a recognisable icon — may render anything
   *
   * The rule may only report when all three are false: that is provable absence. Anything
   * else is a guess, and this is a rule where guessing costs more than silence.
   */
  content: z.object({
    text: z.boolean(),
    expression: z.boolean(),
    component: z.boolean(),
  }),
  /**
   * `true` when a `<label>` element encloses this one.
   *
   * Implicit labelling — `<label><span>Описание</span><textarea/></label>` — is valid HTML
   * and common. Without this the rule reports every correctly labelled form control.
   */
  hasLabelAncestor: z.boolean(),
  /** Source line of each prop, for precise finding coordinates. */
  propLines: z.record(z.string(), z.number().int().positive()),
  styleRefs: z.array(styleRefSchema),
  hasInlineStyle: z.boolean(),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const importSchema = z.object({
  specifier: z.string().min(1),
  /** Named bindings; `imported` is the exported name, `local` the local alias. */
  names: z.array(z.object({ imported: z.string(), local: z.string(), typeOnly: z.boolean() })),
  defaultImport: z.string().nullable(),
  namespaceImport: z.string().nullable(),
  typeOnly: z.boolean(),
  /** Resolution outcome; `unresolved` is recorded, never guessed around. */
  resolution: z.object({
    kind: z.enum(["relative", "alias", "package", "unresolved"]),
    /** Project-relative POSIX path for local resolutions; `null` for packages. */
    file: z.string().nullable(),
  }),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

/**
 * `export … from '…'` — recorded separately from imports because it is the mechanism by
 * which a project's own module re-publishes another module's symbols.
 */
export const reExportSchema = z.object({
  specifier: z.string().min(1),
  /** `exported` is the name consumers see; `local` the name in the source module. */
  names: z.array(z.object({ exported: z.string(), local: z.string(), typeOnly: z.boolean() })),
  /** `true` for `export * from '…'`, where the exported names cannot be enumerated. */
  star: z.boolean(),
  resolution: z.object({
    kind: z.enum(["relative", "alias", "package", "unresolved"]),
    file: z.string().nullable(),
  }),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const declarationSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["component", "styled-component", "hook", "other"]),
  /** Prop names read off the declared props type or the destructuring pattern. */
  props: z.array(z.string()),
  ariaRoles: z.array(z.string()),
  /** `aria-*` attribute names used, which carry as much signal as `role`. */
  ariaAttributes: z.array(z.string()),
  /** Lower-case host tags rendered directly, e.g. `button`, `dialog`. */
  nativeTags: z.array(z.string()),
  /** Parent>child chains, capped in depth, used as a structural fingerprint. */
  jsxShape: z.array(z.string()),
  /** CSS properties reachable from this declaration, for the style fingerprint. */
  cssProperties: z.array(z.string()),
  hasInlineSvg: z.boolean(),
  /**
   * Identifier-free token stream of the declaration body.
   *
   * Emitted here rather than recomputed later so that clone detection never has to
   * re-parse: the collectors are the only stage allowed to touch syntax.
   */
  astSignature: z.array(z.string()),
  /**
   * Event handler props and key names gathered across everything this declaration renders.
   *
   * Aggregated at the declaration because that is the scope a widget's keyboard contract
   * lives at: a dialog closes on `Escape` from a handler on its root, on its overlay, or in
   * an effect, and a rule asking "does this component handle Escape at all" must not depend
   * on which of those the author chose.
   */
  eventHandlers: z.array(z.string()),
  keysHandled: z.array(z.string()),
  /** Number of JSX elements rendered — a crude size proxy used to rank candidates. */
  elementCount: z.number().int().nonnegative(),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

/**
 * The version is bumped rather than the fields made optional, and that choice is the whole
 * point: an absent optional field and an empty array are indistinguishable at the rule, so a
 * keyboard rule reading an older cache would return zero findings and the report would say
 * "clean" about code nobody looked at. Silence that reads as a pass is the one failure mode
 * this engine refuses to ship.
 *
 * `@5` is the hackathon's own final version (`ds-analyzer/src/domain/observations.ts:245`);
 * the namespace is this package's because the payload differs by the two kit-shaped fields
 * dropped in `profile.ts` and by `declaration.kitComponentsUsed`.
 */
export const OBSERVATIONS_SCHEMA_ID = "fe-analyzer-engine/observations@5";

/**
 * One report from the canonical JSX accessibility linter.
 *
 * A fact, not a verdict: the rule fired at this position. What it means for the report —
 * severity, WCAG criterion, whether it is worth showing at all — is decided in the rules
 * stage, like every other observation.
 */
export const lintMessageSchema = z.object({
  /** Plugin rule name without its prefix, e.g. `alt-text`. */
  rule: z.string().min(1),
  message: z.string().min(1),
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const observationsSchema = z.object({
  $schema: z.literal(OBSERVATIONS_SCHEMA_ID),
  styleValues: z.array(styleValueSchema),
  jsxElements: z.array(jsxElementSchema),
  imports: z.array(importSchema),
  reExports: z.array(reExportSchema),
  declarations: z.array(declarationSchema),
  /** Reports from the canonical JSX accessibility linter; see `collectors/jsx-a11y-lint.ts`. */
  lintMessages: z.array(lintMessageSchema),
  /** Files walked without error, project-relative, sorted. Used for "clean file" metrics. */
  files: z.array(z.string()),
  limitations: z.array(limitationSchema),
});

export type AppliedTo = z.infer<typeof appliedToSchema>;
export type StyleValue = z.infer<typeof styleValueSchema>;
export type StyleRef = z.infer<typeof styleRefSchema>;
export type JsxElement = z.infer<typeof jsxElementSchema>;
export type ImportRecord = z.infer<typeof importSchema>;
export type ReExportRecord = z.infer<typeof reExportSchema>;
export type Declaration = z.infer<typeof declarationSchema>;
export type LintMessage = z.infer<typeof lintMessageSchema>;
export type Observations = z.infer<typeof observationsSchema>;
