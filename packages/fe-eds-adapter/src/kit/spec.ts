import {
  colorDistance,
  compareStrings,
  parseColor,
  sortStrings,
  type ColorRole,
  type ColorValue,
  type DimensionScaleName,
} from "@smart-tools/fe-analyzer-engine";

import type {
  ComponentsArtifact,
  ThemeModeName,
  TokenDto,
  TokensArtifact,
  UiKitComponentDto,
} from "../domain/artifacts.ts";

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

/** Role a `sys` token's own name declares; `null` for `ref` and for unnamed groups. */
const roleOfToken = (token: TokenDto): ColorRole | null => {
  if (token.tier !== "sys") {
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
const rankWithoutRole = (token: TokenDto): number => {
  if (token.tier === "ref") {
    return 0;
  }
  if (token.tier === "sys") {
    return isThemeInvariantGroup(token) ? 2 : 1;
  }

  return 3;
};

export class KitSpec {
  private readonly candidates: ColorCandidate[];
  private readonly byId: ReadonlyMap<string, TokenDto>;
  private readonly byCssVariable: ReadonlyMap<string, TokenDto>;
  private readonly componentsByName: ReadonlyMap<string, UiKitComponentDto>;
  private readonly deprecatedSymbols: ReadonlyMap<string, string | null>;
  private readonly componentByWrappedPackage: ReadonlyMap<string, string>;
  private readonly typography: TypographyTuple[];
  private readonly fontFamilies: ReadonlySet<string>;

  readonly tokens: TokensArtifact;
  readonly components: ComponentsArtifact;
  readonly mode: ThemeModeName;

  constructor(
    tokens: TokensArtifact,
    components: ComponentsArtifact,
    mode: ThemeModeName = "light",
  ) {
    this.tokens = tokens;
    this.components = components;
    this.mode = mode;

    const byId = new Map<string, TokenDto>();
    const byCssVariable = new Map<string, TokenDto>();
    const candidates: ColorCandidate[] = [];

    for (const token of tokens.tokens) {
      byId.set(token.id, token);

      if (token.cssVariable !== null) {
        byCssVariable.set(token.cssVariable, token);
      }

      // `comp` tokens emit no custom property, so they cannot be referenced from consumer code
      // at all. Suggesting one would produce a fix that does not compile.
      if (token.tier === "comp" || token.color === null) {
        continue;
      }

      const color = token.color[mode] ?? token.color.light;
      if (color === null) {
        continue;
      }

      const parsed = parseColor(color.hex);
      if (parsed !== null) {
        candidates.push({ token, hex: color.hex, color: parsed, role: roleOfToken(token) });
      }
    }

    this.byId = byId;
    this.byCssVariable = byCssVariable;
    this.candidates = candidates.sort((left, right) =>
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

    this.typography = KitSpec.buildTypography(tokens, mode);

    this.fontFamilies = new Set(
      tokens.scales.fontFamilies.flatMap((stack) =>
        stack.split(",").map((family) => family.trim().toLowerCase()),
      ),
    );
  }

  private static buildTypography(tokens: TokensArtifact, mode: ThemeModeName): TypographyTuple[] {
    const groups = new Map<string, Record<string, string>>();

    for (const token of tokens.tokens) {
      if (token.tier !== "sys" || token.path[0] !== "Typography") {
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
      .sort((left, right) => compareStrings(left.id, right.id));
  }

  tokenById(id: string): TokenDto | null {
    return this.byId.get(id) ?? null;
  }

  tokenByCssVariable(name: string): TokenDto | null {
    return this.byCssVariable.get(name) ?? null;
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
      const chosen = KitSpec.rankExact(exact, role);
      const hasRoleToken = role !== null && exact.some((candidate) => candidate.role === role);

      return {
        kind: "exact",
        token: chosen.token,
        distance: 0,
        roleGap: role !== null && !hasRoleToken,
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

    const chosen = nearest.length === 0 ? null : KitSpec.rankExact(nearest, role);

    if (chosen === null || nearestDistance >= COLOR_THRESHOLDS.shade) {
      return {
        kind: "foreign",
        token: chosen?.token ?? null,
        distance: chosen === null ? 1 : nearestDistance,
        roleGap: false,
        alternatives: [],
      };
    }

    return {
      kind: nearestDistance < COLOR_THRESHOLDS.near ? "near" : "shade",
      token: chosen.token,
      distance: nearestDistance,
      roleGap: false,
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
  ): ColorCandidate {
    const bucketOf = (candidate: ColorCandidate): number => {
      if (role === null) {
        return rankWithoutRole(candidate.token);
      }
      if (candidate.role === role) {
        return 0;
      }
      return candidate.token.tier === "ref" ? 1 : 2;
    };

    const [best] = [...candidates].sort(
      (left, right) =>
        bucketOf(left) - bucketOf(right) || compareStrings(left.token.id, right.token.id),
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

    const matches = this.candidates.filter(
      (candidate) =>
        candidate.hex === parsed.hex &&
        candidate.token.tier === "sys" &&
        (role === null || candidate.role === role),
    );

    return matches[0]?.token ?? null;
  }

  /** Values on a named scale. */
  scaleValues(scale: DimensionScaleName): readonly number[] {
    return this.tokens.scales[scale];
  }

  /** The two scale values bracketing `px`, for the "nearest legal value" hint. */
  neighboursOnScale(px: number, scale: DimensionScaleName): number[] {
    const values = this.scaleValues(scale);
    const below = [...values].filter((value) => value < px).pop();
    const above = [...values].find((value) => value > px);

    return [below, above].filter((value): value is number => value !== undefined);
  }

  /** Legal values of a prop, or `null` when the kit does not constrain it. */
  variantValues(component: string, prop: string): string[] | null {
    const owner = this.componentsByName.get(component);
    if (!owner) {
      return null;
    }

    // The kit's convention is a plural const object per prop: `views` for `view`.
    const wanted = `${prop.toLowerCase()}s`;
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
    const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

    return normalise(actual) === normalise(expected);
  }

  private static cssNameOf(field: string): string {
    return field.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
  }

  /** Every typographic tuple, for a report's token screen. */
  typographyTuples(): readonly TypographyTuple[] {
    return this.typography;
  }
}
