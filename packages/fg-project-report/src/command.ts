/**
 * THE ONE COMMAND — `fg --project-report <repo|path> [-o report.html]`.
 *
 * ONE command, not three: the owner's amendment to the design settles the surface
 * ("ONE command … the report shows a11y + components + icons sections",
 * `WORKFLOW/features/hackathon-analys/plans/h4-design.md:3-10`). The engine still takes
 * `domains` internally because it is cheap and future-proof, and this CLI always passes all of
 * them (`h4-design.md:9-10`) — {@link ALL_DOMAINS}, not a list restated here.
 *
 * THE FLOW IS THREE SEAMS AND A WRITE, in this order and for these reasons:
 *
 *  1. `resolveSource` (`@smart-tools/fg-source`) — a directory is used where it lies; a
 *     repository link is shallow-cloned into a temp dir that is removed in a `finally`
 *     (`packages/fg-source/src/resolve.ts:176-200`). The caller never has to know which
 *     happened, because `cleanup` rides on the value: local's is a resolved no-op
 *     (`packages/fg-source/src/resolve.ts:158`), so `finally { await src.cleanup() }` is
 *     correct for both kinds and no branch can leak a clone.
 *  2. `selectAdapter` (`./adapters.ts`) — WHICH design system to measure against: the
 *     `--ui-kit` value if the user gave one, otherwise autodetected from the resolved
 *     project's own dependencies, otherwise none. It runs after the resolve because
 *     autodetection reads the project, and its `--ui-kit` half runs before it, with the other
 *     usage checks, so a misspelled name costs nobody a clone.
 *  3. `analyzeProject` (`@smart-tools/fg-analyzer-engine`) — the generic rules over the
 *     resolved directory, plus the adapter's when one was selected. Nothing is built,
 *     installed or executed (`packages/fg-analyzer-engine/src/index.ts:17-22`).
 *  4. `payloadOf` + `renderReport` (`@smart-tools/fg-analyzer-report`) — the engine result
 *     becomes the dashboard's JSON, stamped with the adapter that produced it (or `null`), and
 *     is substituted into the prebuilt single-file template. The dashboard's kit panels are
 *     drawn from the adapter-domain half of that payload and hidden when it is absent.
 *
 * `payloadOf` is deliberately NOT a seam. It is pure and total, and faking it in a test would
 * fake away the one join B3 could not check for itself: whether the engine's real result maps
 * onto the dashboard's payload (`b3-analyzer-report.md:296-300`). The tier-1 flow test drives
 * the real `payloadOf` over a real-shaped engine result for exactly that reason.
 *
 * EXIT CODES, and the one that is not obvious. `2` for anything the user fixes by retyping the
 * line — which, since `-o` became optional (see {@link DEFAULT_REPORT}), is a missing project
 * or an unknown `--ui-kit`. `1` for a failure after the line was accepted — git missing, the
 * clone refused, the scan threw, the disk would not take the write. `0` on success **even when
 * the report is full of violations**: this command REPORTS on a project, it does not gate one
 * (brief B4 deliverable 1), so the counts go to stdout and the exit code stays 0. A caller
 * wanting a gate reads the numbers.
 *
 * WHY A FACTORY. `projectReportCommands` is what the registry consumes, but a tier-1 test must
 * drive this handler with no git, no ts-morph run and no megabyte template, and the frozen
 * `CommandContext` has no slot to carry a substitute (`packages/cli-kit/src/index.ts:53-63`).
 * `createProjectReportCommands({...})` is that slot — the same move
 * `packages/fg-pixso/src/commands.ts:23-29` makes for `FetchScanOptions.client`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type {
  AnalyzeOptions,
  AnalyzerResult,
  Domain,
  KitAdapter,
} from "@smart-tools/fg-analyzer-engine";
import {
  ALL_DOMAINS,
  analyzeProject,
  applyRuleConfig,
  ruleCatalog,
  rulesFor,
} from "@smart-tools/fg-analyzer-engine";
import type { ReportPayload } from "@smart-tools/fg-analyzer-report";
import { payloadOf, renderReport } from "@smart-tools/fg-analyzer-report";
import type {
  ArgSpec,
  CliCommand,
  CommandContext,
  Localized,
  UsageHint,
} from "@smart-tools/fg-cli-kit";
import {
  capabilityOf,
  debugHintOf,
  emitPaths,
  FG_OUT_DIR,
  pick,
  usageHintOf,
} from "@smart-tools/fg-cli-kit";
import { formatLint } from "@smart-tools/fg-lint-format";
import type { ResolvedSource, ResolveSourceOptions } from "@smart-tools/fg-source";
import { isSourceError, resolveSource } from "@smart-tools/fg-source";

import type { AdapterChoice, AdapterEntry, AdapterResolution } from "./adapters.ts";
import {
  adapterNames,
  isRedirectable,
  redirectedChoice,
  requestedAdapter,
  resolveAdapter,
  selectAdapter,
} from "./adapters.ts";
import type { LoadedConfig } from "./config/load.ts";
import { discoverConfig, unknownRuleIds } from "./config/load.ts";
import {
  DEFAULT_REPORT_FORMAT,
  FILE_FORMAT_EXTENSION,
  isFileFormat,
  REPORT_FORMATS,
  type ReportFormat,
} from "./config/names.ts";
import { FG_VERSION } from "./version.ts";
import {
  adapterDisabled,
  adapterNotFound,
  adapterRedirected,
  adapterSelected,
  adapterStamp,
  analysisGroup,
  argDescriptions,
  argHints,
  argNames,
  configArgDescriptions,
  configSource,
  configUnknownRules,
  corpusWarning,
  defaultOut as reportDefaultOut,
  details as commandDetails,
  failed,
  filesRow,
  findingsRow,
  formatRowKey,
  headerNames,
  hiddenRow,
  kitHeader,
  missingSource,
  missingSourceDetail,
  noKitHeader,
  outWithoutFile,
  phaseUnits,
  phases,
  type ReportCounts,
  reportReady,
  rowKeys,
  sourceFailure,
  summary as commandSummary,
  unknownAdapter,
  unknownFormat,
  writtenFormats,
} from "./strings.ts";

/** Success. */
const EXIT_OK = 0;
/** A failure that happened after the invocation was accepted. */
const EXIT_FAILURE = 1;
/** The invocation itself was wrong — `pixso-cli`'s convention (design 2.1:82). */
const EXIT_USAGE = 2;

