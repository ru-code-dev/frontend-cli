import type { Domain, Finding, Usage } from "./domain/findings.ts";
import type { Observations, TokenReference } from "./domain/observations.ts";
import type { StyleFactoryModule } from "./scanner/collectors/vanilla-extract.ts";
import type { Rule } from "./rules/types.ts";

/**
 * The pluggable seam. An adapter teaches this engine one specific design system.
 *
 * ## What an adapter is
 *
 * **An imported object, and nothing else.** It is constructed by its own package's `dist`,
 * which embeds whatever artifacts that design system needs as data. This engine never reads a
 * file to learn about a kit, never takes a directory of extracted artifacts, and never throws
 * because one is missing — the crash seam this port exists to remove (`ds-analyzer/src/cli/run-analyze.ts:56`,
 * an unguarded `readFileSync`, h2 §3) cannot reappear because there is no load step to fail.
 *
 * ## What the engine knows about a kit
 *
 * Nothing specific. It knows the *shapes* below: a list of package names it was handed, a set
 * of extra rules it was handed, and four narrow queries. No vendor scope, no artifact schema, no
 * token id, no component name appears anywhere in this package. Swap the adapter and the engine
 * speaks a different design system with no change here.
 *
 * ## What happens without one
 *
 * Bit-for-bit what happened before the seam existed: eleven generic rules, three domains, a
 * four-key summary, no `usage`, every `kitComponent` `null`. Every branch an adapter switches on
 * is written as "adapter present" rather than "adapter absent" for exactly that reason.
 */

/**
 * An ARIA pattern the kit's own components implement, as evidence rather than specification.
 *
 * Generic by construction: a component name, the roles it renders, the `KeyboardEvent.key`
 * values its implementation compares against, and whether it manages focus. Nothing here names
 * a particular design system.
 */
export interface KitPatternEvidence {
  readonly component: string;
  readonly roles: readonly string[];
  readonly keysHandled: readonly string[];
  readonly managesFocus: boolean;
}

/**
 * The queries the engine's *own* rules and metrics put to a kit.
 *
 * Deliberately tiny. Everything a kit-specific rule needs — colour matching, variant sets, slot
 * metadata, icon geometry — stays inside the adapter, where its rules can hold the artifacts
 * directly. This interface exists only for the handful of places where a **generic** rule has a
 * kit-aware branch, and for the two adapter-gated metrics sections.
 */
/**
 * How a kit's tokens are REFERENCED in consumer code, as data the scanner can act on.
 *
 * Two things live here and they are read by two different stages:
 *
 *  - `module`/`exportName` name the object a token path is rooted in. The SCANNER does not
 *    need them: it records whatever import a member path is rooted in, kit or not. They are
 *    here so an adapter has one place to state the fact and `expected.jsPath` can be built
 *    from it.
 *  - `styleFactories` is the part the scanner does need: modules whose exports produce
 *    vanilla-extract style objects (`makeStyles` and friends), which is what makes a file that
 *    never imports `@vanilla-extract/css` directly take part in the dialect anyway.
 *
 * Optional, and absent for a design system whose tokens are CSS custom properties — which is
 * the state every existing adapter is in, and the state in which nothing about a run changes.
 */
export interface TokenReferenceModel {
  readonly kind: "js-path";
  /**
   * EVERY module specifier the token object may be imported from — a LIST, not one string.
   *
   * A design system publishes the same object from its barrel, from a subpath export, and
   * often from a second package, and a consumer may reach it by any of them. Matching on one
   * spelling would silently drop the others; matching on the IDENTIFIER instead would be
   * worse, because a project is free to have a token object of its own under the same name.
   */
  readonly modules: readonly string[];
  /** Its exported name, e.g. `tokens`. */
  readonly exportName: string;
  /** @see StyleFactoryModule */
  readonly styleFactories?: readonly StyleFactoryModule[];
}

