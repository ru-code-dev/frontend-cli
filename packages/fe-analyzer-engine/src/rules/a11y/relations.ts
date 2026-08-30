import type { JsxElement } from "../../domain/observations.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";

/**
 * `a11y.pattern.relations` — ARIA relations that point at nothing. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/rules/a11y/relations.ts:1-193`, `kitComponent !== null` skip
 * included (source line 94): with that field never set here the guard is dead-false, exactly
 * as h2 §2 row 5 describes for a kit-less project.
 *
 * `aria-controls`, `aria-labelledby` and `aria-describedby` are id references. A reference to
 * an id that no element in the file carries is silently dropped by every browser, so the
 * markup looks wired up, reviews clean, and the relationship simply does not exist. Nothing
 * about the rendered DOM reveals it either, which is why a snapshot checker cannot see it.
 *
 * The interesting case is the one that made this rule need its own collector field. Real
 * widgets build ids from data:
 *
 *     <button aria-controls={`panel-${item.id}`} />
 *     <div id={`panel-${item.id}`} />
 *
 * Neither value is knowable statically, but they do not need to be: the reference is
 * satisfied when some element builds its `id` from *the same expression*. Comparing source
 * text answers the question without evaluating anything, and it is why `propExpressions`
 * records text rather than a guessed value.
 */

const REFERENCE_ATTRIBUTES = [
  "aria-controls",
  "aria-labelledby",
  "aria-describedby",
  "aria-owns",
] as const;

/** Normalised so that formatting differences do not read as different expressions. */
const normaliseExpression = (text: string): string => text.replace(/\s+/g, "");

interface IdIndex {
  readonly literals: ReadonlySet<string>;
  readonly expressions: ReadonlySet<string>;
  /**
   * Every prop expression written anywhere in the file, as text.
   *
   * An id frequently reaches its element through a prop rather than a JSX attribute —
   * `<Popover dropdownProps={{ id: 'popover-1' }}>` renders that id inside the component,
   * where no static reader can see it. The id is nonetheless plainly present in the file, so
   * a rule claiming it points at nothing would be wrong. Searching the text is crude, but it
   * errs towards silence, which is the only direction this rule may err in.
   */
  readonly propText: string;
}

const indexIdsByFile = (elements: readonly JsxElement[]): ReadonlyMap<string, IdIndex> => {
  const literals = new Map<string, Set<string>>();
  const expressions = new Map<string, Set<string>>();
  const propText = new Map<string, string[]>();

  for (const element of elements) {
    const literal = element.props["id"];
    if (typeof literal === "string") {
      const bucket = literals.get(element.file) ?? new Set<string>();
      bucket.add(literal);
      literals.set(element.file, bucket);
    }

    const expression = element.propExpressions["id"];
    if (expression !== undefined) {
      const bucket = expressions.get(element.file) ?? new Set<string>();
      bucket.add(normaliseExpression(expression));
      expressions.set(element.file, bucket);
    }

    const texts = propText.get(element.file) ?? [];
    texts.push(...Object.values(element.propExpressions));
    propText.set(element.file, texts);
  }

  const files = new Set([...literals.keys(), ...expressions.keys(), ...propText.keys()]);

  return new Map(
    [...files].map((file) => [
      file,
      {
        literals: literals.get(file) ?? new Set<string>(),
        expressions: expressions.get(file) ?? new Set<string>(),
        propText: (propText.get(file) ?? []).join("\n"),
      },
    ]),
  );
};

export const ariaRelationsRule: Rule = {
  id: "a11y.pattern.relations",
  category: "a11y",
  description: "ARIA-связь ссылается на id, которого нет",
  run: (context: RuleContext): RawFinding[] => {
    const idsByFile = indexIdsByFile(context.observations.jsxElements);
    const findings: RawFinding[] = [];

    for (const element of context.observations.jsxElements) {
      // A design-system component receives ids through props and wires them internally; the
      // target is genuinely not in this file, and reporting it would be wrong every time.
      if (element.kitComponent !== null) {
        continue;
      }

      const index = idsByFile.get(element.file) ?? {
        literals: new Set<string>(),
        expressions: new Set<string>(),
        propText: "",
      };

      for (const attribute of REFERENCE_ATTRIBUTES) {
        const literal = element.props[attribute];
        const expression = element.propExpressions[attribute];

        if (typeof literal === "string") {
          // An id list may name several targets; every one of them has to exist.
          const missing = literal
            .trim()
            .split(/\s+/)
            .filter(
              (id) => id.length > 0 && !index.literals.has(id) && !index.propText.includes(id),
            );

          if (missing.length === 0) {
            continue;
          }

          findings.push({
            rule: "a11y.pattern.relations",
            subkind: "danglingId",
            category: "a11y",
            severity: "error",
            confidence: 0.9,
            file: element.file,
            line: element.propLines[attribute] ?? element.line,
            column: element.column,
            actual: `${attribute}="${literal}"`,
            expected: null,
            why:
              `${attribute} ссылается на id ${missing.join(", ")}, которого нет ни на одном элементе этого файла. ` +
              "Браузер молча отбрасывает такую ссылку: разметка выглядит связанной, но связи нет.",
            note: "Если целевой элемент объявлен в другом файле, правило этого не видит — проверьте вручную.",
            rootCause: null,
            appliedTo: null,
            autoFixable: false,
            needsAgent: false,
            candidates: [],
            a11y: {
              wcag: ["1.3.1", "4.1.2"],
              pattern: null,
              impact:
                "Связь между элементами не существует: скринридер не свяжет вкладку с панелью, поле с подписью.",
              fix: `Поставьте id ${missing.join(", ")} на целевой элемент — либо исправьте ссылку на существующий id.`,
            },
            impactKey: `a11y.pattern.relations:${attribute}`,
            replaceWith: null,
          });
          continue;
        }

        if (expression === undefined) {
          continue;
        }

        if (index.expressions.has(normaliseExpression(expression))) {
          continue;
        }

        findings.push({
          rule: "a11y.pattern.relations",
          subkind: "unmatchedExpression",
          category: "a11y",
          severity: "warning",
          confidence: 0.6,
          file: element.file,
          line: element.propLines[attribute] ?? element.line,
          column: element.column,
          actual: `${attribute}={${expression}}`,
          expected: null,
          why:
            `${attribute} собран из выражения, но ни один элемент этого файла не строит свой id так же. ` +
            "Скорее всего связь не сходится — но выражение не вычисляется, поэтому это подозрение, а не факт.",
          note: "Требует ручной проверки либо разбора на стадии ИИ.",
          rootCause: null,
          appliedTo: null,
          autoFixable: false,
          needsAgent: true,
          candidates: [],
          a11y: {
            wcag: ["1.3.1"],
            pattern: null,
            impact:
              "Если выражения действительно расходятся, связь между элементами не существует.",
            fix: "Стройте id и ссылку на него из одного выражения — вынесите его в переменную и используйте в обоих местах.",
          },
          impactKey: `a11y.pattern.relations:${attribute}:expression`,
          replaceWith: null,
        });
      }
    }

    return findings;
  },
};
