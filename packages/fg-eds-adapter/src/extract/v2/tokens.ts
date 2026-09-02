/**
 * `tokens.json` for EDS 2.x — the same schema, five tiers, two reference channels.
 *
 * WHAT IS SHARED WITH v1, and it is nearly everything: `flattenSlice` walks the slices,
 * `classifyTokenValue` decides what a value is, `buildScales` derives the ramps,
 * `buildReverseIndex` builds the lookups and `buildTokenDiagnostics` reports the kit's own gaps.
 * Those five modules never mentioned EDS 1.x; they took slices. This file produces v2 slices.
 *
 * WHAT DIFFERS is exactly the four facts S1 measured:
 *  - FIVE tiers (`comp, edsRef, edsSys, ref, sys`), not three (break V5);
 *  - the custom-property name KEEPS the tier and every tier emits one (break V7);
 *  - a consumer references a token by MEMBER PATH, so every token also carries a `jsPath`
 *    (design §6) — both channels, one token id;
 *  - the 30 `comp` tokens are empty contracts nothing ever assigns (S1 §1b), so their value is
 *    `null` rather than an empty string, and the reverse index skips them for that reason
 *    alone.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { tokensArtifactSchema, type TokenDto, type TokensArtifact } from "../domain/tokens.ts";
import { validateArtifact } from "../domain/validate.ts";
import { isPlainRecord, type JsonPrimitive, type PlainRecord } from "../shared/object.ts";
import { buildTokenDiagnostics } from "../tokens/diagnostics.ts";
import { flattenSlices, type TokenSourceSlice } from "../tokens/flatten.ts";
import { buildReverseIndex } from "../tokens/reverse-index.ts";
import { THEME_MODES, TOKEN_TIERS_V2, type TokenTier } from "../tokens/tiers.ts";

import { readDeprecatedTokenPaths } from "./deprecated-tokens.ts";
import { buildScalesV2 } from "./scales.ts";
import { toKitRelativePathV2, type KitPathsV2 } from "./paths.ts";
import {
  CSS_VARIABLE_PREFIX_V2,
  loadThemeSourceV2,
  resolveThemeValue,
  TOKEN_EXPORT_NAME,
  type ThemeSourceV2,
} from "./theme-loader.ts";

/** The five tiers, in the order `themeTokens` declares them. */
export const V2_TIERS = TOKEN_TIERS_V2;

/** `edsSys.Background.backAccent` ⇒ `--sds-eng-edsSys-Background-backAccent`. */
export const toCssVariableNameV2 = (tier: TokenTier, path: readonly string[]): string =>
  `--${[CSS_VARIABLE_PREFIX_V2, tier, ...path].join("-")}`;

/** `edsSys.Background.backAccent` ⇒ `themeTokens.edsSys.Background.backAccent`. */
export const toJsPathV2 = (tier: TokenTier, path: readonly string[]): string =>
  [TOKEN_EXPORT_NAME, tier, ...path].join(".");

/** Rebuilds a tier's tree with every leaf replaced by `project(leaf)`. */
const mapLeaves = (source: unknown, project: (leaf: unknown) => JsonPrimitive): PlainRecord => {
  const out: PlainRecord = {};
  if (!isPlainRecord(source)) return out;

  for (const key of Object.keys(source)) {
    const value = source[key];
    out[key] = isPlainRecord(value)
      ? (mapLeaves(value, project) as PlainRecord[string])
      : (project(value) as PlainRecord[string]);
  }
  return out;
};

const asPrimitive = (value: unknown): JsonPrimitive =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : null;

/**
 * The empty-contract rule: a `comp` token has no value, and `""` is not one.
 *
 * @see TokenSourceSlice.normaliseResolved
 */
const emptyToNull = (value: JsonPrimitive): JsonPrimitive => (value === "" ? null : value);

/** The custom property a contract leaf names, or a string that matches nothing. */
const varOf = (leaf: unknown): string => {
  if (typeof leaf !== "string") return "";
  const match = /^var\((--[^),]+)\)$/.exec(leaf.trim());
  return match?.[1] ?? "";
};