export interface KitBinding {
  /**
   * How many icons the kit's own set holds; `null` when it publishes none.
   * Read by `icon.foreign-pack`, which quotes the number in its explanation.
   */
  readonly iconCount: number | null;
  /**
   * Resolved colour of a CSS custom property that names a kit token, as a hex string.
   *
   * `a11y.contrast.text` needs it: `var(--…)` is the *correct* way to write a colour, and a
   * project that does it everywhere would otherwise be exempt from contrast checking entirely
   * — the one outcome that would make that rule reward the wrong behaviour.
   */
  readonly tokenColorHex: (cssVariable: string) => string | null;
  /** Token id behind a custom property, for the token-usage histogram. `null` when unknown. */
  readonly tokenIdOf: (cssVariable: string) => string | null;
  /**
   * The same two queries over a STRUCTURED reference, for the kind that is not a string.
   *
   * `color: tokens.sys.color.textPrimary` is a member expression: there is no custom
   * property to hand {@link KitBinding.tokenIdOf}, and by the time vanilla-extract has run the
   * property holds a hashed name nobody wrote. So the reference reaches a kit structurally,
   * through `StyleValue.reference`.
   *
   * SEPARATE MEMBERS rather than a widened parameter on the two above, and the reason is
   * mechanical rather than aesthetic: an adapter writes `tokenIdOf: (cssVariable) => …` and
   * lets the parameter be typed from this interface, so widening it to
   * `string | TokenReference` retypes that parameter inside every existing adapter and breaks
   * a package this change is required to leave untouched (design E7 — proven with `tsgo`, see
   * the report's DEVIATIONS). Additive members cost one `??` at each of the two call sites and
   * cost an untouched adapter nothing.
   *
   * `undefined` means the kit has no js-path model, which is a different fact from "this path
   * is not a token" and is treated as such: the reference is recorded either way, and only the
   * histogram entry is absent.
   */
  readonly tokenIdOfReference?: (reference: TokenReference) => string | null;
  readonly tokenColorHexOfReference?: (reference: TokenReference) => string | null;
  /** @see TokenReferenceModel */
  readonly tokenReferenceModel?: TokenReferenceModel;
  /** `true` when the kit's own accessibility evidence was built. */
  readonly a11yAvailable: boolean;
  /** The component to offer for an ARIA role, or `null`. Read by `a11y.pattern.focus`. */
  readonly canonicalComponentFor: (role: string) => KitPatternEvidence | null;
  /** Legal values of a prop, or `null` when the kit does not constrain it. */
  readonly variantValues: (component: string, prop: string) => readonly string[] | null;
  /** Public component names, sorted. */
  readonly componentNames: () => readonly string[];
}

/** What the engine hands an adapter that computes the adoption half of the summary. */
export interface KitMetricsInput {
  readonly usage: Usage;
  readonly findings: readonly Finding[];
  readonly observations: Observations;
  /** Files the run produced no finding for. */
  readonly cleanFiles: number;
}

export interface KitAdapter {
  /** Stable identifier, e.g. `"eds"`. Reported so a payload says which kit produced it. */
  readonly id: string;
  /** Packages that *are* the kit. Seeds the scanner's kit-source closure. */
  readonly kitPackages: readonly string[];
  /** Scope of the upstream library the kit wraps; `null` when it wraps nothing. */
  readonly wrappedUpstreamScope: string | null;
  /** Rules the kit contributes, appended to the generic registry. */
  readonly rules: readonly Rule[];
  /**
   * Generic rule ids this adapter takes over.
   *
   * One rule needs it today: the engine splits `component.duplicate` out of the hackathon's
   * `component.novel` so it can run kit-lessly, and an adapter that ports `component.novel`
   * whole — clustering included — must displace the split-out copy rather than double-report.
   */
  readonly replaces?: readonly string[];
  /** Extra domains the adapter's rules add to the default selection. */
  readonly domains?: readonly Domain[];
  /** @see KitBinding */
  readonly binding: KitBinding;
  /**
   * The kit-adoption half of the summary: health score, adoption, token coverage, positives,
   * kit gaps. Omitted by an adapter that has no opinion about them.
   */
  readonly summaryExtras?: (input: KitMetricsInput) => Partial<{
    healthScore: number;
    healthFormula: string;
    adoption: number;
    tokenCoverage: number;
    positives: { label: string; detail: string }[];
    kitGaps: { value: string; token: string; role: string; occurrences: number }[];
  }>;
}
