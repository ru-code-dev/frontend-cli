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
 * EXIT CODES. `2` for anything the user can fix by retyping the line — no source, no token, no
 * `-o` for the assets command (design 2.1:82, 2.1:118). `1` for a failure that happened after
 * the line was accepted: the engine refused the design, the endpoint was dead, the disk would
 * not take the write. `0` on success. `run` RETURNS the code and never calls `process.exit`,
 * which is what keeps the whole surface testable in-process
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
import { join, resolve } from "node:path";

import type { ArgSpec, CliCommand, CommandContext, Localized } from "@smart-tools/fe-cli-kit";
import { pick } from "@smart-tools/fe-cli-kit";
import type { Artifact, PixsoClient, Scan } from "@smart-tools/pixso-core/node";
import { fetchScan } from "@smart-tools/pixso-core/node";

import { fetchOptionsOf, resolveRoute, USAGE_EXIT } from "./routing.ts";
import { pixsoRuntimeOf } from "./runtime.ts";
import {
  ASSET_FILES,
  argDescriptions,
  failed,
  missingOutDir,
  summaries,
  wrote,
  wroteAssets,
} from "./strings.ts";

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

/** Report a `Localized` on stderr in the language in play, and hand back the exit code. */
function refuse(ctx: CommandContext, message: Localized, code: number): number {
  ctx.stderr(pick(message, ctx.lang));
  return code;
}

/** An unknown throw rendered as a line of text. `Error` is the common case; core also throws
 *  `ScanFailedError`/`AdapterResolutionError`, both of which extend it
 *  (`scan.ts:126-133`, `adapters/registry.ts:143`), so `.message` covers all three. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Route, then scan. Returns the handle, or the exit code the caller should return. */
async function scanFor(
  ctx: CommandContext,
  deps: PixsoDeps,
): Promise<
  { readonly ok: true; readonly scan: Scan } | { readonly ok: false; readonly code: number }
> {
  const resolution = resolveRoute(ctx.source, pixsoRuntimeOf(ctx));
  if (!resolution.ok) {
    return { ok: false, code: refuse(ctx, resolution.message, resolution.exitCode) };
  }
  try {
    return { ok: true, scan: await fetchScan(fetchOptionsOf(resolution.route, deps.client)) };
  } catch (error) {
    return { ok: false, code: refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT) };
  }
}

/**
 * The three single-face commands, which differ ONLY in the face they ask for. Written once so
 * they cannot drift apart in their output rule: `-o` present ⇒ the artifact saves itself and
 * the path is reported; `-o` absent ⇒ the raw bytes go to stdout, with nothing added — a
 * trailing newline would corrupt a byte-for-byte redirect into a file.
 */
function faceCommand(
  flag: string,
  alias: string,
  summary: Localized,
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
        const artifact = face(scanned.scan);
        if (ctx.out === undefined || ctx.out === "") {
          ctx.stdout(artifact.bytes);
          return 0;
        }
        const written = artifact.save(resolve(ctx.out));
        ctx.stdout(pick(wrote(written), ctx.lang));
        return 0;
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT);
      }
    },
  };
}

/**
 * `--get-pixso-assets` — one scan, four files, `-o <dir>` REQUIRED (design 2.1:99-102).
 *
 * The directory check comes BEFORE the scan on purpose: refusing after a network round trip
 * would make the user pay for a mistake the parser could see in the argument line.
 */
function assetsCommand(deps: PixsoDeps): CliCommand {
  return {
    flag: "--get-pixso-assets",
    alias: "--passets",
    summary: summaries.assets,
    args: [sourceArg, { name: "-o <dir>", description: argDescriptions.outDir, required: true }],
    async run(ctx: CommandContext): Promise<number> {
      if (ctx.out === undefined || ctx.out === "") {
        return refuse(ctx, missingOutDir, USAGE_EXIT);
      }
      const dir = resolve(ctx.out);
      const scanned = await scanFor(ctx, deps);
      if (!scanned.ok) return scanned.code;
      try {
        // Core's own writer already creates parent directories
        // (`ru-code-packages/packages/pixso-core/src/io/artifacts.ts:54`); this is here so the
        // directory exists as a directory even in the impossible case of four failed writes,
        // and so the failure a bad `-o` produces names the DIRECTORY rather than a file in it.
        mkdirSync(dir, { recursive: true });
        const scan = scanned.scan;
        scan.toSvg().save(join(dir, ASSET_FILES.svg));
        scan.toHtml().save(join(dir, ASSET_FILES.html));
        scan.toPrompt().save(join(dir, ASSET_FILES.prompt));
        scan.meta().save(join(dir, ASSET_FILES.meta));
        ctx.stdout(pick(wroteAssets(dir), ctx.lang));
        return 0;
      } catch (error) {
        return refuse(ctx, failed(detailOf(error)), RUNTIME_EXIT);
      }
    },
  };
}

/** Build the four commands over a set of dependencies. */
export function createPixsoCommands(deps: PixsoDeps = {}): readonly CliCommand[] {
  return [
    faceCommand("--get-pixso-svg", "--psvg", summaries.svg, (scan) => scan.toSvg(), deps),
    faceCommand("--get-pixso-html", "--phtml", summaries.html, (scan) => scan.toHtml(), deps),
    faceCommand(
      "--get-pixso-prompt",
      "--pprompt",
      summaries.prompt,
      (scan) => scan.toPrompt(),
      deps,
    ),
    assetsCommand(deps),
  ];
}

/** The commands this package contributes to the registry (design 2.1:143). */
export const pixsoCommands: readonly CliCommand[] = createPixsoCommands();
