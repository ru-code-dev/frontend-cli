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
 * what the run reports is the summary block on stderr and, in a pipe only, the bare path list on
 * stdout — `emitPaths` (`packages/cli-kit/src/out.ts`), design U3.
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

import type {
  ArgSpec,
  CliCommand,
  CommandContext,
  Localized,
  SummaryRow,
  UsageHint,
} from "@smart-tools/fg-cli-kit";
import { debugHintOf, emitPaths, usageHintOf } from "@smart-tools/fg-cli-kit";
import type { Artifact, PixsoClient, Scan } from "@smart-tools/pixso-core/node";
import { fetchScan } from "@smart-tools/pixso-core/node";

import type { FaceKind } from "./out.ts";
import { ASSET_FILES, assetPathIn, assetsTarget, designName, faceTarget } from "./out.ts";
import type { PixsoRoute } from "./routing.ts";
import { fetchOptionsOf, resolveRoute } from "./routing.ts";
import { pixsoRuntimeOf } from "./runtime.ts";
import {
  argDescriptions,
  argNames,
  defaultOuts,
  details,
  failed,
  fileUnit,
  phases,
  PIXSO_LINK,
  pixsoGroup,
  ready,
  routeLabels,
  rowKeys,
  summaries,
} from "./strings.ts";

/** The exit code for a failure the user's typing cannot fix. */
const RUNTIME_EXIT = 1;

/** What a test may replace. Empty in production — `pixsoCommands` passes nothing. */
export interface PixsoDeps {
  /** The transport `fetchScan` should use. Omitted ⇒ core builds its own over the endpoint. */
  readonly client?: PixsoClient | undefined;
}

/**
 * The positional every one of the four commands takes, and it is required (design 2.1:112-119).
 *
 * SPELLED WITH THE PLACEHOLDER, not with `url`. The usage line is help text, and the owner's
 * rule for help text is that a design link is named `<pixso-link>` wherever it is shown rather
 * than used — so `fg --psvg <url|guid>` was the one line left telling a reader to type a URL
 * while every example beside it told them to paste a link. The guid stays in the name because
 * the argument genuinely accepts both, and it stays SECOND for the same reason it is second in
 * the examples.
 *
 * Language-neutral on purpose: both halves are the same token in ru and en, which is what
 * `cli/tests/help.test.ts`'s "every ru placeholder is Russian" rule exempts by name. It is also
 * not a value list — `declaredValues` (`cli/src/parse.ts:232-242`) skips any word starting with
 * `<`, so the `|` here is prose, not an enumeration the parser will validate against.
 */
const sourceArg: ArgSpec = {
  name: "<pixso-link|guid>",
  description: argDescriptions.source,
  required: true,
};

/**
 * THE ONE REFUSAL PATH — design 2.6, and the whole of it.
 *
 * ONE VOICE, ONE STREAM (U3). This used to hand the message to the UI and then write the very
 * same sentence to `ctx.stderr`, an idiom from before the UI carried it — so every refusal was
 * printed twice. The UI's block IS the message now: `fail` erases whatever live line was in
 * flight, prints `✖ <message>` and, for a usage error, the two pointer rows the design fixes.
 * It is terminal and idempotent, which is what lets every refusal path here call it blindly.
 *
 * `hint` is present for an exit-2 refusal (the user can retype the line) and ABSENT for a
 * runtime one, where `cli/src/main.ts` supplies the `--debug` pointer instead.
 */
function refuse(ctx: CommandContext, message: Localized, code: number, hint?: UsageHint): number {
  ctx.ui.fail(message, hint);
  return code;
}

/**
 * THE HEADER'S THIRD PART — what this run is about, as the user would name it (design 2.5).
 *
 * The remote route's identity is the item-id lifted out of the link (`item 11-10`), because a
 * whole URL in a header is a line the eye has to parse rather than read; the local route's is
 * the guid exactly as typed (`11:10`). `designName` is the same extraction the default filename
 * uses (`./out.ts`), so the header and the file on disk name the same thing.
 */
function subjectOf(route: PixsoRoute): Localized {
  if (route.kind === "local") return { ru: route.itemId, en: route.itemId };
  const item = designName(route.url);
  return { ru: `item ${item}`, en: `item ${item}` };
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
  alias: Localized,
  hint: UsageHint,
  debug: UsageHint,
): Promise<
  | { readonly ok: true; readonly scan: Scan; readonly source: string }
  | { readonly ok: false; readonly code: number }
