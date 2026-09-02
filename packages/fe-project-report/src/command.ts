/**
 * THE ONE COMMAND — `fe --project-report <repo|path> [-o report.html]`.
 *
 * ONE command, not three: the owner's amendment to the design settles the surface
 * ("ONE command … the report shows a11y + components + icons sections",
 * `WORKFLOW/features/hackathon-analys/plans/h4-design.md:3-10`). The engine still takes
 * `domains` internally because it is cheap and future-proof, and this CLI always passes all of
 * them (`h4-design.md:9-10`) — {@link ALL_DOMAINS}, not a list restated here.
 *
 * THE FLOW IS THREE SEAMS AND A WRITE, in this order and for these reasons:
 *
 *  1. `resolveSource` (`@smart-tools/fe-source`) — a directory is used where it lies; a
 *     repository link is shallow-cloned into a temp dir that is removed in a `finally`
 *     (`packages/fe-source/src/resolve.ts:176-200`). The caller never has to know which
 *     happened, because `cleanup` rides on the value: local's is a resolved no-op
 *     (`packages/fe-source/src/resolve.ts:158`), so `finally { await src.cleanup() }` is
 *     correct for both kinds and no branch can leak a clone.
 *  2. `selectAdapter` (`./adapters.ts`) — WHICH design system to measure against: the
 *     `--ui-kit` value if the user gave one, otherwise autodetected from the resolved
 *     project's own dependencies, otherwise none. It runs after the resolve because
 *     autodetection reads the project, and its `--ui-kit` half runs before it, with the other
 *     usage checks, so a misspelled name costs nobody a clone.
 *  3. `analyzeProject` (`@smart-tools/fe-analyzer-engine`) — the generic rules over the
 *     resolved directory, plus the adapter's when one was selected. Nothing is built,
 *     installed or executed (`packages/fe-analyzer-engine/src/index.ts:17-22`).
 *  4. `payloadOf` + `renderReport` (`@smart-tools/fe-analyzer-report`) — the engine result
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
 * `packages/fe-pixso/src/commands.ts:23-29` makes for `FetchScanOptions.client`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  AnalyzeOptions,
  AnalyzerResult,
  Domain,
  KitAdapter,
} from "@smart-tools/fe-analyzer-engine";
import { ALL_DOMAINS, analyzeProject, rulesFor } from "@smart-tools/fe-analyzer-engine";
import type { ReportPayload } from "@smart-tools/fe-analyzer-report";
import { payloadOf, renderReport } from "@smart-tools/fe-analyzer-report";
import type { ArgSpec, CliCommand, CommandContext, Localized } from "@smart-tools/fe-cli-kit";
import { FE_OUT_DIR, pick, resultOf } from "@smart-tools/fe-cli-kit";
import type { ResolvedSource, ResolveSourceOptions } from "@smart-tools/fe-source";
import { isSourceError, resolveSource } from "@smart-tools/fe-source";

import type { AdapterChoice, AdapterEntry, AdapterResolution } from "./adapters.ts";
import { adapterNames, requestedAdapter, resolveAdapter, selectAdapter } from "./adapters.ts";
import {
  adapterDisabled,
  adapterNotFound,
  adapterSelected,
  adapterStamp,
  argDescriptions,
  corpusWarning,
  failed,
  missingSource,
  phases,
  reportWritten,
  sourceFailure,
  summary as commandSummary,
  unknownAdapter,
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

const sourceArg: ArgSpec = {
  name: "<repo-link|local-path>",
  description: argDescriptions.source,
  required: true,
};

/**
 * `-o` is OPTIONAL, like everywhere else — the owner's law
 * (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-22`).
 *
 * It used to be required, on the reasoning that "an HTML report is a file and there is no
 * stdout form of it". The first half of that is still true and is exactly why the DEFAULT
 * exists: a report has to land somewhere, so a run without `-o` writes it to
 * {@link DEFAULT_REPORT} rather than refusing. The second half never justified a refusal — it
 * justified a default.
 */
const outArg: ArgSpec = {
  name: "-o <file.html>",
  description: argDescriptions.out,
  required: false,
};

/** Where the report goes when `-o` was not given: `./fe-out/report.html`, relative to the
 *  invocation's cwd. One file rather than a directory, because that is what this command
 *  produces — the pixso side's `fe-out/pixso/` subdirectory exists because it produces many. */
