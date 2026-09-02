import type { PerMode, TokenDto, TokenReverseIndexDto } from "../domain/tokens.ts";

import { MODE_KEYS } from "./flatten.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Reverse lookups: value → token ids.
 *
 * This is the artifact's most load-bearing structure. The project analyser scans
 * consumer code for literals (`#ff1f78`, `8px`, a font stack) and needs an O(1) answer
 * to "is this literal exactly a token, and which one?" before it falls back to the
 * expensive perceptual near-match search.
 *
 * Indexes are built per theme mode because a single literal can be the light-mode
 * value of one token and the dark-mode value of a different one.
 */

type MutableIndex = Map<string, Set<string>>;

const emptyPerMode = (): PerMode<MutableIndex> => ({ light: new Map(), dark: new Map() });

const push = (index: MutableIndex, key: string, tokenId: string): void => {
  const bucket = index.get(key);
  if (bucket) {
    bucket.add(tokenId);
  } else {
    index.set(key, new Set([tokenId]));
  }
};

/** Serialises with sorted keys and sorted buckets, so artifacts diff cleanly. */
const serialise = (index: MutableIndex): Record<string, string[]> => {
  const out: Record<string, string[]> = {};

  for (const key of [...index.keys()].sort(compareStrings)) {
    out[key] = [...(index.get(key) ?? [])].sort(compareStrings);
  }

  return out;
};

const serialisePerMode = (index: PerMode<MutableIndex>): PerMode<Record<string, string[]>> => ({
  light: serialise(index.light),
  dark: serialise(index.dark),
});

/**
 * Numbers are keyed by their shortest exact decimal form so that `8`, `8.0` and `08`
 * from consumer code all normalise to the same bucket.
 */
const pixelKey = (px: number): string => String(px);

export const buildReverseIndex = (tokens: readonly TokenDto[]): TokenReverseIndexDto => {
  const cssVariable = new Map<string, string>();
  const color = emptyPerMode();
  const dimensionPx = emptyPerMode();
  const literal = emptyPerMode();

  for (const token of tokens) {
    if (token.cssVariable !== null && !cssVariable.has(token.cssVariable)) {
      cssVariable.set(token.cssVariable, token.id);
    }

    for (const mode of MODE_KEYS) {
      const colorValue = token.color?.[mode];
      if (colorValue) {
        push(color[mode], colorValue.hex, token.id);
      }

      const dimensionValue = token.dimension?.[mode];
      if (dimensionValue && dimensionValue.px !== null) {
        push(dimensionPx[mode], pixelKey(dimensionValue.px), token.id);
      }

      const resolved = token.resolved[mode];
      if (resolved !== null) {
        push(literal[mode], String(resolved), token.id);
      }
    }
  }

  return {
    cssVariable: Object.fromEntries([...cssVariable].sort(([a], [b]) => compareStrings(a, b))),
    color: serialisePerMode(color),
    dimensionPx: serialisePerMode(dimensionPx),
    literal: serialisePerMode(literal),
  };
};

/** CSS variable names claimed by more than one token — a genuine authoring collision. */
export const findCssVariableCollisions = (tokens: readonly TokenDto[]): Map<string, string[]> => {
  const byVariable = new Map<string, string[]>();

  for (const token of tokens) {
    if (token.cssVariable === null) {
      continue;
    }
    const bucket = byVariable.get(token.cssVariable);
    if (bucket) {
      bucket.push(token.id);
    } else {
      byVariable.set(token.cssVariable, [token.id]);
    }
  }

  return new Map([...byVariable].filter(([, ids]) => ids.length > 1));
};