/**
 * The three seams, each typed as the function it replaces so a fake cannot drift from the real
 * one without the compiler saying so.
 */
export interface ProjectReportDeps {
  readonly resolveSource?:
    | ((input: string, options?: ResolveSourceOptions) => Promise<ResolvedSource>)
    | undefined;
  readonly analyzeProject?: ((options: AnalyzeOptions) => Promise<AnalyzerResult>) | undefined;
  readonly renderReport?: ((payload: ReportPayload) => string) | undefined;
  /**
   * The registry `--ui-kit` and autodetect choose from. NOT a seam for the *selection* — the
   * real `selectAdapter` always runs, because the autodetect rules are the feature — but the
   * registry itself is injectable so a tier-1 test can exercise a tie without a second design
   * system existing, and can prove the "no match" path without inventing a project that
   * depends on nothing.
   */
  readonly adapters?: readonly AdapterEntry[] | undefined;
}

/**
 * THE ARGUMENT NAMES ARE SHORT, AND THE PLACEHOLDERS ARE LOCALIZED.
 *
 * Short, because `ArgSpec.name` is what the help table's first column, the per-command usage line
 * and every refusal's `использование:` row are built from (`packages/cli-kit/src/index.ts`'s
 * `usageLineOf`): `<repo-link|local-path>` and `--format <compact|json|sarif>` between them made
 * that line 143 columns wide, which is diagnosis 3 of
 * `WORKFLOW/features/cli-ux/plans/current-output.txt` restated by the design's own §2.8
 * (`<путь|repo>`, `-o <путь>`, `--format …`).
 *
 * LOCALIZED, because §2.7 spells the Russian page's placeholders in Russian and the page shipped
 * both conventions at once — `-o, --out <путь>` under «Общие опции», `<path|repo>` and
 * `--config <file>` in the table above it (V5 finding #12). `ArgSpec.name` now takes a
 * `Localized` beside a plain string, so the ru page reads Russian and the en page is unchanged.
 * A flag's VALUE LIST (`--format html|compact|json|sarif`) stays a plain string: it is the same
 * text in both languages, and `cli/src/parse.ts` reads the accepted values back out of it.
 */
const sourceArg: ArgSpec = {
  name: argNames.source,
  description: argDescriptions.source,
  required: true,
};

/**
 * `-o` is OPTIONAL, like everywhere else — the owner's law
 * (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-22`).
 *
 * It used to be required, on the reasoning that "an HTML report is a file and there is no
 * stdout form of it". The first half of that is still true and is exactly why the DEFAULTS
 * exist: a report has to land somewhere, so a run without `-o` writes each file format to
 * {@link defaultReportPath} rather than refusing.
 *
 * WHAT IT NAMES depends on how many files the run produces (U9), and {@link targetsFor} is the
 * whole of that rule: one file format → this path IS the file; several → this path is the
 * DIRECTORY they are written into; none (`--format compact`) → there is nothing to name and the
 * flag is refused rather than ignored.
 */
const outArg: ArgSpec = {
  name: argNames.out,
  description: argDescriptions.out,
  required: false,
};

/**
 * Where a file format goes when `-o` was not given: `./fg-out/report.<ext>`, relative to the
 * invocation's cwd — design U9's default, one file per requested format.
 */
export const defaultReportPath = (format: Exclude<ReportFormat, "compact">): string =>
  `${FG_OUT_DIR}/report.${FILE_FORMAT_EXTENSION[format]}`;

/**
 * `--ui-kit` is documented HERE, under the command, rather than among the CLI's global options.
 *
 * It is not a global: it means nothing to a pixso command, and the list of design systems it
 * accepts belongs to this package's registry rather than to `cli/src/messages.ts`
 * (`cli/src/parse.ts:44-50` states the other half of the arrangement). Declaring it as an
 * `ArgSpec` gets it onto the generated help page in both languages, with its accepted values,
 * and into the usage line as `[--ui-kit eds|none]` — optional, which is what `required: false`
 * renders as (`cli/src/help.ts`).
 *
 * The accepted values are the REGISTRY's own list (`adapterNames()`, which ends in `none`), so a
 * second design system documents itself here without this line being edited.
 */
const uiKitArg: ArgSpec = {
  name: `--ui-kit ${adapterNames().join("|")}`,
  description: argDescriptions.uiKit,
  hint: argHints.uiKit,
  required: false,
};

