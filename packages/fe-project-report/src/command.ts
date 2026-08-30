/**
 * THE ONE COMMAND — `fe --project-report <repo|path> -o report.html`.
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
 *  2. `analyzeProject` (`@smart-tools/fe-analyzer-engine`) — the port's 11 rules over the
 *     resolved directory. Nothing is built, installed or executed
 *     (`packages/fe-analyzer-engine/src/index.ts:17-22`).
 *  3. `payloadOf` + `renderReport` (`@smart-tools/fe-analyzer-report`) — the engine result
 *     becomes the dashboard's JSON and is substituted into the prebuilt single-file template.
 *
 * `payloadOf` is deliberately NOT a seam. It is pure and total, and faking it in a test would
 * fake away the one join B3 could not check for itself: whether the engine's real result maps
 * onto the dashboard's payload (`b3-analyzer-report.md:296-300`). The tier-1 flow test drives
 * the real `payloadOf` over a real-shaped engine result for exactly that reason.
 *
 * EXIT CODES, and the one that is not obvious. `2` for anything the user fixes by retyping the
 * line — no project, no `-o`. `1` for a failure after the line was accepted — git missing, the
 * clone refused, the scan threw, the disk would not take the write. `0` on success **even when
 * the report is full of violations**: this command REPORTS on a project, it does not gate one
 * (brief B4 deliverable 1), so the counts go to stdout on one line and the exit code stays 0.
 * A caller wanting a gate reads the numbers.
 *
 * WHY A FACTORY. `projectReportCommands` is what the registry consumes, but a tier-1 test must
 * drive this handler with no git, no ts-morph run and no megabyte template, and the frozen
 * `CommandContext` has no slot to carry a substitute (`packages/cli-kit/src/index.ts:53-63`).
 * `createProjectReportCommands({...})` is that slot — the same move
 * `packages/fe-pixso/src/commands.ts:23-29` makes for `FetchScanOptions.client`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AnalyzeOptions, AnalyzerResult } from "@smart-tools/fe-analyzer-engine";
import { ALL_DOMAINS, analyzeProject, rulesFor } from "@smart-tools/fe-analyzer-engine";
import type { ReportPayload } from "@smart-tools/fe-analyzer-report";
import { payloadOf, renderReport } from "@smart-tools/fe-analyzer-report";
import type { ArgSpec, CliCommand, CommandContext, Localized } from "@smart-tools/fe-cli-kit";
import { pick } from "@smart-tools/fe-cli-kit";
import type { ResolvedSource, ResolveSourceOptions } from "@smart-tools/fe-source";
import { isSourceError, resolveSource } from "@smart-tools/fe-source";

import {
  argDescriptions,
  failed,
  missingOut,
  missingSource,
  reportWritten,
  sourceFailure,
  summary as commandSummary,
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
}

const sourceArg: ArgSpec = {
  name: "<repo-link|local-path>",
  description: argDescriptions.source,
  required: true,
};

/** `-o` is REQUIRED here, unlike the pixso face commands: an HTML report is a file. */
const outArg: ArgSpec = {
  name: "-o <file.html>",
  description: argDescriptions.out,
  required: true,
};

/**
 * Report a `Localized` on stderr in the language in play and hand back the exit code.
 *
 * The trailing newline is added HERE rather than baked into every string, so no message can
 * ship without one and no message can ship with two.
 */
function refuse(ctx: CommandContext, message: Localized, code: number): number {
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
function ruleDescriptions(): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const rule of rulesFor(ALL_DOMAINS)) {
    descriptions[rule.id] = rule.description;
  }
  return descriptions;
}

/**
 * Build the command over a set of dependencies.
 *
 * The defaults ARE the production wiring; `projectReportCommands` is this called with nothing.
 */
export function createProjectReportCommands(deps: ProjectReportDeps = {}): readonly CliCommand[] {
  const acquire = deps.resolveSource ?? resolveSource;
  const analyze = deps.analyzeProject ?? analyzeProject;
  const render = deps.renderReport ?? renderReport;

  const command: CliCommand = {
    flag: "--project-report",
    alias: "--preport",
    summary: commandSummary,
    args: [sourceArg, outArg],
    async run(ctx: CommandContext): Promise<number> {
      const input = ctx.source;
      if (input === undefined || input === "") return refuse(ctx, missingSource, EXIT_USAGE);
      const out = ctx.out;
      if (out === undefined || out === "") return refuse(ctx, missingOut, EXIT_USAGE);
      // Resolved BEFORE anything expensive happens, so a bad `-o` is not discovered after a
      // clone and a full scan — `packages/fe-pixso/src/commands.ts:136-140` makes the same call.
      const outPath = resolve(out);

      let source: ResolvedSource;
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
        const result = await analyze({ dir: source.dir, domains: ALL_DOMAINS });
        const html = render(
          payloadOf({
            findings: result.findings,
            summary: result.summary,
            // `name` is what the USER typed and `root` is where it landed — the dashboard
            // sidebar prints `name ?? root` and hangs `root` off the tooltip
            // (`packages/fe-analyzer-report/dashboard/src/App.tsx:142-143`). For a clone that
            // makes the report say which repository it is about rather than naming a temp
            // directory that no longer exists by the time anyone opens the file.
            project: { name: input, root: source.dir },
            ruleDescriptions: ruleDescriptions(),
          }),
        );
        // The brief's "parent dirs created". `recursive` also makes an existing directory a
        // no-op, so `-o report.html` in the current directory needs no special case.
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, html, "utf8");
        ctx.stdout(
          `${pick(
            reportWritten({
              out: outPath,
              findings: result.summary.findings.total,
              errors: result.summary.findings.bySeverity.error,
              warnings: result.summary.findings.bySeverity.warning,
              files: result.summary.files.scanned,
            }),
            ctx.lang,
          )}\n`,
        );
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
