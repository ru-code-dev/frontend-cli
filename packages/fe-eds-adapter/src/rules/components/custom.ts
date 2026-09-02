import {
  compareStrings,
  sketchSimilarity,
  type Declaration,
  type RawFinding,
  type Rule,
  type RuleContext,
} from "@smart-tools/fe-analyzer-engine";

import {
  buildSketch,
  kitApiCoverage,
  namesIdentical,
  scoreAgainst,
  type ComponentScore,
} from "../../components/score.ts";
import type { KnowledgeSpec } from "../../kit/knowledge-spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * Custom-component detection — stage M5. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/components/custom.ts:1-374`, **including**
 * `novelComponentRule`'s duplicate clustering.
 *
 * That last word matters. The engine carries a split-out `component.duplicate` so the clustering
 * — which compares the project only against itself and needs no kit data (h5 §1e) — can run with
 * no adapter connected. When this adapter *is* connected it ports the source's rule whole, and
 * the engine's copy stands down (`KitAdapter.replaces`). Otherwise the same cluster would be
 * reported twice, once by each. The two implementations agree line for line; the only difference
 * is the last clause of the `why`, which here is the source's «унести в кит» because with a kit
 * connected that is where the component would go.
 *
 * Every locally declared, locally rendered component is scored against all kit signatures (§5.5).
 * The verdict follows the top score:
 *
 *  - ≥ 0.6 `component.custom` — the kit has this; warning, replacement named;
 *  - 0.3–0.6 `component.ambiguous` — worth a look, claim withheld; info;
 *  - < 0.3 — no kit analogue. **Not a violation.** Reported as `component.novel` only when the
 *    project itself proves demand: reuse across files, or structural copies found by MinHash.
 *
 * `component.fork` is checked first and wins outright: when the *code structure* matches a kit
 * component's source, the name-and-props conversation is over — this is a drifted copy, and
 * every other signal is noise by comparison.
 */

const CUSTOM_THRESHOLD = 0.6;
const AMBIGUOUS_THRESHOLD = 0.3;

/** §5.5: normalized-AST similarity above this means "fork", whatever the name says. */
const FORK_THRESHOLD = 0.6;

/**
 * The second fork route: identical name plus most of the kit component's own prop API. Catches
 * copies that were restyled past shingle similarity but still *are* the API.
 */
const FORK_API_COVERAGE = 0.75;
const FORK_API_MIN_SHARED = 3;

/** Within-project copies: higher bar — same team, same conventions inflate similarity. */
const DUPLICATE_THRESHOLD = 0.8;

/** Reuse that turns "no kit analogue" into "the kit is missing this". */
const NOVEL_MIN_USAGES = 3;
const NOVEL_MIN_FILES = 2;

const TOP_CANDIDATES = 3;

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

const toCandidates = (scores: readonly ComponentScore[]): RawFinding["candidates"] =>
  scores.slice(0, TOP_CANDIDATES).map((entry) => ({
    component: entry.component,
    score: entry.score,
    reasons: entry.parts.map((part) => part.detail),
  }));

export const customComponentRule = ({ knowledge }: KitContext): Rule => ({
  id: "component.custom",
  category: "component",
  description:
    "Локальный компонент, который кит уже умеет: скоринг по имени, ARIA, пропам, тегам, структуре",
  run: (context) => {
    if (!knowledge.available) {
      return [];
    }

    const kitSketches = new Map(
      knowledge.signatures.map((signature) => [
        signature.name,
        buildSketch(signature.astSignature),
      ]),
    );

    const findings: RawFinding[] = [];

    for (const local of localComponents(context)) {
      const { declaration } = local;
      const excluded = new Set(declaration.kitComponentsUsed);

      // Fork first: identity with a kit component ends the discussion. Two routes — the code
      // still matches (MinHash), or the code drifted but the component still *is* the kit's API
      // (identical name + most of the kit's own props).
      let fork: { component: string; similarity: number; evidence: string } | null = null;
      for (const signature of knowledge.signatures) {
        if (excluded.has(signature.name)) {
          continue;
        }

        const kitSketch = kitSketches.get(signature.name) ?? null;
        if (local.sketch !== null && kitSketch !== null) {
          const similarity = sketchSimilarity(local.sketch, kitSketch);
          if (similarity >= FORK_THRESHOLD && (fork === null || similarity > fork.similarity)) {
            fork = {
              component: signature.name,
              similarity,
              evidence: `структура кода совпадает на ${String(Math.round(similarity * 100))}%`,
            };
            continue;
          }
        }

        if (fork === null && namesIdentical(declaration.name, signature)) {
          const api = kitApiCoverage(declaration, signature);
          if (api.coverage >= FORK_API_COVERAGE && api.shared.length >= FORK_API_MIN_SHARED) {
            fork = {
              component: signature.name,
              similarity: api.coverage,
              evidence: `то же имя и ${String(api.shared.length)} пропов API кита: ${api.shared.join(", ")}`,
            };
          }
        }
      }

      if (fork !== null) {
        findings.push({
          ...base(declaration),
          rule: "component.fork",
          subkind: null,
          severity: "warning",
          confidence: Math.min(0.95, fork.similarity),
          expected: { token: null, cssVar: null, component: fork.component, value: fork.component },
          why:
            `${declaration.name} — разошедшаяся копия ${fork.component} из кита (${fork.evidence}), ` +
            "а не самостоятельный компонент.",
          note: "Копия не получает багфиксы и токены кита. Сверьте, чем она отличается, и вернитесь на кит.",
          needsAgent: true,
          candidates: [
            { component: fork.component, score: fork.similarity, reasons: [fork.evidence] },
          ],
          impactKey: `component.fork:${declaration.name}`,
        });
        continue;
      }

      // A wrapper that renders the kit component is composition, not duplication.
      const scores = knowledge.signatures
        .filter((signature) => !excluded.has(signature.name))
        .map((signature) =>
          scoreAgainst(
            declaration,
            signature,
            local.sketch,
            kitSketches.get(signature.name) ?? null,
          ),
        )
        .filter((entry) => entry.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || compareStrings(left.component, right.component),
        );

      const top = scores[0] ?? null;

      if (top !== null && top.score >= CUSTOM_THRESHOLD) {
        findings.push({
          ...base(declaration),
          rule: "component.custom",
          subkind: null,
          severity: "warning",
          confidence: Math.min(0.9, top.score),
          expected: { token: null, cssVar: null, component: top.component, value: top.component },
          why:
            `${declaration.name} повторяет ${top.component} из кита (совпадение ${top.score.toFixed(2)}): ` +
            `${top.parts.map((part) => part.detail).join("; ")}.`,
          note: null,
          needsAgent: true,
          candidates: toCandidates(scores),
          impactKey: `component.custom:${declaration.name}`,
        });
        continue;
      }

      if (top !== null && top.score >= AMBIGUOUS_THRESHOLD) {
        findings.push({
          ...base(declaration),
          rule: "component.ambiguous",
          subkind: null,
          severity: "info",
          confidence: top.score,
          expected: null,
          why:
            `${declaration.name} похож на ${top.component} из кита (совпадение ${top.score.toFixed(2)}), ` +
            "но не настолько, чтобы утверждать дубль — проверьте руками.",
          note: null,
          needsAgent: true,
          candidates: toCandidates(scores),
          impactKey: `component.ambiguous:${declaration.name}`,
        });
      }
    }

    return findings;
  },
});