/**
 * THE TWO ARGUMENTS THE RULE CONFIG ADDED, documented here for the reason `--ui-kit` is: they
 * belong to this command, not to the CLI. `cli/src/parse.ts` declares `config`/`format` as
 * string options ONLY so `parseArgs` — which is strict, and cannot be told "this flag exists for
 * one command" — can tokenize them; the narrowing back to this command happens against these
 * very `ArgSpec`s (`cli/src/parse.ts`'s `declaredOptions`), so a `--format` aimed at a pixso
 * command is refused rather than ignored.
 *
 * `--lint` is GONE (U1). It was a second way to say `--format`, and the format list now says all
 * of it: `--format compact` is what `--lint` meant.
 */
const configArg: ArgSpec = {
  name: argNames.config,
  description: configArgDescriptions.config,
  hint: argHints.config,
  required: false,
};

/**
 * The accepted values are spelled IN THE NAME, and that is load-bearing in two places at once:
 * the help table prints them (design §2.7's `--format html|compact|json|sarif`), and
 * `cli/src/parse.ts` READS them back out of this string to refuse an unknown value before the
 * command runs. One list, in one place — {@link REPORT_FORMATS} — rendered once.
 */
const formatArg: ArgSpec = {
  name: `--format ${REPORT_FORMATS.join("|")}`,
  description: configArgDescriptions.format,
  hint: argHints.format,
  required: false,
};

/** `--format`'s list after validation, or the first value that is not a format. */
type FormatSelection =
  | { readonly ok: true; readonly formats: readonly ReportFormat[] }
  | { readonly ok: false; readonly value: string };

/**
 * The requested formats, DE-DUPLICATED and validated, defaulting to `html` (design U1).
 *
 * Duplicates are dropped rather than refused (`--format html,html` is one html report, not a
 * mistake worth stopping for) and ORDER IS THE USER'S: it decides the order of the `запись`
 * phase's detail and of the summary block's path rows, and re-sorting it would be this file
 * having an opinion about a list the user wrote down.
 *
 * The CLI has already refused an unknown value by the time a real invocation reaches here
 * (`cli/src/parse.ts`), and this is still not a redundant check: `ctx.formats` is a contract
 * field any embedder can fill, and a command that trusted it would answer a typo with a crash.
 */
export function selectFormats(requested: readonly string[] | undefined): FormatSelection {
  if (requested === undefined || requested.length === 0) {
    return { ok: true, formats: [DEFAULT_REPORT_FORMAT] };
  }
  const formats: ReportFormat[] = [];
  for (const value of requested) {
    if (!(REPORT_FORMATS as readonly string[]).includes(value)) return { ok: false, value };
    const format = value as ReportFormat;
    if (!formats.includes(format)) formats.push(format);
  }
  return { ok: true, formats };
}

/** One file the run is about to write: which format produced it, and where it goes. */
export interface WriteTarget {
  readonly format: Exclude<ReportFormat, "compact">;
  /** Absolute. */
  readonly path: string;
}

/**
 * U9, in one function: `-o` is a FILE for one file format and a DIRECTORY for several.
 *
 * Without `-o` every format takes its own default (`./fg-out/report.<ext>`), which is the same
 * rule read the other way round — the default destination is already a directory holding one
 * file per format.
 *
 * The extension is NOT enforced on the single-file form (design U9): `-o report.txt` writes the
 * html document to `report.txt`, because the user named a file and the tool's opinion about
 * suffixes is worth less than doing what was typed.
 */
export function targetsFor(
  formats: readonly Exclude<ReportFormat, "compact">[],
  out: string | undefined,
  cwd: string,
): readonly WriteTarget[] {
  const explicit = out === undefined || out === "" ? null : out;
  if (explicit === null) {
    return formats.map((format) => ({ format, path: resolve(cwd, defaultReportPath(format)) }));
  }
  if (formats.length === 1 && formats[0] !== undefined) {
    return [{ format: formats[0], path: resolve(cwd, explicit) }];
  }
  return formats.map((format) => ({
    format,
    path: resolve(cwd, explicit, `report.${FILE_FORMAT_EXTENSION[format]}`),
  }));
}

/**
 * The severity tally the summary block's `находок` row prints, over the VISIBLE findings.
 *
 * Counted here rather than read off `result.summary` because the two answer different questions:
 * the summary is what the REPORT holds (and the report holds every finding, design D11), while
 * this is what the config let through. They agree exactly when nothing is hidden, which is the
 * common case and not the interesting one. U2 hangs on the difference: the exit code is about
 * what a reader can SEE, so it is `errors` below and never `summary.findings.bySeverity.error`.
 */
function severityCounts(findings: readonly { readonly severity: string }[]): {
  errors: number;
  warnings: number;
  info: number;
  candidates: number;
} {
  const counts = { errors: 0, warnings: 0, info: 0, candidates: 0 };
  for (const finding of findings) {
    if (finding.severity === "error") counts.errors += 1;
    else if (finding.severity === "warning") counts.warnings += 1;
    else if (finding.severity === "info") counts.info += 1;
    else counts.candidates += 1;
  }
  return counts;
}

/**
 * THE TERMINAL WIDTH `compact` right-flushes its rule ids to, when there is one.
 *
 * A command may not read `process` (`packages/cli-kit/src/index.ts`'s `CommandContext` is data),
 * so the CLI hands the number it already read to the command it is about to run — as
 * `CommandContext.columns`, a typed contract field. It used to travel as `FG_STDOUT_COLUMNS`
 * inside `ctx.env`: a private ABI between two first-party packages, spelled in a namespace the
 * user also writes to and documented in no help text, so a user who set it was silently
 * overridden (V5 finding #15). Absent is a real answer (a pipe has no width) and so is a value
 * that is not a positive integer; both mean "no width", which is what `LintInput.width` spells
 * as `undefined` (`packages/fg-lint-format/src/types.ts`).
 */
