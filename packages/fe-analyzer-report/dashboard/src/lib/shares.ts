import type { Usage } from "../contract.js";

/**
 * Integer percentages that actually close to 100.
 *
 * The summary strip shows shares of one denominator (component elements). Rounding each
 * share independently produces totals of 99% or 101% — which a reader with a calculator
 * reads as a bug in the analyzer, not in arithmetic. Largest-remainder allocation keeps
 * every share within one point of its exact value while forcing the sum to exactly 100.
 */

export const allocateShares = <K extends string>(counts: Record<K, number>): Record<K, number> => {
  const entries = Object.entries(counts) as [K, number][];
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  const result = {} as Record<K, number>;
  if (total === 0) {
    for (const [key] of entries) result[key] = 0;
    return result;
  }

  const detailed = entries.map(([key, count]) => {
    const exact = (count / total) * 100;
    const floor = Math.floor(exact);
    return { key, floor, remainder: exact - floor };
  });

  let shortfall = 100 - detailed.reduce((sum, item) => sum + item.floor, 0);
  const bumped = new Set<K>();
  // Stable sort: ties resolve in declaration order, so the allocation is deterministic.
  for (const item of [...detailed].sort((left, right) => right.remainder - left.remainder)) {
    if (shortfall <= 0) break;
    bumped.add(item.key);
    shortfall -= 1;
  }

  for (const item of detailed) result[item.key] = item.floor + (bumped.has(item.key) ? 1 : 0);
  return result;
};

export interface BreakdownShares {
  kit: number;
  customTokens: number;
  customMixed: number;
  customHardcode: number;
  customUnstyled: number;
  foreign: number;
  /** The whole 100% spelled out — the answer to «а где остальные?». */
  ledger: string;
}

export const breakdownShares = (breakdown: Usage["elementBreakdown"]): BreakdownShares => {
  const shares = allocateShares({
    kit: breakdown.kit,
    customTokens: breakdown.customTokens,
    customMixed: breakdown.customMixed,
    customHardcode: breakdown.customHardcode,
    customUnstyled: breakdown.customUnstyled,
    foreign: breakdown.foreign,
  });

  const ledger = [
    `Все ${String(breakdown.total)} компонентов = 100%:`,
    `из ДС — ${String(breakdown.kit)} (${String(shares.kit)}%)`,
    `кастомные на токенах — ${String(breakdown.customTokens)} (${String(shares.customTokens)}%)`,
    `смешанные — ${String(breakdown.customMixed)} (${String(shares.customMixed)}%)`,
    `на хардкоде — ${String(breakdown.customHardcode)} (${String(shares.customHardcode)}%)`,
    `без стилей — ${String(breakdown.customUnstyled)} (${String(shares.customUnstyled)}%)`,
    `внешние — ${String(breakdown.foreign)} (${String(shares.foreign)}%)`,
  ].join("\n");

  return { ...shares, ledger };
};
