import type { TokenDto, TokenScalesDto } from "../domain/tokens.ts";
import { compareNumbers, compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Derives the design system's numeric and typographic scales from the flattened
 * tokens.
 *
 * A "scale" here is the allowed-value set that the deviation analyser checks consumer
 * code against: a `border-radius: 6px` in a project is a violation precisely because 6
 * is absent from `borderRadiusPx`.
 *
 * Scales are read off the `ref` tier only. `sys` and `comp` merely alias primitives, so
 * including them would inflate a scale with duplicates without adding allowed values.
 */

const REF_GROUP_PATHS = {
  borderRadius: ["borderRadius"],
  borderWidth: ["borderWidth"],
  fontSize: ["fontSize"],
  lineHeight: ["lineHeights"],
  fontWeight: ["fontWeights"],
  fontFamily: ["fontFamilies"],
  letterSpacing: ["letterSpacing"],
} as const satisfies Record<string, readonly string[]>;

const sortedUniqueNumbers = (values: readonly number[]): number[] =>
  [...new Set(values)].sort(compareNumbers);

const sortedUniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values)].sort(compareStrings);

const inRefGroup = (token: TokenDto, group: readonly string[]): boolean =>
  token.tier === "ref" && group.includes(token.path[0] ?? "");

/** Light-mode pixel projection of a token, when it has one. */
const pixelOf = (token: TokenDto): number | null => token.dimension?.light?.px ?? null;

const pixelsOfGroup = (tokens: readonly TokenDto[], group: readonly string[]): number[] =>
  sortedUniqueNumbers(
    tokens
      .filter((token) => inRefGroup(token, group))
      .map(pixelOf)
      .filter((px): px is number => px !== null),
  );

const numericValuesOfGroup = (tokens: readonly TokenDto[], group: readonly string[]): number[] =>
  sortedUniqueNumbers(
    tokens
      .filter((token) => inRefGroup(token, group))
      .map((token) => token.resolved.light)
      .filter((value): value is number => typeof value === "number"),
  );

const stringValuesOfGroup = (tokens: readonly TokenDto[], group: readonly string[]): string[] =>
  sortedUniqueStrings(
    tokens
      .filter((token) => inRefGroup(token, group))
      .map((token) => token.resolved.light)
      .filter((value): value is string => typeof value === "string"),
  );

export const buildScales = (tokens: readonly TokenDto[]): TokenScalesDto => ({
  borderRadiusPx: pixelsOfGroup(tokens, REF_GROUP_PATHS.borderRadius),
  borderWidthPx: pixelsOfGroup(tokens, REF_GROUP_PATHS.borderWidth),
  fontSizePx: pixelsOfGroup(tokens, REF_GROUP_PATHS.fontSize),
  lineHeightPx: pixelsOfGroup(tokens, REF_GROUP_PATHS.lineHeight),
  fontWeights: numericValuesOfGroup(tokens, REF_GROUP_PATHS.fontWeight),
  fontFamilies: stringValuesOfGroup(tokens, REF_GROUP_PATHS.fontFamily),
  letterSpacing: stringValuesOfGroup(tokens, REF_GROUP_PATHS.letterSpacing),
  allDimensionPx: sortedUniqueNumbers(
    tokens.map(pixelOf).filter((px): px is number => px !== null),
  ),
});