function stdoutColumns(ctx: CommandContext): number | undefined {
  const value = ctx.columns;
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Report a `Localized` on stderr in the language in play and hand back the exit code.
 *
 * The trailing newline is added HERE rather than baked into every string, so no message can
 * ship without one and no message can ship with two.
 */
function refuse(
  ctx: CommandContext,
  message: Localized,
  code: number,
  hint?: UsageHint,
  detail?: Localized,
): number {
  // `fail` erases whatever live line was in flight and prints design 2.6's block: `✖ message`,
  // the dim detail line when the headline has one, and, for a usage error, the two pointer rows.
  // It is idempotent, so every refusal path may call it blindly. The `ctx.stderr` line below it
  // survives only for a context with no terminal (`silentUi.ended()` is false forever); the CLI
  // drops it once a block has been printed (`cli/src/main.ts`).
  ctx.ui.fail(message, hint, detail);
  ctx.stderr(`${pick(message, ctx.lang)}\n`);
  return code;
}

/** An unknown throw rendered as a line of text. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The rule ids and descriptions the run used, for the report's "what was checked" panel.
 *
 * Built from the engine's own registry (`packages/fg-analyzer-engine/src/index.ts:69-75`) and
 * not from a list here: a rule added to the engine must appear in the report without this file
 * being edited, and a rule renamed here would be a second list to drift.
 */
function ruleDescriptions(
  domains: readonly Domain[],
  adapter: KitAdapter | undefined,
): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const rule of rulesFor(domains, adapter)) {
    descriptions[rule.id] = rule.description;
  }
  return descriptions;
}

/**
 * The domains a run covers: the engine's three always, plus whatever the adapter adds.
 *
 * Spelled here rather than left to the engine's default because the design fixes "all three
 * domains always" (`h4-design.md:9-10`) and this command therefore passes them explicitly; an
 * adapter contributing `tokens`/`api` rules would be silently excluded by that explicit list
 * if this line did not exist. It is the engine's own default, restated
 * (`packages/fg-analyzer-engine/src/index.ts:195-197`).
 */
const domainsFor = (entry: AdapterEntry | null): readonly Domain[] =>
  entry === null ? ALL_DOMAINS : [...ALL_DOMAINS, ...(entry.adapter.domains ?? [])];

/**
 * The one line stdout carries about which design system the run measured against.
 *
 * It is the ONE thing on this command's stdout that is not a result line, and it stays: it is
 * data about the run (which snapshot the numbers came from), printed before the scan so a user
 * watching a slow one already knows. The result lines follow it, last, in the shape every
 * command shares.
 */
const noticeFor = (
  choice: AdapterChoice,
  names: readonly string[],
  resolution: AdapterResolution | null,
  // HOW IT WAS DECIDED, from the call site rather than off `choice.how`: `requestedAdapter` is
  // the function behind BOTH `--ui-kit` and the config file's `uiKit`, so it answers `"flag"` for
  // a decision the user made in a file. The caller is the only place that knows which of the two
  // asked, and a note that says «выбрана флагом --ui-kit» about a config key is a note that lies.
  how: "flag" | "config" | "autodetect",
): Localized => {
  switch (choice.kind) {
    case "adapter":
      return adapterSelected(
        choice.entry.name,
        // `null` cannot occur beside `kind: "adapter"` — the caller resolves before it renders —
        // but the type does not know that, and an `embedded` fallback is the honest reading of
        // "we could not say", not a lie.
        resolution?.provenance ?? { kind: "embedded", version: null },
        how,
      );
    case "none":
      return choice.why === "disabled" ? adapterDisabled : adapterNotFound(names);
    // `unknown` never reaches here: it is refused as a usage error before anything runs.
    case "unknown":
      return unknownAdapter(choice.value, names);
  }
};

/**
 * Build the command over a set of dependencies.
 *
 * The defaults ARE the production wiring; `projectReportCommands` is this called with nothing.
 */
