/**
 * THE FOUR COMMANDS — the only place in this repo that calls `@smart-tools/pixso-core`.
 *
 * That single-module boundary is the package's whole reason to exist (design 2.1:141-145):
 * `cli` imports an array of `CliCommand`s and never the engine, so swapping or upgrading the
 * engine is one package's problem. Every command below is the same four steps — lift the
 * runtime out of the context, decide the route, run ONE scan, emit — and they differ only in
 * which face they ask the handle for and where the bytes land.
 *
 * ONE SCAN, ALWAYS. `--get-pixso-assets` writes four files from a single `fetchScan`, which is
 * not an optimisation but the handle's stated guarantee: three faces cost exactly one
 * `get_node_dsl` call and one trip through the parser
 * (`ru-code-packages/packages/pixso-core/tests/scanHandle.test.ts:165-180`). Calling
 * `fetchScan` per face would be four fetches for one design.
 *
 * ONE OUTPUT CONTRACT, and `-o` IS OPTIONAL ON ALL FOUR. The owner's law: "`-o` must be
 * optional; if not passed, same-shape output that lists the saved files as absolute paths"
 * (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-22`). So every command
 * here WRITES — there is no stdout-payload mode any more, and `--get-pixso-assets` no longer
 * refuses without a directory. Where the files go when nobody said is `./out.ts`'s to decide;
 * what the run reports is `resultOf(headline, paths)` from cli-kit
 * (`packages/cli-kit/src/out.ts`), handed to `ctx.stdout` AND to `ctx.ui.done` so the piped
 * bytes and the card carry the same list.
 *
 * WHAT WAS REMOVED, and why it was not the owner's to begin with. `-o` absent used to mean
 * "print the artifact to stdout", and the assets command used to exit 2 without a directory.
 * Both were choices made where the commands were written rather than in the design; the brief
 * names the first of them explicitly as "an orchestrator choice, not the owner's"
 * (`e2b-output-normalization.md:33-34`). A user who wants the bytes on stdout has `cat` and now
 * has a path to hand it.
 *
 * EXIT CODES. `2` for anything the user can fix by retyping the line — which, since `-o` became
 * optional, is only a missing source and a missing token (design 2.1:82, 2.1:118). `1` for a
 * failure that happened after the line was accepted: the engine refused the design, the
 * endpoint was dead, the disk would not take the write. `0` on success. `run` RETURNS the code
 * and never calls `process.exit`, which is what keeps the whole surface testable in-process
 * (`packages/cli-kit/src/index.ts:69-70`).
 *
 * WHY A FACTORY. `pixsoCommands` is the export the registry consumes (design 2.1:143), but a
 * tier-1 test must drive these handlers through the REAL core pipeline against a fake
 * transport with zero network (design 2.1:149-153), and the frozen `CommandContext` has no
 * slot to carry one. `createPixsoCommands({ client })` is that slot: it threads
 * `FetchScanOptions.client` — core's OWN injection point, public and used by core's own suites
 * (`scanHandle.test.ts:173`) — through to every handler, and `pixsoCommands` is simply the
 * factory called with nothing, which is the "default to core's behaviour" branch.
 */
import { mkdirSync } from "node:fs";

import type { ArgSpec, CliCommand, CommandContext, Localized } from "@smart-tools/fe-cli-kit";
import { pick, resultOf } from "@smart-tools/fe-cli-kit";
import type { Artifact, PixsoClient, Scan } from "@smart-tools/pixso-core/node";
import { fetchScan } from "@smart-tools/pixso-core/node";

import type { FaceKind } from "./out.ts";
import { ASSET_FILES, assetPathIn, assetsTarget, faceTarget } from "./out.ts";
import { fetchOptionsOf, resolveRoute } from "./routing.ts";
import { pixsoRuntimeOf } from "./runtime.ts";
import { argDescriptions, failed, phases, summaries, wroteFiles } from "./strings.ts";

/** The exit code for a failure the user's typing cannot fix. */
const RUNTIME_EXIT = 1;

/** What a test may replace. Empty in production — `pixsoCommands` passes nothing. */
export interface PixsoDeps {
  /** The transport `fetchScan` should use. Omitted ⇒ core builds its own over the endpoint. */
  readonly client?: PixsoClient | undefined;
}

