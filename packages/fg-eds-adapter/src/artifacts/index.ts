import componentsJson from "./components.json" with { type: "json" };
import kitA11yJson from "./kit-a11y.json" with { type: "json" };
import kitIconsJson from "./kit-icons.json" with { type: "json" };
import kitSignaturesJson from "./kit-signatures.json" with { type: "json" };
import tokensJson from "./tokens.json" with { type: "json" };

import type {
  ComponentsArtifact,
  KitA11yArtifact,
  KitIconsArtifact,
  KitSignaturesArtifact,
  TokensArtifact,
} from "../domain/artifacts.ts";

/**
 * The design system, as data. This module is the whole reason the adapter is pluggable.
 *
 * Five JSON files carried over from `hackathon2026/ds-analyzer/artifacts/`. They are `import`ed,
 * so the build inlines them into `dist/index.mjs` and a consumer needs nothing but that one
 * file — no artifacts directory, no `--artifacts` flag, no `existsSync` that can be false. The unguarded
 * `readFileSync` at `ds-analyzer/src/cli/run-analyze.ts:56`, which is what made the hackathon's
 * analyzer unrunnable on any machine without the kit checked out, has no equivalent here
 * because there is no load step at all.
 *
 * WHAT "CARRIED OVER" MEANS, MEASURED (F2, correcting V3 MINOR-4 — this paragraph used to
 * claim the files were "copied byte-for-byte … and re-serialised without whitespace (4.1 MB,
 * down from 6.5)", and every clause of that was wrong). The numbers, taken on 2026-09-02 by
 * reading both trees:
 *
 *   - NOT byte-for-byte. `cmp` fails for all five: this repo runs `oxfmt` over them, so the
 *     whitespace is this repo's, not the hackathon's.
 *   - IDENTICAL IN VALUE. `JSON.stringify(JSON.parse(x))` is equal for all five, which compares
 *     every key, every value and every insertion order and ignores only the formatter. So the
 *     data is the hackathon's exactly; the bytes are not.
 *   - STILL PRETTY-PRINTED, not "without whitespace" — two-space indent, one file starting
 *     `{\n  "$schema": …`. Nothing here is minified.
 *   - 6 409 213 B here, from 6 812 979 B there (6.41 MB from 6.81 MB). Per file, this repo then
 *     the hackathon: tokens 4 344 373 / 4 729 067, components 762 551 / 774 851, kit-icons
 *     913 236 / 913 344, kit-signatures 375 913 / 379 977, kit-a11y 13 140 / 15 740. The 0.4 MB
 *     saving is one formatter disagreeing with another about line breaks, and NOT a compression
 *     step — there is no compression step.
 *
 * The two artifacts the hackathon also ships are not here: `kit-cards.json` (134 905 B) feeds
 * only the `deep-pack` LLM scenario, and `extraction-summary.json` (2 902 B) is run metadata.
 * Neither is read by any rule, and 135 KB of unread JSON in a bundle is 135 KB of unread JSON.
 *
 * The casts are the seam between "JSON on disk" and "the shape the specs expect"; see the
 * header of `domain/artifacts.ts` for why validating them at runtime would check the build
 * against itself, and `tests/artifacts.test.ts` for the check that replaces it.
 */

export const TOKENS = tokensJson as TokensArtifact;
export const COMPONENTS = componentsJson as ComponentsArtifact;
export const KIT_A11Y = kitA11yJson as KitA11yArtifact;
export const KIT_ICONS = kitIconsJson as KitIconsArtifact;
export const KIT_SIGNATURES = kitSignaturesJson as KitSignaturesArtifact;