export function createProjectReportCommands(deps: ProjectReportDeps = {}): readonly CliCommand[] {
  const acquire = deps.resolveSource ?? resolveSource;
  const analyze = deps.analyzeProject ?? analyzeProject;
  const render = deps.renderReport ?? renderReport;

  const adapters = deps.adapters;
  const names = adapterNames(adapters);

  const command: CliCommand = {
    flag: "--project-report",
    alias: "--preport",
    group: analysisGroup,
    summary: commandSummary,
    defaultOut: reportDefaultOut,
    details: commandDetails,
    examples: [
      "fg --preport . --format compact",
      "fg --preport ../app --format html,sarif -o ./out",
    ],
    args: [sourceArg, outArg, formatArg, uiKitArg, configArg],
    async run(ctx: CommandContext): Promise<number> {
      // BUILT PER RUN, because the usage line it quotes is localized now: §2.7 spells the ru
      // page's placeholders in Russian (`<путь|repo>`), so a hint built once at module load would
      // quote one language at every refusal (V5 finding #12).
      const hint = usageHintOf(command, ctx.lang);
      // §2.6's SECOND block: a runtime failure prints `✖ …` and the `подробнее: fg … --debug`
      // row. It used to print the `✖` line alone, because only an error that ESCAPED the command
      // reached the CLI's own handler (V5 finding #4) — and this command catches its own.
      const debug = debugHintOf(command);
      const input = ctx.source;
      if (input === undefined || input === "") {
        return refuse(ctx, missingSource, EXIT_USAGE, hint, missingSourceDetail);
      }

      // `--format` FIRST, because it decides what the run produces and therefore what `-o` is
      // allowed to mean. Both questions are lines to retype, and neither costs a clone.
      const selection = selectFormats(ctx.formats);
      if (!selection.ok) {
        return refuse(ctx, unknownFormat(selection.value, REPORT_FORMATS), EXIT_USAGE, hint);
      }
      const formats = selection.formats;
      const fileFormats = formats.filter(isFileFormat);
      const wantsCompact = formats.includes("compact");
      // U9's refusal: `-o` with nothing to write. Silently ignoring a destination the user typed
      // is precisely the defect V3 MAJOR-1 removed from `--parse-ui-kit`.
      if ((ctx.out ?? "") !== "" && fileFormats.length === 0) {
        return refuse(ctx, outWithoutFile, EXIT_USAGE, hint);
      }
      // Resolved BEFORE anything expensive happens, so a bad `-o` is not discovered after a
      // clone and a full scan. Against `ctx.cwd` rather than the process's, because the context
      // is the only cwd a command is allowed to know (`packages/cli-kit/src/index.ts`).
      const targets = targetsFor(fileFormats, ctx.out, ctx.cwd);

      // `--config` is read BEFORE anything is cloned, for the same reason `--ui-kit` is checked
      // here: an unreadable or malformed file is a line to retype, and nobody should wait through
      // a clone and a full scan to find that out. The IMPLICIT locations cannot be tried yet —
      // the first of them is the analysed project's root, which does not exist on disk until
      // `resolveSource` has run.
      const explicitConfig = ctx.flags["config"];
      let loaded: LoadedConfig | null = null;
      if (typeof explicitConfig === "string" && explicitConfig !== "") {
        const outcome = await discoverConfig({ explicit: explicitConfig, cwd: ctx.cwd });
        if (!outcome.ok) return refuse(ctx, outcome.message, EXIT_USAGE, hint);
        loaded = outcome.loaded;
      }

      // `--ui-kit` is answered HERE, with the other usage checks, when the user named one: a
      // misspelled design system is a line to retype, and nobody should wait through a clone
      // and a full scan to find that out. Autodetect cannot run yet — it reads the project,
      // which does not exist on disk until `resolveSource` has run.
      const uiKit = ctx.flags["ui-kit"];
      const requested = typeof uiKit === "string" && uiKit !== "" ? uiKit : undefined;
      const flagAdapter = requested === undefined ? null : requestedAdapter(requested, adapters);
      if (flagAdapter?.kind === "unknown") {
        return refuse(ctx, unknownAdapter(flagAdapter.value, names), EXIT_USAGE, hint);
      }

      // THE HEADER IS THE RUN'S FIRST OUTPUT — design §2.1 ("first thing a command prints") and
      // §2.6 ("Header IS printed before a runtime failure — the command had started").
      //
      // It used to be printed after the design system was known, which is after the project is on
      // disk: a run that failed while fetching the project printed no header at all, and every
      // successful run opened with a live progress line instead (V5 findings #3 and #4). So the
      // header is printed HERE, the moment the invocation is accepted, and it carries the design
      // system only when the line the user typed already settles it — `--ui-kit eds` resolves off
      // the kits directory and the embedded snapshot, neither of which needs the project.
      // AUTODETECTION cannot be waited for, so it is reported as a NOTE below instead, which is
      // the shape §2.5 gives news that arrives mid-run and the one V5 finding #9 asks for.
      //
      // ONE EXCEPTION, and it is V6 audit finding #3. `--ui-kit eds` on a project that declares
      // `@sds-eng/base-exp` is REDIRECTED to `eds2` (`adapters.ts`'s `REDIRECTS`), so the name
      // the user typed is not the design system the numbers came from — and a header printed
      // here said `eds 1.13.0 (встроенная)` one line above the correction, naming the wrong
      // system AND the wrong version. The header's own contract, restated where the corpus is
      // read below, is that it says WHICH SNAPSHOT the numbers came from; a header that has to
      // be corrected by the next line does not say it. So for the one flag value that can be
      // redirected, the header waits until the manifest has settled the version — still before
      // the scan, which is the half of the contract that has a user watching it. Every other
      // invocation (`--ui-kit eds2`, `--ui-kit none`, autodetect) keeps the ordering V5 gave it.
      const deferHeader = flagAdapter?.kind === "adapter" && isRedirectable(flagAdapter.entry.name);
      const flagResolution =
        flagAdapter?.kind === "adapter" && !deferHeader
          ? await resolveAdapter(flagAdapter.entry, ctx.env)
          : null;
      let headerPrinted = false;
      /** Prints the header once, whichever path reaches it first. */
      const printHeader = (kit: Localized | null): void => {
        if (headerPrinted) return;
        headerPrinted = true;
        ctx.ui.header([headerNames.report, ...(kit === null ? [] : [kit])]);
      };
      if (!deferHeader) {
        printHeader(
          flagAdapter === null
            ? null
            : flagAdapter.kind === "adapter" && flagResolution !== null
              ? kitHeader(flagAdapter.entry.name, flagResolution.provenance)
              : noKitHeader,
        );
      }

      let source: ResolvedSource;
      ctx.ui.phase(phases.resolve);
      try {
        source = await acquire(input);
      } catch (error) {
        // §2.6's promise survives the deferral: the command HAD started, so it opens with a
        // header even when the project never arrived. Without the design system, because that
        // is the fact this branch failed to establish.
        printHeader(null);
        // `resolveSource` promises that nothing but a `SourceError` escapes it
        // (`packages/fg-source/src/errors.ts:56-57`). The guard is here anyway: if that promise
        // is ever broken, the user gets the generic runtime message instead of a crash, and the
        // localized map stays TOTAL over the four codes it does cover.
        return isSourceError(error)
          ? refuse(ctx, sourceFailure(error), EXIT_FAILURE, debug)
          : refuse(ctx, failed(detailOf(error)), EXIT_FAILURE, debug);
      }

      try {
        // THE IMPLICIT HALF OF D2, now that the project is on disk: its root first, then the
        // invocation's cwd. Skipped entirely when `--config` already answered above.
        if (loaded === null) {
          const outcome = await discoverConfig({ projectRoot: source.dir, cwd: ctx.cwd });
          if (!outcome.ok) {
            printHeader(null);
            return refuse(ctx, outcome.message, EXIT_USAGE, hint);
          }
          loaded = outcome.loaded;
        }
        const config = loaded.config;

        // FLAG > FILE > AUTODETECT (D2). The file's `uiKit` is a fallback for the flag and not a
        // second way to say it: a project that pins its design system in `fg.config.json` is
        // still analysed against whatever `--ui-kit` says on the day someone asks a different
        // question. An unknown name in the file is refused exactly as an unknown flag value is —
        // a config naming a design system this build does not have would otherwise produce a
        // report measured against nothing, silently.
        // The file is consulted ONLY when the flag said nothing — including when the flag said
        // `none`, which is a decision and not an absence.
        const fromFile =
          flagAdapter !== null || loaded.uiKit === undefined
            ? null
            : requestedAdapter(loaded.uiKit, adapters);
        if (fromFile?.kind === "unknown") {
          printHeader(null);
          return refuse(ctx, unknownAdapter(fromFile.value, names), EXIT_USAGE);
        }
        const named = flagAdapter ?? fromFile;
        const choice =
          named === null
            ? await selectAdapter({
                dir: source.dir,
                ...(adapters === undefined ? {} : { adapters }),
              })
            : // THE VERSION IS SETTLED HERE, not where the NAME was validated. `--ui-kit eds` is
              // checked against the registry before anything is cloned, because a misspelling is
              // a line to retype; whether this project is on EDS 1.x or 2.x can only be read off
              // its manifest, which exists on disk from this line onwards.
              await redirectedChoice(named, source.dir, adapters ?? undefined);

        const entry = choice.kind === "adapter" ? choice.entry : null;
        // THE DISK IS CONSULTED HERE, after the design system is chosen and before the header is
        // printed — those two constraints fix the position exactly. Not earlier, because reading
        // a corpus for an adapter the run turns out not to use is work nobody asked for; not
        // later, because the header's whole job is to say WHICH snapshot the numbers below it
        // came from, and it is printed before the scan so a user watching a slow run already
        // knows.
        // Resolved ONCE. When the flag decided, the header above already read the corpus and
        // this is that same resolution rather than a second read of the same five files.
        const resolution =
          entry === null
            ? null
            : // Reused only when it describes THIS entry: a redirect changed which adapter the
              // run uses, and the corpus already read is the other one's.
              ((flagAdapter?.kind === "adapter" && entry === flagAdapter.entry
                ? flagResolution
                : null) ?? (await resolveAdapter(entry, ctx.env)));

        // THE DEFERRED HEADER, at the first moment it can be true: the adapter is chosen, the
        // redirect is settled, and the corpus that answers "which snapshot" has been read. Still
        // ahead of every note, every warning and the scan itself, which is the ordering §2.1
        // describes and the one a user watching a slow run needs. A no-op on every other path,
        // where the header was printed the moment the invocation was accepted.
        printHeader(
          entry === null || resolution === null
            ? noKitHeader
            : kitHeader(entry.name, resolution.provenance),
        );

        // Every one of these is diagnostics about the RUN, so they go to the UI's stream and
        // never to stdout — U3, and the end of V3 MINOR-5: written with a raw `ctx.stdout` the
        // design-system sentence landed on the data channel and, on a terminal, painted over the
        // live progress line. `warn` is for what a user may want to act on (a corpus that could
        // not be read, a design system nothing matched, a config key this run cannot use);
        // `note` is for what merely happened.
        for (const warning of resolution?.warnings ?? []) {
          ctx.ui.warn(corpusWarning(choice.kind === "adapter" ? choice.entry.name : "", warning));
        }
        // THE NOTE CARRIES NEWS OR IT IS NOT PRINTED (V5 finding #9). With `--ui-kit` on the line
        // the header one line above already names the design system, and
        // «— выбрана флагом --ui-kit» tells the user what they just typed; the same reasoning the
        // `конфиг` note below already applies to itself. What IS news is a kit nobody named: one
        // detected from the dependencies, one named by a config FILE, or none found at all.
        if (flagAdapter === null) {
          const notice = noticeFor(
            choice,
            names,
            resolution,
            fromFile === null ? "autodetect" : "config",
          );
          if (choice.kind === "none" && choice.why === "no-match") ctx.ui.warn(notice);
          else ctx.ui.note(notice);
        } else if (choice.kind === "adapter" && choice.how === "redirect") {
          // The header above already names the design system the report was measured against —
          // that is V6 finding #3's fix. This line is why it differs from the flag the user
          // typed, and it is the one case where the flag itself is news.
          ctx.ui.warn(
            adapterRedirected(
              choice.requested ?? "",
              choice.entry.name,
              choice.entry.adapter.kitPackages,
            ),
          );
        }
        // WHICH RULES WERE IN FORCE, when a file decided it. «по умолчанию» is not said here —
        // the summary block's `скрыто` row states it, and a note that never carries news is a
        // line nobody reads.
        if (loaded.path !== null) ctx.ui.note(configSource(loaded.path));

        // THE CATALOG the run's rules could have produced — the engine's own, expanded by the
        // adapter's. It feeds four consumers at once: the unknown-id warning below, the
        // dashboard's rules panel, `compact`'s labels and SARIF's `tool.driver.rules`.
        const catalog = ruleCatalog(resolution?.adapter);
        // D8: a key this run cannot act on is a WARNING and never a refusal, because one file is
        // expected to serve projects built on different design systems.
        // The FILE's keys, not the resolved config's: D13 has already dropped every `inherit`
        // row, and those are exactly the rows `--init-config` writes (V4 audit finding 6).
        const unknown = unknownRuleIds(loaded.ruleKeys, catalog);
        if (unknown.length > 0 && loaded.path !== null) {
          ctx.ui.warn(configUnknownRules(loaded.path, unknown));
        }

        const domains = domainsFor(entry);
        // The scan phase is announced HERE rather than from inside the callback, so it exists
        // even for a project the walker finds no files in — a run that reported no phase at all
        // would look like a hang. The rules phase is announced from the callback, on the first
        // tick that says the engine has moved on, because that is the only place the boundary
        // between the two stages is observable (`packages/fg-analyzer-engine/src/index.ts`'s
        // `AnalyzeProgress`).
        ctx.ui.phase(phases.scan);
        let checking = false;
        const result = await analyze({
          dir: source.dir,
          domains,
          onProgress: (event) => {
            if (event.stage === "rules" && !checking) {
              checking = true;
              ctx.ui.phase(phases.rules);
            }
            // THE UNIT IS WHAT MAKES THE NON-TTY ROW SAY SOMETHING (design §2.2's
            // `чтение файлов … 598 файлов`): `phase` builds that row's detail from the last
            // total and unit it was given, so passing them here is what fills both lanes at
            // once — the live line's `312/598 файлов` and the ledger row's `598 файлов`.
            ctx.ui.progress(
              event.done,
              event.total,
              // Agreed with the TOTAL, not with `done`: the unit is what the finished row says
              // («2 файла»), and a live line whose noun changed as the bar moved would be a
              // line that flickers.
              event.stage === "scan"
                ? phaseUnits.files(event.total)
                : phaseUnits.rules(event.total),
            );
          },
          ...(resolution === null ? {} : { adapter: resolution.adapter }),
          // `analyzer.ignore` from the file, forwarded verbatim: the walker already takes extra
          // gitignore-syntax patterns, so the config does not need a mechanism of its own.
          ...(loaded.ignore === undefined ? {} : { ignore: loaded.ignore }),
          // ALWAYS passed, even when it is the defaults. With `DEFAULT_RULE_CONFIG` the engine's
          // visible set IS the raw set and the result is what it always was
          // (`packages/fg-analyzer-engine/src/index.ts:311-312`), so one code path serves both
          // cases and the "did a file exist" question is asked in exactly one place — the loader.
          ruleConfig: config,
        });
        // The findings the config lets through — what the counts, every format and the exit code
        // are about. The RAW set still travels into the report untouched (design D11), which is
        // what lets the dashboard's reader switch a rule back on without re-running anything.
        const visible = applyRuleConfig(result.findings, config);
        const severities = severityCounts(visible);
        const counts: ReportCounts = {
          files: result.summary.files.scanned,
          cleanFiles: result.summary.files.clean,
          ...severities,
          suppressed: result.findings.length - visible.length,
          configPath: loaded.path,
        };

        // ONE ANALYSIS, N OUTPUTS (design §5). The scan above ran once; what follows is
        // rendering, and each format renders from the same `result` and the same `visible`.
        const documents = new Map<Exclude<ReportFormat, "compact">, string>();
        if (formats.includes("html")) {
          ctx.ui.phase(phases.render);
          documents.set(
            "html",
            render(
              payloadOf(
                {
                  findings: result.findings,
                  summary: result.summary,
                  ...(result.usage === undefined ? {} : { usage: result.usage }),
                  // `root` is always the resolved ABSOLUTE directory. `name` is what the USER
                  // typed for a clone (the dashboard sidebar prints `name ?? root` and hangs
                  // `root` off the tooltip — `packages/fg-analyzer-report/dashboard/src/App.tsx:
                  // 142-143` — so this makes the report say which repository it is about rather
                  // than naming a temp directory that no longer exists by the time anyone opens
                  // the file). For a local directory `input` is whatever the user typed on the
                  // command line — often a relative arg like `.` — which the sidebar would then
                  // print VERBATIM (V6 audit finding #10); `name` is the resolved directory's own
                  // basename instead, so the sidebar always shows a real project name.
                  project: {
                    name: source.kind === "local" ? basename(source.dir) : input,
                    root: source.dir,
                  },
                  ruleDescriptions: ruleDescriptions(domains, resolution?.adapter),
                },
                {
                  // The payload says which design system produced it, or says `null` — never
                  // leaves the question open. The engine takes the adapter as an argument and
                  // does not put it back into the result, so this is the one place that knows.
                  // `version` carries the DESIGN SYSTEM's version and its provenance — the same
                  // fact the header printed — rather than the adapter package's number. See
                  // `strings.ts`'s `adapterStamp` for why it rides in this field.
                  adapter:
                    entry === null || resolution === null
                      ? null
                      : { name: entry.name, version: adapterStamp(resolution.provenance) },
                  // The config the summary was computed under, and the whole catalogue it
                  // addresses: the dashboard embeds the first as its DEFAULT view and reads the
                  // second to draw the rules panel, so a reader can switch a rule back on
                  // without a second run (design §5.3).
                  ruleConfig: config,
                  ruleCatalog: catalog,
                },
              ),
            ),
          );
        }
        for (const format of fileFormats) {
          if (format === "html") continue;
          documents.set(
            format,
            formatLint(format, {
              findings: visible,
              catalog,
              projectRoot: source.dir,
              tool: { name: "fg", version: FG_VERSION },
              lang: ctx.lang,
              hiddenCount: counts.suppressed,
            }).text,
          );
        }

        if (targets.length > 0) {
          // The detail is the FORMATS, not the count: `запись … html, sarif` (design §2.2) is
          // the line that tells a reader of a CI log which documents the run produced.
          ctx.ui.phase(phases.write, writtenFormats(fileFormats));
          for (const target of targets) {
            // The brief's "parent dirs created". `recursive` also makes an existing directory a
            // no-op, so `-o report.html` in the current directory needs no special case.
            await mkdir(dirname(target.path), { recursive: true });
            await writeFile(target.path, documents.get(target.format) ?? "", "utf8");
          }
        }

        // STDOUT IS DATA ONLY (U3), and this is the whole of it: the compact document when it
        // was asked for, then the absolute paths of the files that were written — the latter
        // only when stdout is not a terminal, which `emitPaths` owns.
        //
        // The document comes first because it is the answer; the paths trail it the way a
        // footer does, so `--format compact | less` reads the same with or without a second
        // format beside it.
        // THE PHASE IS SEALED BEFORE STDOUT IS TOUCHED (V5 finding #2). `emitPaths` used to write
        // its path lines while the `запись` phase was still in flight, so a merged-fd run read
        // `сборка отчёта` / the path / `запись html` — the data jumping the ledger row that
        // announces it. `end` is `summary`'s seal without `summary`'s block, so the row lands
        // first and a compact-only run can finish without a headline at all (§2.3, finding #10).
        ctx.ui.end();
        if (wantsCompact) {
          const document = formatLint("compact", {
            findings: visible,
            catalog,
            projectRoot: source.dir,
            tool: { name: "fg", version: FG_VERSION },
            lang: ctx.lang,
            // NO_COLOR / FORCE_COLOR, read through the same gate the UI uses, against the stream
            // this document is going to: `compact` is coloured by STDOUT's capability and the UI
            // by stderr's (U7). `isTTY` is `ctx.stdoutIsTTY`, the single answer the CLI read once
            // (`cli/src/main.ts`).
            color: capabilityOf({ write: () => {}, isTTY: ctx.stdoutIsTTY }, ctx.env).color,
            verbose: ctx.verbose,
            ...(stdoutColumns(ctx) === undefined ? {} : { width: stdoutColumns(ctx) }),
            hiddenCount: counts.suppressed,
          }).text;
          // ESLint prints NOTHING for a clean run; `compact` prints its one green line, and an
          // empty text stays empty rather than becoming a blank line. The newline is added HERE,
          // once, so no formatter has to remember to end its document with one.
          if (document !== "") {
            ctx.stdout(document.endsWith("\n") ? document : `${document}\n`);
          }
        }
        emitPaths(
          ctx,
          targets.map((target) => target.path),
        );

        // U2: one VISIBLE `error`-severity finding is a failing run, whatever the formats were —
        // including an html-only run, which used to exit 0 with four hundred errors inside the
        // file. The config exists to demote, so a report that hides errors from CI is worse than
        // a red build.
        const ok = counts.errors === 0;
        // THE SUMMARY BLOCK (design §2.3) — AND NONE AT ALL FOR A COMPACT-ONLY RUN.
        //
        // §2.3 is explicit: "Compact-only runs print NO summary block: the compact footer is the
        // summary (like ESLint)." Such a run used to print the headline anyway, because
        // `summary` was also the only thing that sealed the phase in flight (V5 finding #10).
        // `ui.end()` above does the sealing now, so the two decisions are separate and the
        // stderr of a `--format compact` run ends with its last phase row.
        if (targets.length > 0) {
          ctx.ui.summary({
            ok,
            headline: reportReady(ok),
            rows: [
              { key: rowKeys.files, value: filesRow(counts) },
              { key: rowKeys.findings, value: findingsRow(counts) },
              // «скрыто» is stated when there is something to state: a file was in force, or
              // findings were removed. A run with neither has nothing to say about a config.
              ...(counts.suppressed > 0 || counts.configPath !== null
                ? [{ key: rowKeys.hidden, value: hiddenRow(counts) }]
                : []),
              ...targets.map((target) => ({
                key: formatRowKey(target.format),
                value: target.path,
                kind: "path" as const,
              })),
            ],
          });
        }
        return ok ? EXIT_OK : EXIT_FAILURE;
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), EXIT_FAILURE, debug);
      } finally {
        // Correct for BOTH kinds — see the file header. A clone is removed whether the scan
        // succeeded, threw, or the disk refused the write.
        await source.cleanup();
      }
    },
  };

  return [command];
}

/** The commands this package contributes to the registry (design 2.1:143). */
export const projectReportCommands: readonly CliCommand[] = createProjectReportCommands();