/** Union-find clustering of structural copies, shared by both halves of the rule below. */
const clusterDuplicates = (locals: readonly LocalComponent[]): Map<string, LocalComponent[]> => {
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
  // The source iterates a copy (`ds-analyzer/src/rules/components/custom.ts:290`); deleting the
  // key the loop is currently on is well-defined for a Map, so the copy goes and the outcome
  // does not — the same simplification the engine's split-out duplicate rule made.
  for (const [root, members] of clusters) {
    if (members.length < 2) {
      clusters.delete(root);
    }
  }

  return clusters;
};

export const novelComponentRule = ({ knowledge }: KitContext): Rule => ({
  id: "component.novel",
  category: "component",
  description: "Переиспользуемый компонент без аналога в ките — кандидат в дизайн-систему",
  run: (context) => {
    if (!knowledge.available) {
      return [];
    }

    const locals = localComponents(context);
    const kitSketches = (knowledge as KnowledgeSpec).signatures.map(
      (signature) => [signature, buildSketch(signature.astSignature)] as const,
    );

    // Structural copies within the project: the strongest promotion signal there is — the team is
    // already duplicating the thing the kit does not have. Union-find keeps A≈B and B≈C in one
    // cluster; a pairwise map would report the same trio twice.
    const clusters = clusterDuplicates(locals);
    const clustered = new Set(
      [...clusters.values()].flat().map((member) => member.declaration.name),
    );

    const findings: RawFinding[] = [];

    for (const local of locals) {
      const { declaration } = local;
      const excluded = new Set(declaration.kitComponentsUsed);

      const best = kitSketches
        .filter(([signature]) => !excluded.has(signature.name))
        .map(([signature, kitSketch]) =>
          scoreAgainst(declaration, signature, local.sketch, kitSketch),
        )
        .reduce((max, entry) => Math.max(max, entry.score), 0);

      if (best >= AMBIGUOUS_THRESHOLD) {
        continue;
      }

      const reused = local.usages >= NOVEL_MIN_USAGES && local.files >= NOVEL_MIN_FILES;
      const duplicated = clustered.has(declaration.name);
      if (!reused && !duplicated) {
        continue;
      }

      const rank =
        Math.round(
          Math.max(1, local.usages) *
            Math.log(Math.max(2, local.files + 1)) *
            (duplicated ? 2 : 1) *
            100,
        ) / 100;

      findings.push({
        ...base(declaration),
        rule: "component.novel",
        subkind: null,
        severity: "candidate",
        confidence: 0.8,
        expected: null,
        why: `У ${declaration.name} нет аналога в ките, а проект его ${
          duplicated
            ? "дублирует структурно"
            : `переиспользует (${String(local.usages)}× в ${String(local.files)} файлах)`
        } — кандидат на добавление в дизайн-систему.`,
        note: `Ранг ${String(rank)} = использования × log(файлы) × (1 + дубли). Это вход для команды кита, не долг продукта.`,
        needsAgent: false,
        candidates: [],
        impactKey: `component.novel:${declaration.name}`,
      });
    }

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
          `${others.map((member) => member.declaration.name).join(", ")}. Команда уже дублирует — сильнейший сигнал унести в кит.`,
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
});
