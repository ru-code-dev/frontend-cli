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
} from "../../domain/artifacts.ts";

/**
 * EDS 2.x, as data — the same five files, the same five schemas, a different design system.
 *
 * Produced by THIS package's own v2 extractors (`src/extract/v2/`) from the kit at
 * `develop-2.0`, tip `e593235e`, and reproducible with
 * `node --experimental-strip-types scripts/generate-v2-artifacts.ts <checkout>`. Each file
 * carries that provenance in `meta.corpus`, in the same field a regenerated corpus uses, so an
 * embedded snapshot and an on-disk one can be compared like with like.
 *
 * Sizes (2026-09-09): tokens 1.70 MB, components 434 KB, kit-icons 913 KB, kit-signatures
 * 235 KB, kit-a11y 8.7 KB — 3.2 MB against EDS 1.x's 6.2 MB. The whole difference is the
 * absence of an upstream: v2's token artifact describes 1079 tokens where v1's describes 2192,
 * and its components artifact has no `@v-uik` dependency graph to record.
 *
 * `import`ed, not read: the same decision as `../index.ts` makes for v1, for the same reason —
 * there is no path to get wrong and no `existsSync` that can be false.
 */

export const TOKENS_V2 = tokensJson as unknown as TokensArtifact;
export const COMPONENTS_V2 = componentsJson as unknown as ComponentsArtifact;
export const KIT_A11Y_V2 = kitA11yJson as unknown as KitA11yArtifact;
export const KIT_ICONS_V2 = kitIconsJson as unknown as KitIconsArtifact;
export const KIT_SIGNATURES_V2 = kitSignaturesJson as unknown as KitSignaturesArtifact;
