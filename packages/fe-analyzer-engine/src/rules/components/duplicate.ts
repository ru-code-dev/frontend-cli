import type { Declaration } from "../../domain/observations.ts";
import { compareStrings } from "../../shared/sort.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";
import { buildSketch, sketchSimilarity } from "./minhash.ts";

/**
 * `component.duplicate` — structurally identical components copy-pasted inside one project.
 * Ported from `hackathon2026/ds-analyzer/src/rules/components/custom.ts`, **ungated and split
 * out**: `localComponents` (source lines 48-91), `base` (93-108), the duplicate constant
 * (line 40) and the union-find clustering plus the per-cluster emission (254-295, 342-370)
 * are this file; nothing else of `custom.ts` is ported.
 *
 * The gate that was removed is the two lines `novelComponentRule.run` opens with:
 *
 *     if (!context.knowledge.available) {
 *       return []
 *     }
 *
 * — `custom.ts:245-247`. h5 §1e is exact about why it was vestigial: the clustering "needs
 * **zero** kit data — it only compares the project against itself", and the finding was
 * "dead without [the extracted component-signature artifact] purely due to code structure,
 * not algorithmic need". Splitting the rule out of `component.novel` — which genuinely needs
 * those signatures to claim "the kit has no analogue", and is therefore NOT ported — is what
 * makes the ungating honest rather than a silent widening of a rule that also emits
 * something else.
 *
 * `localComponents` keeps its `element.kitComponent !== null` skip (source line 59) as the
 * same dead-false check every ported element rule keeps.
 */

/** Within-project copies: a high bar — same team, same conventions inflate similarity. */
const DUPLICATE_THRESHOLD = 0.8;

interface LocalComponent {
  readonly declaration: Declaration;
  readonly usages: number;
  readonly files: number;
  readonly sketch: Uint32Array | null;
}

/** Locally declared UI components: capitalized, rendering JSX, not pages-only helpers. */
const localComponents = (context: RuleContext): LocalComponent[] => {
  const usage = new Map<string, { usages: number; files: Set<string> }>();
  for (const element of context.observations.jsxElements) {
    if (element.kitComponent !== null || !/^[A-Z]/.test(element.name)) {
      continue;
    }
    const entry = usage.get(element.name) ?? { usages: 0, files: new Set<string>() };
    entry.usages += 1;
    entry.files.add(element.file);
    usage.set(element.name, entry);
  }

  const seen = new Set<string>();
  const components: LocalComponent[] = [];

  for (const declaration of context.observations.declarations) {
    if (
      declaration.kind !== "component" ||
      !/^[A-Z]/.test(declaration.name) ||
      declaration.elementCount === 0
    ) {
      continue;
    }
    // One verdict per name: with a collision the larger body is the real component.
    if (seen.has(declaration.name)) {
      continue;
    }
    seen.add(declaration.name);

    const use = usage.get(declaration.name);
    components.push({
      declaration,
      usages: use?.usages ?? 0,
      files: use?.files.size ?? 0,
      sketch: buildSketch(declaration.astSignature),
    });
  }

  return components.sort((left, right) =>
    compareStrings(left.declaration.name, right.declaration.name),
  );
};

const base = (
  declaration: Declaration,
): Pick<
  RawFinding,
  | "category"
  | "file"
  | "line"
  | "column"
  | "actual"
  | "rootCause"
  | "appliedTo"
  | "autoFixable"
  | "replaceWith"
> => ({
  category: "component",
  file: declaration.file,
  line: declaration.line,
  column: declaration.column,
  actual: declaration.name,
  rootCause: null,
  appliedTo: null,
  autoFixable: false,
  replaceWith: null,
});

export const duplicateComponentRule: Rule = {
  id: "component.duplicate",
  category: "component",
  description: "Структурно одинаковые компоненты, скопированные внутри проекта",
  run: (context) => {
    const locals = localComponents(context);

    // Structural copies within the project: the strongest promotion signal there is — the
    // team is already duplicating the thing no shared component covers. Union-find keeps A≈B
    // and B≈C in one cluster; a pairwise map would report the same trio twice.
    const parent = new Map<string, string>();
    const rootOf = (name: string): string => {
      let current = name;
      while ((parent.get(current) ?? current) !== current) {
        current = parent.get(current) ?? current;
      }
      return current;
    };
    for (let leftIndex = 0; leftIndex < locals.length; leftIndex += 1) {
      const left = locals[leftIndex];
      const leftSketch = left?.sketch ?? null;
      if (left === undefined || leftSketch === null) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < locals.length; rightIndex += 1) {
        const right = locals[rightIndex];
        const rightSketch = right?.sketch ?? null;
        if (right === undefined || rightSketch === null) {
          continue;
        }
        if (sketchSimilarity(leftSketch, rightSketch) >= DUPLICATE_THRESHOLD) {
          parent.set(rootOf(right.declaration.name), rootOf(left.declaration.name));
        }
      }
    }

    const clusters = new Map<string, LocalComponent[]>();
    for (const local of locals) {
      const root = rootOf(local.declaration.name);
      const bucket = clusters.get(root) ?? [];
      bucket.push(local);
      clusters.set(root, bucket);
    }
    // The source iterates a copy (`custom.ts:290`); deleting the key the loop is currently
    // on is well-defined for a Map, so the copy goes and the outcome does not.
    for (const [root, members] of clusters) {
      if (members.length < 2) {
        clusters.delete(root);
      }
    }

    const findings: RawFinding[] = [];

    // One duplicate finding per cluster, anchored at the copy the project actually renders.
    for (const members of clusters.values()) {
      const anchor = [...members].sort(
        (left, right) =>
          right.usages - left.usages ||
          right.files - left.files ||
          compareStrings(left.declaration.name, right.declaration.name),
      )[0];
      if (anchor === undefined) {
        continue;
      }

      const others = members.filter((member) => member !== anchor);

      findings.push({
        ...base(anchor.declaration),
        rule: "component.duplicate",
        subkind: null,
        severity: "candidate",
        confidence: 0.9,
        expected: null,
        why:
          `${anchor.declaration.name} структурно скопирован ещё в ${String(others.length)} мест${others.length === 1 ? "о" : "а"}: ` +
          `${others.map((member) => member.declaration.name).join(", ")}. Команда уже дублирует — сильнейший сигнал вынести общий компонент.`,
        note: others
          .map((member) => `${member.declaration.file}:${String(member.declaration.line)}`)
          .join(" · "),
        needsAgent: false,
        candidates: [],
        impactKey: `component.duplicate:${anchor.declaration.name}`,
      });
    }

    return findings;
  },
};