export const DEFAULT_REPORT = `${FE_OUT_DIR}/report.html`;

/**
 * `--ui-kit` is documented HERE, under the command, rather than among the CLI's global options.
 *
 * It is not a global: it means nothing to a pixso command, and the list of design systems it
 * accepts belongs to this package's registry rather than to `cli/src/messages.ts`
 * (`cli/src/parse.ts:44-50` states the other half of the arrangement). Declaring it as an
 * `ArgSpec` gets it onto the generated help page in both languages, with its accepted values,
 * and into the usage line as `[--ui-kit <name>]` — optional, which is what `required: false`
 * renders as (`cli/src/help.ts:47`).
 */
const uiKitArg: ArgSpec = {
  name: "--ui-kit <name>",
  description: argDescriptions.uiKit,
  required: false,
};

/**
 * Report a `Localized` on stderr in the language in play and hand back the exit code.
 *
 * The trailing newline is added HERE rather than baked into every string, so no message can
 * ship without one and no message can ship with two.
 */
function refuse(ctx: CommandContext, message: Localized, code: number): number {
  // The card first: `fail` stops the animator and marks the phase in flight with a `✗`
  // (`packages/cli-kit/src/ui.ts`), so the sentence below lands on a clean row rather than in
  // the middle of a redraw. It is idempotent, so every refusal path may call it blindly.
  ctx.ui.fail(message);
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
 * Built from the engine's own registry (`packages/fe-analyzer-engine/src/index.ts:69-75`) and
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
 * (`packages/fe-analyzer-engine/src/index.ts:195-197`).
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
): Localized => {
  switch (choice.kind) {
    case "adapter":
      return adapterSelected(
        choice.entry.name,
        // `null` cannot occur beside `kind: "adapter"` — the caller resolves before it renders —
        // but the type does not know that, and an `embedded` fallback is the honest reading of
        // "we could not say", not a lie.
        resolution?.provenance ?? { kind: "embedded", version: null },
        choice.how,
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
    summary: commandSummary,
    args: [sourceArg, outArg, uiKitArg],
    async run(ctx: CommandContext): Promise<number> {
      const input = ctx.source;
      if (input === undefined || input === "") return refuse(ctx, missingSource, EXIT_USAGE);
      const out = ctx.out === undefined || ctx.out === "" ? DEFAULT_REPORT : ctx.out;
      // `--ui-kit` is answered HERE, with the other usage checks, when the user named one: a
      // misspelled design system is a line to retype, and nobody should wait through a clone
      // and a full scan to find that out. Autodetect cannot run yet — it reads the project,
      // which does not exist on disk until `resolveSource` has run.
      const uiKit = ctx.flags["ui-kit"];
      const requested = typeof uiKit === "string" && uiKit !== "" ? uiKit : undefined;
      const named = requested === undefined ? null : requestedAdapter(requested, adapters);
      if (named?.kind === "unknown") {
        return refuse(ctx, unknownAdapter(named.value, names), EXIT_USAGE);
      }
      // Resolved BEFORE anything expensive happens, so a bad `-o` is not discovered after a
      // clone and a full scan. Against `ctx.cwd` rather than the process's, because the context
      // is the only cwd a command is allowed to know (`packages/cli-kit/src/index.ts`).
      const outPath = resolve(ctx.cwd, out);

      let source: ResolvedSource;
      ctx.ui.phase(phases.resolve);
      try {
        source = await acquire(input);
      } catch (error) {
        // `resolveSource` promises that nothing but a `SourceError` escapes it
        // (`packages/fe-source/src/errors.ts:56-57`). The guard is here anyway: if that promise
        // is ever broken, the user gets the generic runtime message instead of a crash, and the
        // localized map stays TOTAL over the four codes it does cover.
        return isSourceError(error)
          ? refuse(ctx, sourceFailure(error), EXIT_FAILURE)
          : refuse(ctx, failed(detailOf(error)), EXIT_FAILURE);
      }

      try {
        const choice =
          named ??
          (await selectAdapter({
            dir: source.dir,
            ...(adapters === undefined ? {} : { adapters }),
          }));

        const entry = choice.kind === "adapter" ? choice.entry : null;
        // THE DISK IS CONSULTED HERE, after the design system is chosen and before the notice is
        // printed — those two constraints fix the position exactly. Not earlier, because reading
        // a corpus for an adapter the run turns out not to use is work nobody asked for; not
        // later, because the notice's whole job is to say WHICH snapshot the numbers below it
        // came from, and it is printed before the scan so a user watching a slow run already
        // knows.
        const resolution = entry === null ? null : await resolveAdapter(entry, ctx.env);
        // Warnings go to the UI, not to stdout and not to a raw `ctx.stderr`. Not stdout,
        // because that is the run's data channel and a corpus this run declined to use is
        // diagnostics about the machine rather than a fact about the project. Not raw stderr,
        // because that was V3 MINOR-5: the line landed unindented among the UI's own
        // two-space-indented output, and on a terminal it landed ON the live progress bar and
        // was painted over. `ui.note` draws it in the phase ledger's gutter and puts the bar
        // back (`packages/cli-kit/src/ui.ts`). Same stream in the CLI's wiring, same localized
        // text, every one of them non-fatal by construction.
        for (const warning of resolution?.warnings ?? []) {
          ctx.ui.note?.(corpusWarning(choice.kind === "adapter" ? choice.entry.name : "", warning));
        }
        ctx.stdout(`${pick(noticeFor(choice, names, resolution), ctx.lang)}\n`);

        const domains = domainsFor(entry);
        // The scan phase is announced HERE rather than from inside the callback, so it exists
        // even for a project the walker finds no files in — a run that reported no phase at all
        // would look like a hang. The rules phase is announced from the callback, on the first
        // tick that says the engine has moved on, because that is the only place the boundary
        // between the two stages is observable (`packages/fe-analyzer-engine/src/index.ts`'s
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
            ctx.ui.progress(event.done, event.total);
          },
          ...(resolution === null ? {} : { adapter: resolution.adapter }),
        });
        ctx.ui.phase(phases.render);
        const html = render(
          payloadOf(
            {
              findings: result.findings,
              summary: result.summary,
              ...(result.usage === undefined ? {} : { usage: result.usage }),
              // `name` is what the USER typed and `root` is where it landed — the dashboard
              // sidebar prints `name ?? root` and hangs `root` off the tooltip
              // (`packages/fe-analyzer-report/dashboard/src/App.tsx:142-143`). For a clone that
              // makes the report say which repository it is about rather than naming a temp
              // directory that no longer exists by the time anyone opens the file.
              project: { name: input, root: source.dir },
              ruleDescriptions: ruleDescriptions(domains, resolution?.adapter),
            },
            {
              // The payload says which design system produced it, or says `null` — never leaves
              // the question open. The engine takes the adapter as an argument and does not put
              // it back into the result, so this is the one place that knows.
              // `version` carries the DESIGN SYSTEM's version and its provenance — the same
              // sentence the notice printed — rather than the adapter package's number. See
              // `strings.ts`'s `adapterStamp` for why it rides in this field.
              adapter:
                entry === null || resolution === null
                  ? null
                  : { name: entry.name, version: adapterStamp(resolution.provenance) },
            },
          ),
        );
        // The brief's "parent dirs created". `recursive` also makes an existing directory a
        // no-op, so `-o report.html` in the current directory needs no special case.
        ctx.ui.phase(phases.write);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, html, "utf8");
        // THE ONE OUTPUT SHAPE, the same one every command in this repo ends with: a headline
        // sentence, then one absolute path per line (`packages/cli-kit/src/out.ts`). The path
        // is no longer folded into the sentence — it is the line under it — so a reader who
        // wants the file can take the last line and a reader who wants the counts can take the
        // first, in either language, from any command.
        const written = resultOf(
          reportWritten({
            findings: result.summary.findings.total,
            errors: result.summary.findings.bySeverity.error,
            warnings: result.summary.findings.bySeverity.warning,
            files: result.summary.files.scanned,
          }),
          [outPath],
        );
        ctx.stdout(`${pick(written, ctx.lang)}\n`);
        // The same message, on the UI's stream, inside the card — the one place a user watching
        // the run is already looking.
        ctx.ui.done(written);
        return EXIT_OK;
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), EXIT_FAILURE);
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
