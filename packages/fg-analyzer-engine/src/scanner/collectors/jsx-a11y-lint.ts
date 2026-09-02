import { Linter } from "eslint";
import jsxA11yUntyped from "eslint-plugin-jsx-a11y";
import { parser as tsParser } from "typescript-eslint";

import type { LintMessage } from "../../domain/observations.ts";
import type { Limitation } from "../../domain/profile.ts";

/**
 * The canonical JSX accessibility rules, run rather than reimplemented. Ported from
 * `hackathon2026/ds-analyzer/src/scanner/collectors/jsx-a11y-lint.ts:1-180`. One import
 * changed: the parser comes from the `typescript-eslint` meta package (which re-exports
 * `@typescript-eslint/parser`) because that is what this workspace's catalog pins.
 *
 * Thirty-odd rules encoding the parts of WCAG that are decidable from one JSX element and
 * its attributes: `alt` text, positive `tabindex`, click handlers with no keyboard path,
 * anchors that are not links. None of it is novel, all of it is worth reporting, and every
 * line of it is a place where a hand-written version drifts from the specification.
 *
 * Reimplementing them was considered and rejected upstream. That project learned the lesson
 * the expensive way: an accessible-name check written from memory produced eleven false
 * positives out of eleven on its first real codebase, because the accname algorithm is
 * subtler than it reads. Multiplying that risk by thirty-nine would be a choice to generate
 * bugs.
 *
 * **Why this sits in the scanner and not in a rule.** Linting parses source, and the
 * pipeline's central constraint is that syntax is handled in exactly one stage. A rule that
 * ran ESLint would put a parser below the boundary the whole design rests on. What comes out
 * here is therefore a *fact about the code* — this rule fired at this position — and the
 * judgement about what it means lives in `rules/a11y/lint.ts`, as it does for every other
 * observation.
 */

/**
 * The plugin ships no type declarations and no `@types` package exists for it.
 *
 * Narrowed to the one member this file reads, so the untyped import stops here instead of
 * spreading `any` through the collector.
 */
const jsxA11y = jsxA11yUntyped as unknown as { rules: Record<string, unknown> };

/** Rules the plugin itself no longer stands behind. */
const DEPRECATED_RULES: ReadonlySet<string> = new Set([
  "accessible-emoji",
  "label-has-for",
  "no-onchange",
]);

/**
 * Rules that duplicate a check this engine already makes with more context.
 *
 * Reporting both would put two findings on one line that disagree about the fix.
 */
const SUPERSEDED_RULES: ReadonlySet<string> = new Set([
  // `a11y.aria.invalid` decides these from the ARIA 1.2 model rather than a bundled copy.
  "aria-props",
  "aria-role",
  "aria-unsupported-elements",
  // `a11y.aria.required` covers required props with the same source of truth.
  "role-has-required-aria-props",
  "role-supports-aria-props",
  // `a11y.name.missing` reasons about accname, including label ancestry and htmlFor.
  "control-has-associated-label",
  /**
   * `a11y.aria.redundant` reaches the same verdict and ships the deletion as an applicable
   * diff, which the plugin's report cannot.
   *
   * This one narrows coverage rather than merely relocating it: ours reads an implicit-role
   * table deliberately restricted to the mappings that hold unconditionally, so a redundant
   * role on a tag whose role depends on its attributes now goes unreported. That is the
   * accepted cost. Two findings on one line about one deletion, only one of which can be
   * applied, is worse for the reader than a narrower rule that always tells the truth.
   */
  "no-redundant-roles",
]);

const enabledRules = (): Record<string, "error"> =>
  Object.fromEntries(
    Object.keys(jsxA11y.rules ?? {})
      .filter((rule) => !DEPRECATED_RULES.has(rule) && !SUPERSEDED_RULES.has(rule))
      .map((rule) => [`jsx-a11y/${rule}`, "error" as const]),
  );

/**
 * Config built in memory, never resolved from disk.
 *
 * The analyzer must not adopt the linting configuration of the project it is auditing: a
 * project that switched a rule off is exactly the project whose report has to mention it.
 * The same reasoning keeps the analyzer usable on a project with no ESLint setup at all.
 */
const flatConfig: Linter.Config[] = [
  {
    // Required: `Linter.verify` matches the filename against this, and a config without it
    // reports "no matching configuration" for every file instead of linting any of them.
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" as const },
    },
    plugins: { "jsx-a11y": jsxA11y as never },
    rules: enabledRules(),
    /*
     * Inline `eslint-disable` comments are ignored, for the same reason the project's own
     * config is: a suppression is a decision the audit exists to surface, not to inherit.
     * Honouring inline directives while ignoring the config file would also be incoherent —
     * the same rule would be off or on depending on where it was switched.
     */
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" as const },
  },
];

const linter = new Linter({ configType: "flat" });

export interface JsxA11yLintResult {
  readonly messages: LintMessage[];
  readonly limitations: Limitation[];
}

/** Lints one already-read file. Never throws: a file the linter chokes on is recorded. */
export const collectJsxA11yLint = (input: {
  readonly file: string;
  readonly content: string;
}): JsxA11yLintResult => {
  const { file, content } = input;
  const messages: LintMessage[] = [];
  const limitations: Limitation[] = [];

  let raw: Linter.LintMessage[];
  try {
    raw = linter.verify(content, flatConfig, file);
  } catch (error) {
    return {
      messages,
      limitations: [
        {
          file,
          line: null,
          reason: "parse-error",
          detail: `Проверка доступности не выполнена: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  for (const message of raw) {
    /*
     * Only this plugin's own reports count.
     *
     * A file carrying `/* eslint-disable @typescript-eslint/no-unused-vars *\/` makes ESLint
     * emit "Definition for rule … was not found" *under that rule's id*. Without this filter,
     * 134 of 175 reports on the source repo's own kit were unused variables and hook
     * ordering, presented to the reader as accessibility problems.
     */
    if (
      message.ruleId !== null &&
      message.ruleId !== undefined &&
      !message.ruleId.startsWith("jsx-a11y/")
    ) {
      continue;
    }

    // A parse failure surfaces as a message with no rule. The collectors have already
    // recorded the file's real problem; repeating it as an accessibility finding would be
    // misleading about what went wrong.
    if (message.ruleId === null || message.ruleId === undefined) {
      limitations.push({
        file,
        line: message.line > 0 ? message.line : null,
        reason: "parse-error",
        detail: `Проверка доступности не выполнена: ${message.message}`,
      });
      continue;
    }

    messages.push({
      rule: message.ruleId.replace("jsx-a11y/", ""),
      message: message.message,
      file,
      line: Math.max(1, message.line),
      column: Math.max(1, message.column),
    });
  }

  return { messages, limitations };
};

/** Every rule this collector runs, for the report's "what was checked" panel. */
export const jsxA11yRuleIds = (): string[] =>
  Object.keys(enabledRules())
    .map((rule) => rule.replace("jsx-a11y/", ""))
    .sort();