/** The positional every one of the four commands takes, and it is required (design 2.1:112-119). */
const sourceArg: ArgSpec = {
  name: "<url|guid>",
  description: argDescriptions.source,
  required: true,
};

/**
 * Report a `Localized` on stderr in the language in play, and hand back the exit code.
 *
 * The UI's card goes out FIRST and the plain line after it, in that order and never the other
 * way round: `fail` stops whatever animator was easing the bar and marks the phase in flight
 * with a `✗` (`packages/cli-kit/src/ui.ts`), so the sentence that follows is written onto a
 * clean row instead of into the middle of a redraw. It is also idempotent, which is what lets
 * every refusal path in this file call it without any of them having to know whether an
 * earlier one already did.
 */
function refuse(ctx: CommandContext, message: Localized, code: number): number {
  ctx.ui.fail(message);
  ctx.stderr(pick(message, ctx.lang));
  return code;
}

/** An unknown throw rendered as a line of text. `Error` is the common case; core also throws
 *  `ScanFailedError`/`AdapterResolutionError`, both of which extend it
 *  (`scan.ts:126-133`, `adapters/registry.ts:143`), so `.message` covers all three. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Route, then scan. Returns the handle, or the exit code the caller should return.
 *
 * `source` rides back on the success arm because the caller needs it AFTER the scan, to name
 * the default output file, and by then it is known to be a non-empty string — `resolveRoute`
 * refuses an absent one. Handing it back is what saves every caller from re-narrowing
 * `ctx.source` with a check that can no longer fail.
 */
async function scanFor(
  ctx: CommandContext,
  deps: PixsoDeps,
): Promise<
  | { readonly ok: true; readonly scan: Scan; readonly source: string }
  | { readonly ok: false; readonly code: number }
> {
  ctx.ui.phase(phases.route);
  const source = ctx.source ?? "";
  const resolution = resolveRoute(source, pixsoRuntimeOf(ctx));
  if (!resolution.ok) {
    return { ok: false, code: refuse(ctx, resolution.message, resolution.exitCode) };
  }
  // The fetch has no countable work — one `get_node_dsl` round trip and one pass through the
  // parser (see the file header) — so this phase is the animator's: the bar eases while the
  // network is out and snaps when the next phase starts. That is the installer's own treatment
  // of a step it cannot measure (`install:288-289`).
  ctx.ui.phase(phases.fetch);
  try {
    const scan = await fetchScan(fetchOptionsOf(resolution.route, deps.client));
    return { ok: true, scan, source };
  } catch (error) {
    return { ok: false, code: refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT) };
  }
}

/**
 * Announce the result — the SAME two writes for every command in this file, in this order.
 *
 * `resultOf` builds one message: the headline, then one absolute path per line
 * (`packages/cli-kit/src/out.ts`). It goes to stdout so a script can read the paths, and to the
 * card so the person watching reads the same list. Nothing else reaches stdout on a successful
 * run — the phases and the bar are the UI's stream, which the CLI points at stderr.
 */
function report(ctx: CommandContext, paths: readonly string[]): number {
  const message = resultOf(wroteFiles(paths.length), paths);
  ctx.stdout(`${pick(message, ctx.lang)}\n`);
  ctx.ui.done(message);
  return 0;
}

/**
 * The three single-face commands, which differ ONLY in the face they ask for and the extension
 * their default filename gets. Written once so they cannot drift apart in their output rule,
 * which is now a single rule rather than a branch: the artifact is saved to
 * `faceTarget(ctx, source, face)` — the `-o` path when there is one, the documented default
 * under `./fe-out/pixso/` when there is not — and the absolute path is reported.
 *
 * `source` is read off the resolution rather than off `ctx` again: `scanFor` has already proven
 * it is present (a missing one is the exit-2 refusal above), and re-reading `ctx.source` here
 * would mean re-proving it with a check the type system would then insist on.
 */
