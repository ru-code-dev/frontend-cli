import type { A11ySpec } from "../kit/a11y-spec.ts";
import type { IconSpec } from "../kit/icon-spec.ts";
import type { KnowledgeSpec } from "../kit/knowledge-spec.ts";
import type { KitSpec } from "../kit/spec.ts";

/**
 * The four query facades every rule in this package is built against.
 *
 * The hackathon put these on `RuleContext` itself (`ds-analyzer/src/rules/types.ts:91-109`), so
 * the engine's own type had to name them and the engine had to load them. Here each rule is a
 * *factory* over this object and closes over it, which is the whole reason the engine can stay
 * ignorant of what a `KitSpec` is: it receives finished `Rule` objects and calls `run(context)`
 * with nothing but project facts.
 */
export interface KitContext {
  readonly kit: KitSpec;
  readonly a11y: A11ySpec;
  readonly icons: IconSpec;
  readonly knowledge: KnowledgeSpec;
}
