import type { KitBinding } from "../adapter.ts";
import type { Observations, TokenReference } from "./observations.ts";
import type { Limitation } from "./profile.ts";

/**
 * The two questions a connected kit is asked about a {@link TokenReference}, in one place.
 *
 * There are two ways a design system publishes a token — a CSS custom property and a member
 * path off an imported object — and a kit may publish BOTH for the same token. Everything above
 * this module reads one field (`StyleValue.reference`) and asks one function, so no caller has
 * to branch on the kind and no two callers can branch on it differently. That the two channels
 * come back with the same token id is the kit's guarantee, made where the kit's own reverse
 * indexes live; the engine only guarantees that it asks about both.
 */

/** Token id behind a reference of either kind, or `null` when the kit does not know it. */
export const tokenIdForReference = (
  binding: KitBinding,
  reference: TokenReference,
): string | null =>
  reference.kind === "css-var"
    ? binding.tokenIdOf(reference.name)
    : (binding.tokenIdOfReference?.(reference) ?? null);

/** Resolved colour behind a reference of either kind, or `null`. */
export const tokenColorForReference = (
  binding: KitBinding,
  reference: TokenReference,
): string | null =>
  reference.kind === "css-var"
    ? binding.tokenColorHex(reference.name)
    : (binding.tokenColorHexOfReference?.(reference) ?? null);

/**
 * Spreads of a token group the connected kit could not expand.
 *
 * `{ ...tokens.sys.typography.body, color: '#fff' }` is a whole set of declarations the
 * collector cannot see the contents of — it never evaluates the kit — so the question is put
 * to the kit, and a "no" becomes a LIMITATION rather than silence. The alternative is the
 * failure this engine exists to avoid: a typography rule looking at that object, finding no
 * `font-size`, and reporting a complete declaration as a partial one.
 *
 * Adapter-gated. With no kit connected there is nobody to ask, the spread is already on the
 * record as an observation, and this function is never called — which is why an adapter-less
 * run's `summary.limitations` is exactly what it was.
 */
export const unexpandableSpreads = (
  observations: Observations,
  binding: KitBinding,
): Limitation[] => {
  const limitations: Limitation[] = [];

  for (const styleValue of observations.styleValues) {
    const reference = styleValue.reference;

    if (reference === null || reference.kind !== "js-path" || !reference.spread) {
      continue;
    }
    if (tokenIdForReference(binding, reference) !== null) {
      continue;
    }

    limitations.push({
      file: styleValue.file,
      line: styleValue.line,
      reason: "unresolved-token-reference",
      detail: `${styleValue.value} — подключённая дизайн-система не смогла раскрыть эту группу токенов`,
    });
  }

  return limitations;
};