> {
  // ROUTING FIRST, AND WITHOUT A PHASE OF ITS OWN. `resolveRoute` is a pure read of the string
  // the user typed — no network, no disk, nothing to wait on — and announcing it as a phase put
  // a live progress line ahead of the header, which design §2.1 makes "the first thing a command
  // prints" (V5 finding #3). Nothing is lost: the phase measured a function call.
  const source = ctx.source ?? "";
  const resolution = resolveRoute(source, pixsoRuntimeOf(ctx));
  if (!resolution.ok) {
    // NO HEADER before a usage error — design 2.6: the header says what the run is doing, and
    // this run never started.
    return { ok: false, code: refuse(ctx, resolution.message, resolution.exitCode, hint) };
  }
  // THE HEADER, and it is now the run's first output on every path — including the runtime
  // failure below, which §2.6 requires to carry one (finding #4).
  ctx.ui.header([alias, routeLabels[resolution.route.kind], subjectOf(resolution.route)]);
  // The fetch has no countable work — one `get_node_dsl` round trip and one pass through the
  // parser (see the file header) — so this phase is the animator's: the bar eases while the
  // network is out and snaps when the next phase starts. That is the installer's own treatment
  // of a step it cannot measure (`install:288-289`).
  ctx.ui.phase(phases.fetch);
  try {
    const scan = await fetchScan(fetchOptionsOf(resolution.route, deps.client));
    return { ok: true, scan, source };
  } catch (error) {
    // §2.6's runtime block: `✖ …` and the `--debug` pointer (V5 finding #4).
    return { ok: false, code: refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT, debug) };
  }
}

/**
 * Announce the result — the SAME two writes for every command in this file, in this order.
 *
 * `emitPaths` puts the absolute paths on STDOUT, and only when stdout is not a terminal (U3), so
 * a pipe gets a bare `xargs`-shaped list and a person does not read the same paths twice. The
 * summary block puts them on the UI's stream, one row per file, keyed by face — which is the
 * list the person watching actually reads (design 2.5).
 */
function report(ctx: CommandContext, files: readonly { key: Localized; path: string }[]): number {
  // The `запись` phase is sealed BEFORE stdout is written, so a merged-fd run reads the ledger
  // row and then the paths rather than the paths jumping the row (V5 finding #2).
  ctx.ui.end();
  emitPaths(
    ctx,
    files.map((file) => file.path),
  );
  const rows: readonly SummaryRow[] = files.map((file) => ({
    key: file.key,
    value: file.path,
    kind: "path",
  }));
  ctx.ui.summary({ ok: true, headline: ready, rows });
  return 0;
}

/**
 * The three single-face commands, which differ ONLY in the face they ask for and the extension
 * their default filename gets. Written once so they cannot drift apart in their output rule,
 * which is now a single rule rather than a branch: the artifact is saved to
 * `faceTarget(ctx, source, face)` — the `-o` path when there is one, the documented default
 * under `./fg-out/pixso/` when there is not — and the absolute path is reported.
 *
 * `source` is read off the resolution rather than off `ctx` again: `scanFor` has already proven
 * it is present (a missing one is the exit-2 refusal above), and re-reading `ctx.source` here
 * would mean re-proving it with a check the type system would then insist on.
 */
function faceCommand(spec: {
  readonly flag: string;
  readonly alias: string;
  readonly summary: Localized;
  readonly defaultOut: Localized;
  readonly details: Localized;
  readonly kind: FaceKind;
  readonly rowKey: Localized;
  readonly face: (scan: Scan) => Artifact;
  readonly deps: PixsoDeps;
}): CliCommand {
  const short = spec.alias;
  const command: CliCommand = {
    flag: spec.flag,
    alias: short,
    group: pixsoGroup,
    summary: spec.summary,
    defaultOut: spec.defaultOut,
    details: spec.details,
    // THE LINK FIRST, and spelled as the placeholder — owner's decision, and the same order
    // `argDescriptions.source` reads in: the remote route is what these commands are for, so
    // it is the line a reader's eye lands on. The guid example stays because the local route
    // is real, and stays SECOND because it needs the Pixso editor open on the same machine.
    // Neither line is a URL: see `PIXSO_LINK`.
    examples: [`fg ${short} ${PIXSO_LINK}`, `fg ${short} 11:10`],
    args: [
      sourceArg,
      {
        // Localized like every other placeholder on the ru page (V5 finding #12); the flag
        // itself is the same word in both languages, only the placeholder is not.
        name: argNames.out,
        description: argDescriptions.out,
        required: false,
      },
    ],
    async run(ctx: CommandContext): Promise<number> {
      // Built per run: the usage line it quotes is localized (V5 finding #12).
      const scanned = await scanFor(
        ctx,
        spec.deps,
        aliasPart(short),
        usageHintOf(command, ctx.lang),
        debugHintOf(command),
      );
      if (!scanned.ok) return scanned.code;
      try {
        ctx.ui.phase(phases.render);
        const artifact = spec.face(scanned.scan);
        ctx.ui.phase(phases.write);
        // The brief's "parent dirs created" comes free: core's writer mkdirs the target's
        // directory before it writes (`ru-code-packages/.../io/artifacts.ts:53-54`), which is
        // what makes `./fg-out/pixso/` appear on the first bare run without this file owning a
        // second mkdir that could disagree with core's.
        const written = artifact.save(faceTarget(ctx, scanned.source, spec.kind));
        return report(ctx, [{ key: spec.rowKey, path: written }]);
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT, debugHintOf(command));
      }
    },
  };
  return command;
}