const buildSlicesV2 = (theme: ThemeSourceV2, deprecated: ReadonlySet<string>): TokenSourceSlice[] =>
  V2_TIERS.map((tier) => {
    const tree = theme.tokens[tier];

    return {
      tier,
      label: tier,
      // AUTHORED is the contract reference the kit wrote — `var(--sds-eng-edsRef-…)` for a `sys`
      // alias, the literal itself for a primitive. It is the v2 spelling of v1's `{edsRef.…}`
      // template and carries the same provenance the tier rules read.
      authored: {
        light: mapLeaves(tree, (leaf) => asPrimitive(theme.light.get(varOf(leaf)) ?? leaf)),
        dark: mapLeaves(tree, (leaf) =>
          asPrimitive(theme.dark.get(varOf(leaf)) ?? theme.light.get(varOf(leaf)) ?? leaf),
        ),
      },
      resolved: {
        light: mapLeaves(tree, (leaf) => asPrimitive(resolveThemeValue(leaf, theme, "light"))),
        dark: mapLeaves(tree, (leaf) => asPrimitive(resolveThemeValue(leaf, theme, "dark"))),
      },
      emitsCssVariables: true,
      cssVariableOf: (path) => toCssVariableNameV2(tier, path),
      jsPathOf: (path) => toJsPathV2(tier, path),
      ...(tier === "edsSys" ? { deprecatedPaths: deprecated } : {}),
      ...(tier === "comp" ? { normaliseResolved: emptyToNull } : {}),
    } satisfies TokenSourceSlice;
  });

const countBy = <T extends string>(
  tokens: readonly TokenDto[],
  keyOf: (token: TokenDto) => T,
): Record<T, number> => {
  const counts = {} as Record<T, number>;
  for (const token of tokens) {
    const key = keyOf(token);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const readVersion = async (packageJsonPath: string): Promise<string | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return isPlainRecord(parsed) && typeof parsed["version"] === "string"
      ? parsed["version"]
      : null;
  } catch {
    return null;
  }
};

/** Extracts the EDS 2.x token specification. */
export const extractTokensV2 = async (paths: KitPathsV2): Promise<TokensArtifact> => {
  const theme = loadThemeSourceV2(paths);
  const deprecated = readDeprecatedTokenPaths(
    join(paths.themeCoreDir, "edsSys", "styles", "edsSys.ts"),
    "edsSys",
  );

  const tokens = flattenSlices(buildSlicesV2(theme, deprecated));
  const scales = buildScalesV2(tokens);
  const reverseIndex = buildReverseIndex(tokens);
  const diagnostics = buildTokenDiagnostics(tokens);

  const componentNames = new Set(
    tokens.filter((token) => token.tier === "comp").map((token) => token.component ?? ""),
  );
  componentNames.delete("");

  const artifact: TokensArtifact = {
    $schema: "ds-analyzer/tokens@1",
    meta: {
      sourceRoot: toKitRelativePathV2(paths, paths.themeDir),
      themePackageVersion: await readVersion(paths.basePackageJson),
      cssVariablePrefix: CSS_VARIABLE_PREFIX_V2,
      modes: [...THEME_MODES],
      // Both channels resolve to the same token id, and this says which one a FINDING should
      // offer first: a v2 consumer writes the member path (S1 §4), the custom property is the
      // second-best answer, and both are on every token.
      tokenReference: "js-path",
      jsPathRoot: TOKEN_EXPORT_NAME,
      deprecatedTokens: tokens.filter((token) => token.deprecated === true).length,
      counts: {
        total: tokens.length,
        byTier: {
          ...(Object.fromEntries(V2_TIERS.map((tier) => [tier, 0])) as Record<TokenTier, number>),
          ...countBy(tokens, (token) => token.tier),
        },
        byCategory: countBy(tokens, (token) => token.category),
        byKind: countBy(tokens, (token) => token.kind),
        components: componentNames.size,
        cssVariables: tokens.filter((token) => token.cssVariable !== null).length,
        themeDependent: tokens.filter((token) => token.themeDependent).length,
      },
    },
    tokens,
    scales,
    reverseIndex,
    diagnostics,
  };

  return validateArtifact(tokensArtifactSchema, artifact, "tokens artifact (v2)");
};
