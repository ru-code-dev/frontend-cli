import {
  colorDistance,
  compareStrings,
  parseColor,
  sortStrings,
  type ColorRole,
  type ColorValue,
  type DimensionScaleName,
  type StyleValue,
} from "@smart-tools/fg-analyzer-engine";

import type {
  ComponentsArtifact,
  ThemeModeName,
  TokenDto,
  TokensArtifact,
  UiKitComponentDto,
} from "../domain/artifacts.ts";
import { EDS_PROFILES, type KitProfile } from "../profile.ts";

/**
 * Query facade over the embedded kit specification. Ported from
 * `hackathon2026/ds-analyzer/src/kit/spec.ts:1-523`, with `KitSpec.load(artifactsDir)`
 * (200-208) removed: this class is constructed from objects the bundle already holds, so the
 * `readFileSync` that could throw is gone rather than guarded.
 *
 * The artifacts are optimised for completeness; the rules need answers. Everything here is an
 * index built once per run so that no rule ever scans 2192 tokens.
 *
 * The interesting logic is colour suggestion. Forty-five tokens can hold one hex, and handing
 * the developer an arbitrary one of them is only marginally better than handing them nothing.
 * The kit names its semantic tokens after the role they play — `Background.*`, `Foreground.*`,
 * `Border.*` — so the property the literal was written on selects among them.
 */

export type ColorMatchKind = "exact" | "near" | "shade" | "foreign";

/** Perceptual thresholds in OKLab (architecture.md §5.1). */
export const COLOR_THRESHOLDS = { near: 0.02, shade: 0.1 } as const;

/**
 * Alpha tolerance for nearest-token search.
 *
 * OKLab distance is computed on RGB alone, so a 12%-opacity shadow is zero distance from the
 * solid colour it is derived from. Suggesting the solid token there would be confidently wrong,
 * which is the worst kind of wrong a linter can be.
 */
const ALPHA_TOLERANCE = 0.02;

export interface ColorMatch {
  readonly kind: ColorMatchKind;
  /** Best token to suggest, or `null` when the kit offers nothing sensible. */
  readonly token: TokenDto | null;
  /** OKLab distance to `token`; `0` for an exact match. */
  readonly distance: number;
  /**
   * `true` when the value exists in the kit but not as a semantic token for this property's
   * role. The fix still works, but it will not follow the theme — and the absence is worth
   * reporting back to the design-system team.
   */
  readonly roleGap: boolean;
  /**
   * `true` when {@link token} may be handed to the developer as the replacement.
   *
   * ALWAYS TRUE FOR A KIT WHOSE `tierViolation` IS `same-role-only`, which is EDS 1.x: there,
   * a palette entry offered where no semantic twin exists is the best available advice and the
   * only advice, and `rules/tokens/tier.ts` explains why demanding more would be demanding a
   * fix nobody can write.
   *
   * FALSE UNDER `any-colour` when the kit's nearest answer is one this kit forbids product code
   * to name. EDS 2.x's primitive tiers are its own composition layer, so `themeTokens.ref.
   * palette.orchid40` pasted out of a finding is a `token.tier.violation` on the next run — the
   * tool's own fix creating the tool's own error (V6 audit finding #1, four of eleven colour
   * fixes on the v2 fixture). The same applies to a semantic token of the WRONG role: this
   * file's own ranking already holds that offering a foreground token for a background "reads
   * as approval of a role confusion", and the palette fallback that made that acceptable under
   * v1 is not available here. So the finding still GRADES the colour — `token`, `distance` and
   * `alternatives` all describe the nearest thing the kit has — and offers no replacement,
   * which the rule says out loud in its `note` rather than leaving as an absence.
   */
  readonly offerable: boolean;
  /** Other tokens holding the same value, for the drill-down panel. */
  readonly alternatives: string[];
}

export interface TypographyTuple {
  /** Parent path, e.g. `sys.Typography.Body.BodyM`. */
  readonly id: string;
  readonly fontFamily: string | null;
  readonly fontSize: string | null;
  readonly fontWeight: string | null;
  readonly lineHeight: string | null;
  readonly letterSpacing: string | null;
}

export interface TypographyMatch {
  readonly tuple: TypographyTuple;
  readonly matched: number;
  readonly compared: number;
  /** Fields present in the code that disagree with the tuple. */
  readonly mismatches: {
    readonly property: string;
    readonly actual: string;
    readonly expected: string;
  }[];
}