function faceCommand(
  flag: string,
  alias: string,
  summary: Localized,
  kind: FaceKind,
  face: (scan: Scan) => Artifact,
  deps: PixsoDeps,
): CliCommand {
  return {
    flag,
    alias,
    summary,
    args: [sourceArg, { name: "-o <path>", description: argDescriptions.out, required: false }],
    async run(ctx: CommandContext): Promise<number> {
      const scanned = await scanFor(ctx, deps);
      if (!scanned.ok) return scanned.code;
      try {
        ctx.ui.phase(phases.render);
        const artifact = face(scanned.scan);
        ctx.ui.phase(phases.write);
        // The brief's "parent dirs created" comes free: core's writer mkdirs the target's
        // directory before it writes (`ru-code-packages/.../io/artifacts.ts:53-54`), which is
        // what makes `./fe-out/pixso/` appear on the first bare run without this file owning a
        // second mkdir that could disagree with core's.
        const written = artifact.save(faceTarget(ctx, scanned.source, kind));
        return report(ctx, [written]);
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT);
      }
    },
  };
}

/**
 * `--get-pixso-assets` — one scan, four files, and `-o <dir>` is now OPTIONAL like everywhere
 * else (the owner's law; it used to be required by design 2.1:99-102).
 *
 * The directory used to be resolved before the scan so a bad `-o` did not cost a network round
 * trip. That ordering is gone with the refusal it protected: the default path is derived from
 * the source, `scanFor` has already established the source, and there is no longer an argument
 * error left for an early check to find.
 */
function assetsCommand(deps: PixsoDeps): CliCommand {
  return {
    flag: "--get-pixso-assets",
    alias: "--passets",
    summary: summaries.assets,
    args: [sourceArg, { name: "-o <dir>", description: argDescriptions.outDir, required: false }],
    async run(ctx: CommandContext): Promise<number> {
      const scanned = await scanFor(ctx, deps);
      if (!scanned.ok) return scanned.code;
      const dir = assetsTarget(ctx, scanned.source);
      try {
        // Core's own writer already creates parent directories
        // (`ru-code-packages/packages/pixso-core/src/io/artifacts.ts:54`); this is here so the
        // directory exists as a directory even in the impossible case of four failed writes,
        // and so the failure a bad `-o` produces names the DIRECTORY rather than a file in it.
        mkdirSync(dir, { recursive: true });
        const scan = scanned.scan;
        // Four faces from the ONE scan, rendered then written — the two phases kept apart
        // because they are two different costs, and because the write is the rare phase in
        // this package with a total known up front, so it gets a real percentage rather than
        // the animator's guess.
        ctx.ui.phase(phases.render);
        // Typed by what is actually used rather than as `Artifact[]`: three of the four are
        // `Artifact` but `scan.meta()` is a `ScanMeta`, and the two share only `save`. Naming
        // that shared shape keeps the loop honest instead of widening one of core's types.
        const faces: readonly {
          readonly artifact: { readonly save: (path: string) => unknown };
          readonly file: string;
        }[] = [
          { artifact: scan.toSvg(), file: ASSET_FILES.svg },
          { artifact: scan.toHtml(), file: ASSET_FILES.html },
          { artifact: scan.toPrompt(), file: ASSET_FILES.prompt },
          { artifact: scan.meta(), file: ASSET_FILES.meta },
        ];
        ctx.ui.phase(phases.write);
        // The paths reported are the paths WRITTEN, collected in the loop that writes them —
        // not rebuilt afterwards from the same four names. A second list would be a second
        // chance to report a file that was never saved.
        const written: string[] = [];
        for (const [index, face] of faces.entries()) {
          const path = assetPathIn(dir, face.file);
          face.artifact.save(path);
          written.push(path);
          ctx.ui.progress(index + 1, faces.length);
        }
        return report(ctx, written);
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT);
      }
    },
  };
}

/** Build the four commands over a set of dependencies. */
export function createPixsoCommands(deps: PixsoDeps = {}): readonly CliCommand[] {
  return [
    faceCommand("--get-pixso-svg", "--psvg", summaries.svg, "svg", (scan) => scan.toSvg(), deps),
    faceCommand(
      "--get-pixso-html",
      "--phtml",
      summaries.html,
      "html",
      (scan) => scan.toHtml(),
      deps,
    ),
    faceCommand(
      "--get-pixso-prompt",
      "--pprompt",
      summaries.prompt,
      "prompt",
      (scan) => scan.toPrompt(),
      deps,
    ),
    assetsCommand(deps),
  ];
}

/** The commands this package contributes to the registry (design 2.1:143). */
export const pixsoCommands: readonly CliCommand[] = createPixsoCommands();
