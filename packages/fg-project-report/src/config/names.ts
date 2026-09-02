/**
 * THE NAMES AND THE FILE-LEVEL VOCABULARY THE CONFIG FEATURE IS BUILT AROUND, in a module with
 * no local imports.
 *
 * They live here rather than in `load.ts` for one mechanical reason: `strings.ts` spells them
 * inside sentences (`Путь к файлу конфигурации правил (fg.config.json)`) and `load.ts` needs
 * `strings.ts` for its refusals. A constant in `load.ts` would therefore close an import cycle
 * whose evaluation order decides whether a template literal at module scope sees a value or
 * `undefined` — a class of bug that only shows up in the built bundle. A leaf module cannot
 * take part in a cycle, so the question does not arise. (The engine import below is a package
 * boundary, not a local edge, so it cannot close a cycle either.)
 */
import { RULE_LEVELS } from "@smart-tools/fg-analyzer-engine";
import { LINT_FORMATS } from "@smart-tools/fg-lint-format";

/** The config file, in the one spelling every discovery step and every message uses (design D1). */
export const CONFIG_FILE = "fg.config.json";

/** The JSON Schema `--init-config` writes beside it, and what the config's `$schema` points at. */
export const CONFIG_SCHEMA_FILE = "fg.config.schema.json";

/**
 * EVERY VALUE `--format` ACCEPTS — the report's own format list (design U1).
 *
 * `html` first, because it is the DEFAULT and the only one of the four that is a document
 * rather than a rendering of findings; the other three are the formatter package's list,
 * spread rather than restated, so a format added to `@smart-tools/fg-lint-format` is accepted
 * here without this line being edited.
 *
 * `--lint` and `stylish` are both gone with U1: one flag, four values, and the value decides
 * whether the run writes a file or prints to stdout.
 */
export const REPORT_FORMATS = ["html", ...LINT_FORMATS] as const;

/** One of {@link REPORT_FORMATS}. */
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * The formats that produce a FILE, and the extension each one writes.
 *
 * `compact` is deliberately absent: it is the console document (design §2.4), it has no
 * extension because it is never a file, and this record is what tells `-o` how many files a run
 * is about to write (U9). A `Record<Exclude<ReportFormat, "compact">, string>` rather than a
 * partial record over all four, so a fifth file format cannot be added without naming its
 * extension here.
 */
export const FILE_FORMAT_EXTENSION: Readonly<Record<Exclude<ReportFormat, "compact">, string>> = {
  html: "html",
  json: "json",
  sarif: "sarif",
};

/** The default when `--format` was not given at all (design U1). */
export const DEFAULT_REPORT_FORMAT: ReportFormat = "html";

/** `compact` is the one format that is not a file — the predicate, spelled once. */
export function isFileFormat(format: ReportFormat): format is Exclude<ReportFormat, "compact"> {
  return format !== "compact";
}

/**
 * THE SEVENTH LEVEL — design D13, and it exists ONLY in the file.
 *
 * `"inherit"` means "no opinion at this scope; resolve from the next one" — a rule row that says
 * it falls through to its category, a category that says it falls through to `default`. It is
 * what makes a GENERATED config usable: `--init-config` lists every rule id explicitly, and D7
 * puts a `rules` row above `categories` and `default`, so before D13 a generated file made
 * `"categories": { "a11y": "off" }` a no-op — the owner's core workflow ("leave only icons")
 * could not be expressed in the file the tool itself produced.
 *
 * The engine never sees it. `discoverConfig` DROPS every `inherit` entry while building the
 * resolved {@link RuleConfig} (`./load.ts`), so `resolveLevel`, `applyRuleConfig`, the payload
 * and the dashboard keep exactly the six levels they were written against. "Absent" is already
 * how the resolved shape spells "no opinion" — `inherit` is the file's way of writing it down.
 */
export const INHERIT_LEVEL = "inherit" as const;

/**
 * Every level a FILE may name: the engine's six plus {@link INHERIT_LEVEL}.
 *
 * Derived from `RULE_LEVELS` rather than typed out, so a seventh engine level would reach the
 * validator, the refusal message and the generated JSON Schema without this file being edited.
 */
export const FILE_LEVELS = [...RULE_LEVELS, INHERIT_LEVEL] as const;

/** What a file may write. `RuleLevel` is what survives into the resolved config. */
export type FileLevel = (typeof FILE_LEVELS)[number];