/** The header's first part: the command, spelled the way the help spells it, dashes dropped. */
function aliasPart(alias: string): Localized {
  const name = alias.replace(/^-+/u, "");
  return { ru: name, en: name };
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
  const command: CliCommand = {
    flag: "--get-pixso-assets",
    alias: "--passets",
    group: pixsoGroup,
    summary: summaries.assets,
    defaultOut: defaultOuts.assets,
    details: details.assets,
    // Same order as the three single-face commands above, with `-o` shown on the remote line
    // because that is the one a reader will copy.
    examples: [
      `fg --passets ${PIXSO_LINK}`,
      `fg --passets ${PIXSO_LINK} -o ./out/card`,
      "fg --passets 11:10",
    ],
    args: [
      sourceArg,
      {
        name: argNames.outDir,
        description: argDescriptions.outDir,
        required: false,
      },
    ],
    async run(ctx: CommandContext): Promise<number> {
      const scanned = await scanFor(
        ctx,
        deps,
        aliasPart("--passets"),
        usageHintOf(command, ctx.lang),
        debugHintOf(command),
      );
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
          readonly key: Localized;
        }[] = [
          { artifact: scan.toSvg(), file: ASSET_FILES.svg, key: rowKeys.svg },
          { artifact: scan.toHtml(), file: ASSET_FILES.html, key: rowKeys.html },
          { artifact: scan.toPrompt(), file: ASSET_FILES.prompt, key: rowKeys.md },
          { artifact: scan.meta(), file: ASSET_FILES.meta, key: rowKeys.json },
        ];
        ctx.ui.phase(phases.write);
        // The paths reported are the paths WRITTEN, collected in the loop that writes them —
        // not rebuilt afterwards from the same four names. A second list would be a second
        // chance to report a file that was never saved.
        const written: { key: Localized; path: string }[] = [];
        for (const [index, face] of faces.entries()) {
          const path = assetPathIn(dir, face.file);
          face.artifact.save(path);
          written.push({ key: face.key, path });
          ctx.ui.progress(index + 1, faces.length, fileUnit(faces.length));
        }
        return report(ctx, written);
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT, debugHintOf(command));
      }
    },
  };
  return command;
}

/** Build the four commands over a set of dependencies. */
export function createPixsoCommands(deps: PixsoDeps = {}): readonly CliCommand[] {
  return [
    faceCommand({
      flag: "--get-pixso-svg",
      alias: "--psvg",
      summary: summaries.svg,
      defaultOut: defaultOuts.svg,
      details: details.svg,
      kind: "svg",
      rowKey: rowKeys.svg,
      face: (scan) => scan.toSvg(),
      deps,
    }),
    faceCommand({
      flag: "--get-pixso-html",
      alias: "--phtml",
      summary: summaries.html,
      defaultOut: defaultOuts.html,
      details: details.html,
      kind: "html",
      rowKey: rowKeys.html,
      face: (scan) => scan.toHtml(),
      deps,
    }),
    faceCommand({
      flag: "--get-pixso-prompt",
      alias: "--pprompt",
      summary: summaries.prompt,
      defaultOut: defaultOuts.prompt,
      details: details.prompt,
      kind: "prompt",
      rowKey: rowKeys.md,
      face: (scan) => scan.toPrompt(),
      deps,
    }),
    assetsCommand(deps),
  ];
}

/** The commands this package contributes to the registry (design 2.1:143). */
export const pixsoCommands: readonly CliCommand[] = createPixsoCommands();