interface ColorCandidate {
  readonly token: TokenDto;
  readonly hex: string;
  readonly color: ColorValue;
  readonly role: ColorRole | null;
}

const ROLE_BY_PATH_PREFIX: readonly (readonly [string, ColorRole])[] = [
  ["Background", "background"],
  ["BackgroundConst", "background"],
  ["Foreground", "foreground"],
  ["ForegroundConst", "foreground"],
  ["Border", "border"],
  ["BorderConst", "border"],
];

/**
 * Role a SEMANTIC token's own name declares; `null` for primitives and for unnamed groups.
 *
 * Which tiers are semantic is the profile's answer, not this file's: EDS 1.x says `sys`, EDS 2.x
 * says `edsSys` and `sys` — and a v2 `sys.color.*` is a different thing from a v1
 * `sys.Background.*` (S1 break V5), which is exactly why the tier names cannot be literals here.
 */
const roleOfToken = (token: TokenDto, profile: KitProfile): ColorRole | null => {
  if (!profile.tokens.semantic.includes(token.tier)) {
    return null;
  }

  const group = token.path[0] ?? "";

  return ROLE_BY_PATH_PREFIX.find(([prefix]) => prefix === group)?.[1] ?? null;
};

/**
 * `*Const` groups hold colours that are deliberately identical in both themes.
 *
 * That is a specific intent — "this must NOT follow the theme" — and offering such a token to
 * somebody who merely wrote a hex is putting words in their mouth. When the property gives no
 * role to match against, the plain palette entry is the honest suggestion and the const token
 * stays available as an alternative.
 */
const isThemeInvariantGroup = (token: TokenDto): boolean => (token.path[0] ?? "").endsWith("Const");

/**
 * Ranking when the property gives no role away (`box-shadow`, TS string literals).
 *
 * `ref` wins over `sys` here — the opposite of the known-role order. A role token is a semantic
 * claim ("this shadow is a page background"), and with no role context the analyzer cannot back
 * that claim; the palette twin is the same paint with nothing asserted. The sys candidates still
 * reach the reader through `alternatives`.
 */
const rankWithoutRole = (token: TokenDto, profile: KitProfile): number => {
  if (profile.tokens.primitive.includes(token.tier)) {
    return 0;
  }
  if (profile.tokens.semantic.includes(token.tier)) {
    return isThemeInvariantGroup(token) ? 2 : 1;
  }

  return 3;
};

/**
 * Whether a candidate may be OFFERED as the fix for a literal written on a property of `role`.
 *
 * A pure function of the PROFILE, so it states a property of the design system rather than a
 * branch on which one is loaded. `same-role-only` kits — EDS 1.x — say yes to everything: the
 * palette entry is legal product code there, and it is what the exact/near ranking below is
 * built to fall back to.
 *
 * `any-colour` kits say yes only to a semantic token that carries the property's own role,
 * because both fallbacks the ranking would otherwise reach for are unusable: the palette entry
 * is itself a `token.tier.violation` (V6 finding #1), and a semantic token of another role is
 * the role confusion {@link KitSpec.rankExact} already refuses to prefer. When the property
 * names no role — `box-shadow`, a bare TS literal — any semantic token qualifies, since there
 * is no role for it to contradict.
 */
const isOfferable = (
  candidate: ColorCandidate,
  role: ColorRole | null,
  profile: KitProfile,
): boolean =>
  profile.tokens.tierViolation !== "any-colour" ||
  (profile.tokens.semantic.includes(candidate.token.tier) &&
    (role === null || candidate.role === role));

/**
 * The style dialects whose values are JAVASCRIPT, not CSS text.
 *
 * A replacement offered for a declaration in one of these is pasted into an object literal, so
 * the token has to arrive as a member path; everything else — `.css`, `.scss`, css-modules and
 * the styled/emotion template literals, which are CSS with holes in it — takes the custom
 * property, because `themeTokens.edsSys.Background.backAccent` written between two braces in a
 * stylesheet is not a value any browser has heard of (V6 audit finding #4).
 *
 * A SET rather than a predicate on the file extension: the collectors have already decided what
 * each value is, and re-deriving it from a path would disagree with them the first time a
 * `.ts` file holds `style({…})` — which under EDS 2.x is every file.
 */
