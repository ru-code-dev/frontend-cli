import { z } from "zod";

/**
 * Wire contracts for `artifacts/kit-signatures.json` and `artifacts/kit-cards.json` —
 * the kit knowledge base of stage M5.
 *
 * Two artifacts because they serve two consumers with opposite needs. Signatures feed the
 * *static scorer*: numeric, exhaustive, never read by a human. Cards feed the *AI stage*:
 * textual, budgeted, designed to be pasted into a prompt. Folding them together would let
 * one consumer's growth bloat the other's budget.
 *
 * Both are extracted mechanically from the kit checkout — nothing here is hand-written,
 * so a kit release regenerates the knowledge base with one command.
 */

export const kitSignatureSchema = z.object({
  name: z.string().min(1),
  /** Prop names visible on a bare checkout. Known-incomplete: upstream props need install. */
  propSignature: z.array(z.string()),
  /**
   * TF-IDF weight per prop across the whole kit: `onClose` names a modal-like thing,
   * `classes` names nothing because everything has it. This is what makes prop overlap
   * meaningful instead of dominated by utility props.
   */
  propWeights: z.record(z.string(), z.number()),
  /** From `kit-a11y.json`; empty when the upstream evidence was not built. */
  ariaRoles: z.array(z.string()),
  ariaAttributes: z.array(z.string()),
  /** Host tags the kit component's own source renders. */
  nativeTags: z.array(z.string()),
  /** Parent>child chains from the component source, a structural fingerprint. */
  domShape: z.array(z.string()),
  /** CSS properties reachable from the component source. */
  cssProperties: z.array(z.string()),
  /** Identifier-free token stream of the component source, for clone detection. */
  astSignature: z.array(z.string()),
  /** Names the ecosystem uses for the same concept: Modal ≈ Dialog ≈ Popup. */
  synonyms: z.array(z.string()),
  subcomponents: z.array(z.string()),
  wraps: z.array(z.string()),
});

export const kitSignaturesArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/kit-signatures@1"),
  meta: z.object({
    counts: z.object({
      components: z.number().int().nonnegative(),
      /** Components whose source declaration was not found; recorded, never dropped. */
      withoutSource: z.number().int().nonnegative(),
    }),
  }),
  signatures: z.array(kitSignatureSchema),
});

export const kitCardSchema = z.object({
  name: z.string().min(1),
  /** One line for the T0 catalogue — always in the prompt, so the budget is per word. */
  t0: z.string().min(1),
  t1: z.object({
    import: z.string(),
    props: z.array(
      z.object({
        name: z.string(),
        type: z.string().nullable(),
        values: z.array(z.string()),
        doc: z.string().nullable(),
      }),
    ),
    variants: z.record(z.string(), z.array(z.string())),
    slots: z.array(z.string()),
    subcomponents: z.array(z.string()),
    wraps: z.array(z.string()),
    /** Example module names under the component's `examples/` directory. */
    examples: z.array(z.string()),
  }),
});

export const kitCardsArtifactSchema = z.object({
  $schema: z.literal("ds-analyzer/kit-cards@1"),
  meta: z.object({
    counts: z.object({
      components: z.number().int().nonnegative(),
      examples: z.number().int().nonnegative(),
    }),
  }),
  cards: z.array(kitCardSchema),
});

export type KitSignature = z.infer<typeof kitSignatureSchema>;
export type KitSignaturesArtifact = z.infer<typeof kitSignaturesArtifactSchema>;
export type KitCard = z.infer<typeof kitCardSchema>;
export type KitCardsArtifact = z.infer<typeof kitCardsArtifactSchema>;
