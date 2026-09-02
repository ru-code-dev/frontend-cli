/**
 * The EDS 2.x ramps — the same seven scales, read off a different tier layout.
 *
 * v1 reads its scales from `ref` alone, by GROUP NAME (`ref.borderRadius.*`, `ref.fontSizes.*`)
 * — `extract/tokens/scales.ts:123-131`. That table names groups EDS 2.x does not have: its
 * primitives are `ref.{alpha,palette,radius,shadow,typography}` and `edsRef.{borderRadius,
 * fontFamilies,…}`, while the type ramp lives on the SEMANTIC tier as
 * `edsSys.Typography.<style>.fontSize` (a token per style, not a `fontSizes` group).
 *
 * So v2 reads the scales off the token's own KIND, which `classifyTokenValue` has already
 * decided from its path and its value, plus a path-word test for the two geometric ramps. The
 * `comp` tier is excluded because all 30 of its tokens are empty contracts (S1 §1b) and a
 * scale built from nothing would say every value is off it.
 *
 * A scale is what `token.literal.dimension` judges a raw length against, so being wrong here is
 * being wrong about every length in a report. The numbers this produces are asserted in
 * `tests/eds2-extract.integration.test.ts` against the kit itself.
 */
import { compareNumbers, compareStrings } from "@smart-tools/fg-analyzer-engine";

import type { TokenDto, TokenScalesDto } from "../domain/tokens.ts";

const sortedUniqueNumbers = (values: readonly number[]): number[] =>
  [...new Set(values)].toSorted(compareNumbers);

const sortedUniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values)].toSorted(compareStrings);

/** Every tier a consumer can reference; `comp` declares names and holds no values. */
const contributes = (token: TokenDto): boolean => token.tier !== "comp";

const pixelOf = (token: TokenDto): number | null => token.dimension?.light?.px ?? null;

const pixelsOfKind = (tokens: readonly TokenDto[], kind: string): number[] =>
  sortedUniqueNumbers(
    tokens
      .filter((token) => contributes(token) && token.kind === kind)
      .map(pixelOf)
      .filter((px): px is number => px !== null),
  );

/** `edsRef.borderRadius.l`, `ref.radius.md`, `sys.shape.borderRadiusLg` — all one ramp. */
const pathMentions = (token: TokenDto, words: readonly string[]): boolean => {
  const haystack = token.pathString.toLowerCase();
  return words.some((word) => haystack.includes(word));
};

const pixelsOfPathWords = (tokens: readonly TokenDto[], words: readonly string[]): number[] =>
  sortedUniqueNumbers(
    tokens
      .filter(
        (token) => contributes(token) && token.kind === "dimension" && pathMentions(token, words),
      )
      .map(pixelOf)
      .filter((px): px is number => px !== null),
  );

export const buildScalesV2 = (tokens: readonly TokenDto[]): TokenScalesDto => ({
  borderRadiusPx: pixelsOfPathWords(tokens, ["borderradius", "radius"]),
  borderWidthPx: pixelsOfPathWords(tokens, ["borderwidth"]),
  fontSizePx: pixelsOfKind(tokens, "fontSize"),
  lineHeightPx: pixelsOfKind(tokens, "lineHeight"),
  fontWeights: sortedUniqueNumbers(
    tokens
      .filter((token) => contributes(token) && token.kind === "fontWeight")
      .map((token) => {
        const value = token.resolved.light;
        return typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
      })
      .filter((value) => Number.isFinite(value)),
  ),
  fontFamilies: sortedUniqueStrings(
    tokens
      .filter((token) => contributes(token) && token.kind === "fontFamily")
      .map((token) => token.resolved.light)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ),
  letterSpacing: sortedUniqueStrings(
    tokens
      .filter((token) => contributes(token) && token.kind === "letterSpacing")
      .map((token) => token.resolved.light)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ),
  allDimensionPx: sortedUniqueNumbers(
    tokens
      .filter(contributes)
      .map(pixelOf)
      .filter((px): px is number => px !== null),
  ),
});