const JS_OBJECT_SYNTAXES: ReadonlySet<StyleValue["source"]> = new Set([
  "vanilla-extract",
  "inline-style",
  "jss",
  "ts-literal",
]);

const normaliseTypographyValue = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export class KitSpec {
  private readonly candidates: ColorCandidate[];
  private readonly byId: ReadonlyMap<string, TokenDto>;
  private readonly byCssVariable: ReadonlyMap<string, TokenDto>;
  /** `themeTokens.edsSys.Background.backAccent` → the token. Empty for a css-var-only kit. */
  private readonly byJsPath: ReadonlyMap<string, TokenDto>;
  /** Every dotted prefix under which at least one token lives — what expands a group SPREAD. */
  private readonly jsPathGroups: ReadonlySet<string>;
  private readonly componentsByName: ReadonlyMap<string, UiKitComponentDto>;
  private readonly deprecatedSymbols: ReadonlyMap<string, string | null>;
  private readonly componentByWrappedPackage: ReadonlyMap<string, string>;
  private readonly typography: TypographyTuple[];
  private readonly fontFamilies: ReadonlySet<string>;

  readonly tokens: TokensArtifact;
  readonly components: ComponentsArtifact;
  readonly mode: ThemeModeName;
  /** Which design system this is. Every tier, channel and naming question is answered here. */
  readonly profile: KitProfile;

  constructor(
    tokens: TokensArtifact,
    components: ComponentsArtifact,
    mode: ThemeModeName = "light",
    profile: KitProfile = EDS_PROFILES.eds,
  ) {
    this.tokens = tokens;
    this.components = components;
    this.mode = mode;
    this.profile = profile;

    const byId = new Map<string, TokenDto>();
    const byCssVariable = new Map<string, TokenDto>();
    const byJsPath = new Map<string, TokenDto>();
    const jsPathGroups = new Set<string>();
    const candidates: ColorCandidate[] = [];

    for (const token of tokens.tokens) {
      byId.set(token.id, token);

      if (token.cssVariable !== null) {
        byCssVariable.set(token.cssVariable, token);
      }

      const jsPath = token.jsPath ?? null;
      if (jsPath !== null) {
        byJsPath.set(jsPath, token);
        // Every proper prefix, so a SPREAD of a whole group — `...themeTokens.edsSys.Typography.
        // Body.BodyM` — can be answered with "yes, that names five of my tokens" instead of
        // becoming an `unresolved-token-reference` limitation on code that is entirely correct.
        const segments = jsPath.split(".");
        for (let index = 2; index < segments.length; index += 1) {
          jsPathGroups.add(segments.slice(0, index).join("."));
        }
      }

      // `comp` tokens are empty contracts under both profiles: EDS 1.x emits no custom property
      // for them and EDS 2.x never assigns them a value. Suggesting one would produce a fix
      // that compiles to nothing.
      if (token.tier === "comp" || token.color === null) {
        continue;
      }

      const color = token.color[mode] ?? token.color.light;
      if (color === null) {
        continue;
      }

      const parsed = parseColor(color.hex);
      if (parsed !== null) {
        candidates.push({
          token,
          hex: color.hex,
          color: parsed,
          role: roleOfToken(token, profile),
        });
      }
    }

    this.byId = byId;
    this.byCssVariable = byCssVariable;
    this.byJsPath = byJsPath;
    this.jsPathGroups = jsPathGroups;
    this.candidates = candidates.toSorted((left, right) =>
      compareStrings(left.token.id, right.token.id),
    );

    this.componentsByName = new Map(
      components.components.map((component) => [component.name, component]),
    );

    this.deprecatedSymbols = new Map(
      components.publicSymbols
        .filter((symbol) => symbol.deprecated)
        .map((symbol) => [symbol.name, symbol.deprecationNote]),
    );

    this.componentByWrappedPackage = new Map(
      components.components.flatMap((component) =>
        component.wraps.map((pkg) => [pkg, component.name] as const),
      ),
    );

    this.typography = KitSpec.buildTypography(tokens, mode, profile);

    this.fontFamilies = new Set(
      tokens.scales.fontFamilies.flatMap((stack) =>
        stack.split(",").map((family) => family.trim().toLowerCase()),
      ),
    );
  }

  private static buildTypography(
    tokens: TokensArtifact,
    mode: ThemeModeName,
    profile: KitProfile,
  ): TypographyTuple[] {
    const groups = new Map<string, Record<string, string>>();
    const { tier, group: root } = profile.tokens.typography;

    for (const token of tokens.tokens) {
      if (token.tier !== tier || token.path[0] !== root) {
        continue;
      }

      const id = `${token.tier}.${token.path.slice(0, -1).join(".")}`;
      const value = token.resolved[mode];
      if (value === null || value === undefined) {
        continue;
      }

      const group = groups.get(id) ?? {};
      group[token.key] = String(value);
      groups.set(id, group);
    }

    return [...groups.entries()]
      .map(([id, fields]) => ({
        id,
        fontFamily: fields["fontFamily"] ?? null,
        fontSize: fields["fontSize"] ?? null,
        fontWeight: fields["fontWeight"] ?? null,
        lineHeight: fields["lineHeight"] ?? null,
        letterSpacing: fields["letterSpacing"] ?? null,
      }))
      .toSorted((left, right) => compareStrings(left.id, right.id));
  }

  tokenById(id: string): TokenDto | null {
    return this.byId.get(id) ?? null;
  }

  tokenByCssVariable(name: string): TokenDto | null {
    return this.byCssVariable.get(name) ?? null;
  }

  /**
   * The token a member path names, e.g. `themeTokens.edsSys.Background.backAccent`.
   *
   * The SECOND reference channel, and the whole of what makes a `.css.ts` project measurable:
   * by the time vanilla-extract has run, `color: themeTokens.edsSys.Foreground.foreParagraph`
   * is a hashed custom property nobody wrote, so a rule that only knew `var(--…)` would read a
   * perfectly token-driven project as one that references nothing.
   */
  tokenByJsPath(path: string): TokenDto | null {
    return this.byJsPath.get(path) ?? null;
  }

  /** `true` when at least one token lives under this dotted prefix — a spreadable group. */
  isTokenGroup(path: string): boolean {
    return this.jsPathGroups.has(path);
  }

  /**
   * A structured reference from the engine, resolved to a token — either channel.
   *
   * A js-path is matched by IMPORT SOURCE and export name, never by identifier: a project is
   * free to have a `themeTokens` of its own, and the kit's showroom does (S1 trap T1).
   */
  tokenForReference(reference: {
    readonly kind: "css-var" | "js-path";
    readonly name?: string;
    readonly module?: string;
    readonly exportName?: string;
    readonly path?: readonly string[];
  }): TokenDto | null {
    if (reference.kind === "css-var") {
      return reference.name === undefined ? null : this.tokenByCssVariable(reference.name);
    }

    const model = this.profile.tokenReference.jsPath;
    if (
      model === null ||
      reference.module === undefined ||
      !model.modules.includes(reference.module) ||
      reference.exportName !== model.exportName
    ) {
      return null;
    }

    return this.tokenByJsPath([model.exportName, ...(reference.path ?? [])].join("."));
  }

  /**
   * The token id behind a reference, INCLUDING a spread of a whole group.
   *
   * A group is not a token and has no value, so it cannot be `tokenForReference`'s answer — but
   * it is a resolved reference, and answering `null` for one would make the engine record an
   * `unresolved-token-reference` limitation against code that applies a complete typographic
   * ramp correctly (design §6's spread rule).
   */
  tokenIdForReference(reference: {
    readonly kind: "css-var" | "js-path";
    readonly name?: string;
    readonly module?: string;
    readonly exportName?: string;
    readonly path?: readonly string[];
    readonly spread?: boolean;
  }): string | null {
    const token = this.tokenForReference(reference);
    if (token !== null) return token.id;

    if (reference.kind !== "js-path" || reference.spread !== true) return null;

    const model = this.profile.tokenReference.jsPath;
    if (model === null) return null;

    const jsPath = [model.exportName, ...(reference.path ?? [])].join(".");
    return this.isTokenGroup(jsPath) ? (reference.path ?? []).join(".") : null;
  }

  /**
   * The `expected` block for a token, with BOTH channels filled and the one THIS FILE can hold
   * as `value`.
   *
   * One function so that fifteen rules cannot disagree about which spelling to offer, and so
   * that adding a third channel one day is one edit rather than fifteen.
   *
   * ## Why the file decides and not the profile
   *
   * `value` is the paste-ready text: `FindingCard.tsx:156` states the invariant that it is
   * what the reader copies into the line the finding points at. A profile-wide preference
   * cannot honour that, because a kit's consumers write more than one dialect — EDS 2.x's
   * profile declares `vanilla-extract`, `inline-style`, `css` and `css-modules` — and a JS
   * member path pasted into a `.css` is not CSS (V6 audit finding #4). So the channel is
   * chosen by the SYNTAX the finding was observed in: a value living in CSS text gets the
   * custom property, a value living in a JavaScript object gets the member path.
   *
   * `syntax` is optional for the callers that have no style value to speak of — a component's
   * documented prop, a corpus query in a test — and those fall back to the profile's `prefer`,
   * which is what this function did for every caller before.
   */
  expectedFor(
    token: TokenDto,
    component: string | null = null,
    syntax?: StyleValue["source"],
  ): {
    readonly token: string;
    readonly cssVar: string | null;
    readonly jsPath?: string;
    readonly component: string | null;
    readonly value: string;
  } | null {
    const cssVar = token.cssVariable;
    const jsPath = token.jsPath ?? null;
    const preferJsPath = this.prefersJsPath(syntax) && jsPath !== null;

    const value = preferJsPath ? jsPath : cssVar === null ? null : `var(${cssVar})`;
    // A token a consumer cannot name in either channel is not a suggestion, it is a dead end.
    if (value === null) return null;

    return {
      token: token.id,
      cssVar,
      // OMITTED, never `null`-filled, when the kit publishes no member path. `Expected.jsPath`
      // is optional in the engine's schema for exactly this reason: zod rebuilds a parsed
      // object in schema order, so a `null` here would write `"jsPath": null` into every EDS
      // 1.x finding and break the parity goldens this package must keep byte-identical
      // (`WORKFLOW/features/eds2/reports/a8-engine-vanilla-jspath.md` §7, D1).
      ...(jsPath === null ? {} : { jsPath }),
      component,
      value,
    };
  }

  /**
   * Which channel a replacement is spelled in for a value observed in `syntax`.
   *
   * Two guards, and both are load-bearing. A kit with NO member path — EDS 1.x — answers `no`
   * whatever the syntax, so its findings keep the `var(--sds-eng-…)` they have always carried
   * and the parity goldens cannot move. A caller with no syntax to offer falls back to the
   * profile's declared preference, which is what every caller got before V6 finding #4.
   */
  private prefersJsPath(syntax?: StyleValue["source"]): boolean {
    if (this.profile.tokenReference.jsPath === null) return false;

    return syntax === undefined
      ? this.profile.tokenReference.prefer === "js-path"
      : JS_OBJECT_SYNTAXES.has(syntax);
  }

  /** `true` when the id names a token of a tier this kit calls semantic. */
  isSemanticTokenId(id: string): boolean {
    return this.profile.tokens.semantic.some((tier) => id.startsWith(`${tier}.`));
  }

  get scales(): TokensArtifact["scales"] {
    return this.tokens.scales;
  }

  /**
   * Finds the kit's best answer to a raw colour.
   *
   * Exact matches are ranked by role, because there the choice is between equally correct
   * tokens and only the role tells them apart. Near misses are ranked by distance alone: when
   * the developer has typed a colour one channel away from a token, proximity is the evidence,
   * and a role-preferred token that is visibly further away is the wrong answer.
   */
  matchColor(rawValue: string, role: ColorRole | null): ColorMatch | null {
    const parsed = parseColor(rawValue);
    if (parsed === null) {
      return null;
    }

    const exact = this.candidates.filter((candidate) => candidate.hex === parsed.hex);

    if (exact.length > 0) {
      const chosen = KitSpec.rankExact(exact, role, this.profile);
      const hasRoleToken = role !== null && exact.some((candidate) => candidate.role === role);

      return {
        kind: "exact",
        token: chosen.token,
        distance: 0,
        roleGap: role !== null && !hasRoleToken,
        offerable: isOfferable(chosen, role, this.profile),
        alternatives: sortStrings(
          exact.map((candidate) => candidate.token.id).filter((id) => id !== chosen.token.id),
        ),
      };
    }

    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearest: ColorCandidate[] = [];

    for (const candidate of this.candidates) {
      if (Math.abs(candidate.color.rgba.a - parsed.rgba.a) >= ALPHA_TOLERANCE) {
        continue;
      }

      const distance = colorDistance(parsed, candidate.color);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = [candidate];
      } else if (distance === nearestDistance) {
        // Several tokens can hold the same colour, so the nearest match is frequently a tie.
        // Proximity picks the value; role and tier then pick which token names it.
        nearest.push(candidate);
      }
    }

    const chosen = nearest.length === 0 ? null : KitSpec.rankExact(nearest, role, this.profile);

    if (chosen === null || nearestDistance >= COLOR_THRESHOLDS.shade) {
      return {
        kind: "foreign",
        token: chosen?.token ?? null,
        distance: chosen === null ? 1 : nearestDistance,
        roleGap: false,
        // A `foreign` match is never offered as a replacement by any rule, whatever the kit —
        // the field is filled truthfully anyway so that no caller has to know that.
        offerable: chosen !== null && isOfferable(chosen, role, this.profile),
        alternatives: [],
      };
    }

    return {
      kind: nearestDistance < COLOR_THRESHOLDS.near ? "near" : "shade",
      token: chosen.token,
      distance: nearestDistance,
      roleGap: false,
      offerable: isOfferable(chosen, role, this.profile),
      alternatives: sortStrings(
        nearest.map((candidate) => candidate.token.id).filter((id) => id !== chosen.token.id),
      ),
    };
  }

  /**
   * Picks among tokens that all hold the requested colour.
   *
   * With a role: a semantic token of that role, else the raw palette colour, else a semantic
   * token of some other role. The middle step matters — offering a foreground token for a
   * background is worse advice than offering the palette entry, because it reads as approval of
   * a role confusion.
   *
   * Without a role: semantic before palette, then by id so the choice is reproducible.
   */
  private static rankExact(
    candidates: readonly ColorCandidate[],
    role: ColorRole | null,
    profile: KitProfile,
  ): ColorCandidate {
    const bucketOf = (candidate: ColorCandidate): number => {
      if (role === null) {
        return rankWithoutRole(candidate.token, profile);
      }
      if (candidate.role === role) {
        return 0;
      }
      return profile.tokens.primitive.includes(candidate.token.tier) ? 1 : 2;
    };

    const [best] = [...candidates].toSorted(
      (left, right) =>
        // OFFERABILITY OUTRANKS EVERYTHING, so that a tie between a palette entry and a semantic
        // token of the right role resolves to the one the reader is allowed to paste. Constant
        // for every candidate under `same-role-only`, which is why EDS 1.x's ranking — and its
        // byte-identical parity goldens — cannot notice this line.
        Number(!isOfferable(left, role, profile)) - Number(!isOfferable(right, role, profile)) ||
        bucketOf(left) - bucketOf(right) ||
        compareStrings(left.token.id, right.token.id),
    );

    if (best === undefined) {
      // Both call sites filter first; an empty list here would be a bug in this file.
      throw new Error("rankExact requires at least one candidate");
    }

    return best;
  }

  /** Semantic token of `role` holding `rawValue`, for the tier-violation rule. */
  semanticTokenFor(rawValue: string, role: ColorRole | null): TokenDto | null {
    const parsed = parseColor(rawValue);
    if (parsed === null) {
      return null;
    }

    const match = this.candidates.find(
      (candidate) =>
        candidate.hex === parsed.hex &&
        this.profile.tokens.semantic.includes(candidate.token.tier) &&
        (role === null || candidate.role === role),
    );

    return match?.token ?? null;
  }

  /** Values on a named scale. */
  scaleValues(scale: DimensionScaleName): readonly number[] {
    return this.tokens.scales[scale];
  }

  /** The two scale values bracketing `px`, for the "nearest legal value" hint. */
  neighboursOnScale(px: number, scale: DimensionScaleName): number[] {
    const values = this.scaleValues(scale);
    const below = [...values].findLast((value) => value < px);
    const above = [...values].find((value) => value > px);

    return [below, above].filter((value): value is number => value !== undefined);
  }

  /**
   * The two values of the kit's WHOLE dimension set bracketing `px`.
   *
   * The named-ramp twin of {@link neighboursOnScale}, for properties no ramp governs. Only
   * meaningful for a kit whose theme actually resolves to a spacing scale — which is what
   * `KitProfile.dimensions.scaleless` decides.
   */
  neighboursOnAllDimensions(px: number): number[] {
    const values = this.tokens.scales.allDimensionPx;
    const below = [...values].findLast((value) => value > 0 && value < px);
    const above = [...values].find((value) => value > px);

    return [below, above].filter((value): value is number => value !== undefined);
  }

  /** Legal values of a prop, or `null` when the kit does not constrain it. */
  variantValues(component: string, prop: string): string[] | null {
    const owner = this.componentsByName.get(component);
    if (!owner) {
      return null;
    }

    // EDS 1.x names a const object after the plural of the prop — `views` governs `view`. EDS
    // 2.x's authority is `recipe({ variants: { view: … } })`, whose group is named exactly as
    // the prop; its `as const` objects are INVERTED and reading their keys would offer
    // `CONTAINED|GHOST|OUTLINED` (S1 break V6).
    const wanted =
      this.profile.variantLookup === "exact" ? prop.toLowerCase() : `${prop.toLowerCase()}s`;
    const set = owner.variants.find((variant) => variant.name.toLowerCase() === wanted);

    return set ? [...set.keys] : null;
  }

  /** Slot metadata, or `null` when the kit does not publish a slot by that name. */
  slot(component: string, slot: string): { readonly inner: boolean } | null {
    const owner = this.componentsByName.get(component);
    if (!owner) {
      return null;
    }

    for (const set of owner.slots) {
      const found = set.slots.find((entry) => entry.name === slot);
      if (found) {
        return { inner: found.doc.inner };
      }
    }

    return null;
  }

  /** `true` when the component publishes any slots at all — absence is a known gap. */
  hasSlotSpec(component: string): boolean {
    return (this.componentsByName.get(component)?.slots.length ?? 0) > 0;
  }

  /**
   * Deprecation note for a public symbol.
   *
   * Returns `undefined` for symbols that are not deprecated and `null` for those that are but
   * carry no explanation, so callers can tell "fine" from "deprecated, reason unknown".
   */
  deprecationOf(symbol: string): string | null | undefined {
    return this.deprecatedSymbols.has(symbol)
      ? (this.deprecatedSymbols.get(symbol) ?? null)
      : undefined;
  }

  /**
   * The subpath `exports` keys a kit package declares, without the leading `./`.
   *
   * Empty for a package that declares none, which is EDS 1.x's whole answer and is what keeps
   * `import.internal` behaving there exactly as it always has.
   */
  declaredExports(packageName: string): readonly string[] {
    return this.components.meta?.exports?.[packageName] ?? [];
  }

  /**
   * The `@layer` names the kit wraps its own styles in, longest first.
   *
   * Longest first because the match is a prefix match and the names overlap: `text` is a prefix
   * of `text-field`, so a `sds-eng-text-field-input` class matched against the shorter one would
   * be attributed to `Text`.
   */
  get styleLayers(): readonly string[] {
    return [...(this.components.meta?.styleLayers ?? [])].toSorted(
      (left, right) => right.length - left.length || compareStrings(left, right),
    );
  }

  /** Kit component that wraps `packageName`. */
  componentWrapping(packageName: string): string | null {
    return this.componentByWrappedPackage.get(packageName) ?? null;
  }

  componentNames(): string[] {
    return sortStrings(
      this.components.components.filter((component) => component.public).map((c) => c.name),
    );
  }

  component(name: string): UiKitComponentDto | null {
    return this.componentsByName.get(name) ?? null;
  }

  /**
   * The replacement `font.foreign` offers, in this kit's own spelling.
   *
   * EDS 1.x's answer is a LITERAL — `var(--sds-eng-fontFamilies-text)` — and it stays one. h5
   * §1b already flagged that as the one hardcoded name in an otherwise parametric rule, and the
   * verdict was that a hardcoded name for THIS design system belongs in THIS design system's
   * description; it is also byte-compared against the hackathon tool, so deriving it would be a
   * parity change for no gain.
   *
   * EDS 2.x's answer is derived, because there is nothing to keep parity with and the kit
   * publishes three stacks as real tokens (`edsRef.fontFamilies.*`). The text stack is
   * preferred over the display one: body copy is what a foreign face usually replaces.
   */
  expectedFontFamily(syntax?: StyleValue["source"]): {
    readonly token: string;
    readonly cssVar: string | null;
    readonly jsPath?: string;
    readonly component: string | null;
    readonly value: string;
  } | null {
    // The literal branch is gated on the PROFILE and not on the syntax, unlike `expectedFor`:
    // a kit with no member path has only one spelling to offer, and this one is byte-compared
    // against the hackathon tool.
    if (this.profile.tokenReference.prefer === "css-var") {
      return {
        token: "ref.fontFamilies.text",
        cssVar: "--sds-eng-fontFamilies-text",
        component: null,
        value: "var(--sds-eng-fontFamilies-text)",
      };
    }

    const families = this.tokens.tokens.filter(
      (token) => token.kind === "fontFamily" && typeof token.resolved[this.mode] === "string",
    );
    const preferred =
      families.find((token) => /text/i.test(token.pathString)) ?? families[0] ?? null;

    return preferred === null ? null : this.expectedFor(preferred, null, syntax);
  }

  /** `true` when `family` is part of the kit's font stack. */
  isKnownFontFamily(family: string): boolean {
    const normalised = family.trim().toLowerCase();

    // Generic CSS families are the tail of every stack and are never a deviation.
    return (
      this.fontFamilies.has(normalised) ||
      ["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy", "inherit"].includes(
        normalised,
      )
    );
  }

  /**
   * Best matching typographic tuple for a set of authored fields.
   *
   * Only fields actually present in the code are compared. A block that sets a size and a line
   * height is judged on those two, not penalised for the three it did not write.
   */
  matchTypography(
    fields: Readonly<Partial<Record<keyof Omit<TypographyTuple, "id">, string>>>,
  ): TypographyMatch | null {
    const present = Object.entries(fields).filter(
      (entry): entry is [keyof Omit<TypographyTuple, "id">, string] => entry[1] !== undefined,
    );

    if (present.length === 0) {
      return null;
    }

    let best: TypographyMatch | null = null;

    for (const tuple of this.typography) {
      let matched = 0;
      const mismatches: TypographyMatch["mismatches"] = [];

      for (const [field, actual] of present) {
        const expected = tuple[field];
        if (expected === null) {
          continue;
        }
        if (KitSpec.sameTypographyValue(actual, expected)) {
          matched += 1;
        } else {
          mismatches.push({ property: KitSpec.cssNameOf(field), actual, expected });
        }
      }

      const candidate: TypographyMatch = { tuple, matched, compared: present.length, mismatches };

      if (
        best === null ||
        candidate.matched > best.matched ||
        (candidate.matched === best.matched &&
          compareStrings(candidate.tuple.id, best.tuple.id) < 0)
      ) {
        best = candidate;
      }
    }

    return best;
  }

  private static sameTypographyValue(actual: string, expected: string): boolean {
    return normaliseTypographyValue(actual) === normaliseTypographyValue(expected);
  }

  private static cssNameOf(field: string): string {
    return field.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
  }

  /** One typographic tuple by its id, e.g. `edsSys.Typography.Body.BodyM`. */
  typographyTuple(id: string): TypographyTuple | null {
    return this.typography.find((tuple) => tuple.id === id) ?? null;
  }

  /**
   * The typographic GROUP a token belongs to, e.g. `edsSys.Typography.Body.BodyM.fontSize` ⇒
   * `edsSys.Typography.Body.BodyM`; `null` when the token is not part of one.
   *
   * What makes the half-migrated ramp findable: a block that takes its `font-size` from a tuple
   * and types the other three by hand has NAMED the tuple it means, so the rule can compare
   * against that one instead of searching for the closest and hoping.
   */
  typographyGroupOf(token: TokenDto): TypographyTuple | null {
    const { tier, group } = this.profile.tokens.typography;
    if (token.tier !== tier || token.path[0] !== group) return null;

    return this.typographyTuple(`${token.tier}.${token.path.slice(0, -1).join(".")}`);
  }

  /** Every typographic tuple, for a report's token screen. */
  typographyTuples(): readonly TypographyTuple[] {
    return this.typography;
  }
}
