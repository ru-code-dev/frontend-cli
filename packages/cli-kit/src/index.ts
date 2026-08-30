/**
 * `@smart-tools/fe-cli-kit` — THE FROZEN CONTRACT.
 *
 * Everything every other package in this repo builds against lives in this one file: the
 * command shape, the context a command runs in, and the localization primitive. It holds
 * types and pure helpers ONLY — no pixso knowledge, no I/O, no node builtins, no runtime
 * dependency of any kind. A feature package (`fe-pixso`, and whatever follows it) depends on
 * this; this depends on nothing, so it can never be the reason two features disagree.
 *
 * Multilingual UX is a contract-level fact, not a rendering detail: the design fixes
 * `fe --lang ru|en` with a DEFAULT of `ru` and requires that every user-facing string — help,
 * command summaries, argument descriptions, errors — be localized
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:127-132`). That is why the
 * metadata fields below are `Localized` rather than `string`: a command that ships only an
 * English summary cannot be constructed.
 */

/** The two languages the CLI speaks. `ru` is the default (design 2.1:127-128). */
export type Lang = "ru" | "en";

/**
 * One user-facing string in both languages. Both are required — see the file header: the
 * type is the enforcement.
 */
export interface Localized {
  readonly ru: string;
  readonly en: string;
}

/** Resolve a `Localized` for the language in play. Total, pure, no fallback needed. */
export function pick(l: Localized, lang: Lang): string {
  return lang === "ru" ? l.ru : l.en;
}

/** One argument in a command's signature, as the generated help prints it. */
export interface ArgSpec {
  /** The placeholder the help shows, e.g. `<url|guid>`. */
  readonly name: string;
  readonly description: Localized;
  readonly required: boolean;
}

/**
 * Everything a command is handed. It is data, never a service locator: `env`, `stdout` and
 * `stderr` are injected so a command runs unchanged in a test with zero process access.
 *
 * `source` and `out` are spelled `| undefined` deliberately. Under this repo's
 * `exactOptionalPropertyTypes` (`tsconfig.base.json`, copied from
 * `ru-code-packages/tsconfig.base.json:13`) a bare `source?: string` REJECTS an explicit
 * `{ source: undefined }` — which is exactly what a parser that produces
 * `string | undefined` writes. The union keeps the property optional AND assignable.
 */
export interface CommandContext {
  /** The positional argument, when one was given: a design link, a node guid, or a path. */
  readonly source?: string | undefined;
  /** The resolved `-o`/`--out` target, when one was given. */
  readonly out?: string | undefined;
  readonly lang: Lang;
  readonly env: Record<string, string | undefined>;
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
}

/**
 * A registry entry. The surface is flag-style (`fe --get-pixso-svg <src>`, design 2.1:84-93),
 * so `flag` is the full spelling including its leading dashes and `alias` is the short form.
 *
 * `run` returns the process exit code rather than calling `process.exit`, which is what makes
 * the whole registry testable in-process (design 2.1:150-153).
 */
export interface CliCommand {
  readonly flag: string;
  readonly alias?: string | undefined;
  readonly summary: Localized;
  readonly args: readonly ArgSpec[];
  run(ctx: CommandContext): Promise<number>;
}
