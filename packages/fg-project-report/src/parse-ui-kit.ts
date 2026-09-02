/**
 * `fg --parse-ui-kit <name> [--source <git-url|local-path>]` — regenerate a design system's corpus.
 *
 * THE SECOND COMMAND IN THIS PACKAGE, and it is here rather than in one of its own for the
 * reason the registry's cost test is about (`cli/src/registry.ts:5-16`): a package boundary buys
 * isolation, and there is none to buy. This command and `--project-report` share the adapter
 * registry, the `--ui-kit` spellings, the source resolver and every string file; splitting them
 * would mean exporting all four across a package boundary so that two commands about the same
 * design systems could live apart.
 *
 * ── THE FLOW: FOUR STEPS, ONE OF WHICH CAN TOUCH THE NETWORK TWICE ──────────────────────────
 *
 *  1. `resolveSource` — `--source` is a directory used where it lies, or a repository shallow-
 *     cloned into a temp dir that a `finally` removes (`packages/fg-source/src/resolve.ts`). The
 *     default is the adapter's own `EDS_SOURCE`, which is why the flag is optional.
 *  2. `extractKit` — the five extractors over that checkout, in dependency order, passing
 *     artifacts as values (`packages/fg-eds-adapter/src/extract/pipeline.ts`). Inside it, one
 *     `npm install` of `@v-uik` into a second temp dir, also removed in the `finally`.
 *  3. `writeCorpus` — the five JSONs into `~/.fg/kits/<name>/`, each stamped with where it came
 *     from, each renamed into place.
 *  4. The result: the headline, then every written file as an ABSOLUTE path on its own line —
 *     cli-kit's `resultOf` (`packages/cli-kit/src/out.ts`), the same shape every command in
 *     this repo ends with, on stdout AND inside the final card.
 *
 * ── WHY THERE IS NO `-o` ────────────────────────────────────────────────────────────────────
 *
 * The owner's law makes `-o` OPTIONAL everywhere; it does not make it universal, and the brief
 * says so for this command in particular — "fixed corpus dir (E2a) — no `-o`; card lists the
 * JSONs" (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:30`).
 *
 * The reason is what the output IS. `--project-report` writes a document, and a document goes
 * where the user says. This writes a CACHE, and a cache goes where the tool looks for it —
 * `~/.fg/kits/<name>/`, or wherever `FG_KITS_DIR` points. A corpus written somewhere else would
 * be a corpus nothing reads, so the flag that would let a user do that is absent rather than
 * documented. What the law asks of this command is the other half — that the run end with the
 * absolute paths of every file written — and it does, in the card as well as on stdout.
 *
 * ── WHY A MISSING npm IS A FAILURE AND NOT A DEGRADATION ────────────────────────────────────
 *
 * Everywhere else in this port, an absent `@v-uik` degrades: `kit-a11y.json` records
 * `upstreamAvailable: false` and the rules that need it report a limitation rather than going
 * quiet (`kit-a11y/extract.ts:221-246`). That is right for ANALYSIS and wrong here, because of
 * what this command's output does: a corpus REPLACES the embedded snapshot for every subsequent
 * run. Writing one with no upstream evidence would silently downgrade a user from a corpus that
 * has keyboard and spacing evidence for 63 upstream packages to one that has none — a strict
 * regression, produced by a command they ran to get something newer. So the install failing
 * stops the command, nothing is written, and the message says which of the two things to fix.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ArgSpec,
  CliCommand,
  CommandContext,
  Localized,
  UsageHint,
} from "@smart-tools/fg-cli-kit";
import { debugHintOf, emitPaths, pick, usageHintOf } from "@smart-tools/fg-cli-kit";
import type { CorpusStamp, ExtractedKit, ExtractKitOptions } from "@smart-tools/fg-eds-adapter";
import {
  EDS_PROFILES,
  EXTRACTOR_VERSION,
  extractKit,
  isNpmError,
  writeCorpus,
} from "@smart-tools/fg-eds-adapter";
import type { ResolvedSource, ResolveSourceOptions } from "@smart-tools/fg-source";
import { isSourceError, resolveSource } from "@smart-tools/fg-source";

import { ADAPTERS, type AdapterEntry } from "./adapters.ts";
import {
  argNames,
  corpusWritten,
  failedToParse,
  headerNames,
  plain,
  missingKit,
  npmFailure,
  parseArgDescriptions,
  parsePhases,
  analysisGroup,
  parseDefaultOutOf,
  parseDetails,
  parseSummary,
  sourceFailure,
  unknownParseKit,
} from "./strings.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/**
 * The design systems `--parse-ui-kit` can regenerate, and where each is cloned from.
 *
 * A SUBSET of the `--ui-kit` registry rather than the same list, and the difference is real: an
 * adapter can exist without a way to regenerate its corpus (a kit distributed as a tarball, a
 * kit whose extractors nobody has written), and such an entry belongs in `ADAPTERS` so reports
 * can use it while being absent here so the command does not promise something it cannot do.
 * Today the two happen to coincide, because `eds` is the only entry in either.
 *
 * The default source is the ADAPTER's (`packages/fg-eds-adapter/src/index.ts`'s `EDS_SOURCE`),
 * not a URL typed here — "which repository is this design system" changes when the kit moves,
 * and this file is not where that fact lives.
 */
export interface ParsableKit {
  readonly name: string;
  readonly defaultSource: string;
  /**
   * Branch or tag to check out after a clone; `null` for the repository's default branch.
   *
   * EDS 2.x lives on `develop-2.0` of the SAME repository as 1.x (design E2), so the source URL
   * alone does not identify the design system. `@smart-tools/fg-source` shallow-clones the
   * default branch and takes no ref (`packages/fg-source/src/resolve.ts:189`), so the ref is
   * fetched here — see {@link checkoutRef}.
   */
  readonly ref?: string | null | undefined;
  /** Which extraction pipeline this kit's corpus is produced by. */
  readonly extractor: "v1" | "v2";
}

export const PARSABLE_KITS: readonly ParsableKit[] = [
  {
    name: EDS_PROFILES.eds.id,
    defaultSource: EDS_PROFILES.eds.source.repo,
    ref: EDS_PROFILES.eds.source.ref,
    extractor: EDS_PROFILES.eds.extractor,
  },
  {
    name: EDS_PROFILES.eds2.id,
    defaultSource: EDS_PROFILES.eds2.source.repo,
    ref: EDS_PROFILES.eds2.source.ref,
    extractor: EDS_PROFILES.eds2.extractor,
  },
];

/**
 * Moves a fresh shallow clone onto `ref`.
 *
 * Only on a clone this command made (`kind: "cloned"`), never on a directory the user passed
 * with `--source`: checking out a branch in somebody's working copy is not something a
 * corpus-regeneration command may do, and a user who points at a checkout has already chosen
 * what is in it.
 *
 * A shallow clone has one branch, so the ref is FETCHED at depth 1 and checked out by its
 * fetched head rather than by name. Failure is fatal and says so: a corpus silently extracted
 * from the wrong branch is the one outcome worse than an error.
 */
const checkoutRef = async (dir: string, ref: string): Promise<void> => {
  const run = promisify(execFile);
  await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", ref]);
  await run("git", ["-C", dir, "checkout", "--detach", "FETCH_HEAD"]);
};

export const parsableKitNames = (kits: readonly ParsableKit[] = PARSABLE_KITS): readonly string[] =>
  kits.map((kit) => kit.name);

/**
 * THE POSITIONAL IS THE LIST OF KITS, not a placeholder for it — design §2.5/§2.7 spell the row
 * `--pkit eds` and the usage line `fg --pkit eds` (V5 finding #14).
 *
 * Derived from {@link PARSABLE_KITS} rather than typed, so a second parsable kit widens the row
 * to `eds|other` instead of turning it into a lie. `<name>` was the general form of a set with
 * one member in it, and it taught users to type the angle brackets.
 */
const kitArg: ArgSpec = {
  name: parsableKitNames().join("|"),
  description: parseArgDescriptions.kit,
  required: true,
};

const sourceFlagArg: ArgSpec = {
  // Localized like every other placeholder on the ru page (V5 finding #12).
  name: argNames.parseSource,
  description: parseArgDescriptions.source,
  required: false,
};

/** Report a `Localized` on stderr in the language in play and hand back the exit code. */
function refuse(ctx: CommandContext, message: Localized, code: number, hint?: UsageHint): number {
  ctx.ui.fail(message, hint);
  ctx.stderr(`${pick(message, ctx.lang)}\n`);
  return code;
}

/** An unknown throw rendered as a line of text. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A written file's stem, as the summary block keys it. A path is the same in both languages. */
function stemOf(path: string): Localized {
  const base = path.split("/").at(-1) ?? path;
  const stem = base.replace(/\.[^.]+$/u, "");
  return { ru: stem, en: stem };
}

/**
 * The seams, each typed as the function it replaces so a fake cannot drift from the real one.
 *
 * `writeCorpus` is NOT among them, deliberately. It is the step whose correctness the tier-1
 * suite most needs to check — the stamp, the five names, the `FG_KITS_DIR` override — and
 * faking it would fake away exactly that. It writes into a temp `FG_KITS_DIR` in the tests
 * instead, which costs a directory and buys the real thing.
 */
export interface ParseUiKitDeps {
  readonly resolveSource?:
    | ((input: string, options?: ResolveSourceOptions) => Promise<ResolvedSource>)
    | undefined;
  readonly extractKit?: ((options: ExtractKitOptions) => Promise<ExtractedKit>) | undefined;
  /** The registry `--parse-ui-kit` accepts, injectable so a test can drive an unknown name. */
  readonly kits?: readonly ParsableKit[] | undefined;
  /** Overrides the `--ui-kit` registry the corpus is written for; see `ADAPTERS`. */
  readonly adapters?: readonly AdapterEntry[] | undefined;
}

export function createParseUiKitCommands(deps: ParseUiKitDeps = {}): readonly CliCommand[] {
  const acquire = deps.resolveSource ?? resolveSource;
  const extract = deps.extractKit ?? extractKit;
  const kits = deps.kits ?? PARSABLE_KITS;
  const names = parsableKitNames(kits);

  const command: CliCommand = {
    flag: "--parse-ui-kit",
    alias: "--pkit",
    group: analysisGroup,
    summary: parseSummary,
    defaultOut: parseDefaultOutOf(names),
    details: parseDetails,
    examples: ["fg --pkit eds", "fg --pkit eds2", "fg --pkit eds --source ../ui-kit-eds-ce"],
    args: [kitArg, sourceFlagArg],
    async run(ctx: CommandContext): Promise<number> {
      // Built per run: the usage line it quotes is localized (V5 finding #12).
      const hint = usageHintOf(command, ctx.lang);
      // §2.6's runtime block: `✖ …` plus the `--debug` pointer (V5 finding #4).
      const debug = debugHintOf(command);
      // The KIT NAME is the positional, and `--source` is a flag — not the other way round. The
      // name is what the command is about and is required; the repository is a detail with a
      // correct default, and a user who has to type a URL to regenerate the kit they already
      // named has been asked for something the tool knows.
      const name = ctx.source;
      if (name === undefined || name === "") {
        return refuse(ctx, missingKit(names), EXIT_USAGE, hint);
      }

      const kit = kits.find((candidate) => candidate.name === name);
      // Refused BEFORE anything is cloned or installed: a misspelled kit is a line to retype,
      // and nobody should wait through a clone and an npm install to find that out.
      if (kit === undefined) return refuse(ctx, unknownParseKit(name, names), EXIT_USAGE, hint);

      const requested = ctx.flags["source"];
      const input =
        typeof requested === "string" && requested !== "" ? requested : kit.defaultSource;

      // THE HEADER (design §2.1/§2.5): `fg v1.0.0 · pkit · eds · https://…`. Printed once the
      // invocation is accepted and before the first phase, because both of its parts — the kit
      // and where its sources come from — are known from the line the user typed; nothing has to
      // be fetched to say them. A usage error above this point prints no header at all (§2.6).
      ctx.ui.header([headerNames.parseUiKit, plain(kit.name), plain(input)]);

      let source: ResolvedSource;
      ctx.ui.phase(parsePhases.fetch);
      try {
        source = await acquire(input);
        // The kit's branch, when it has one and when this run is the thing that cloned it.
        if (kit.ref !== undefined && kit.ref !== null && source.kind === "cloned") {
          await checkoutRef(source.dir, kit.ref);
        }
      } catch (error) {
        return isSourceError(error)
          ? refuse(ctx, sourceFailure(error), EXIT_FAILURE, debug)
          : refuse(ctx, failedToParse(detailOf(error)), EXIT_FAILURE, debug);
      }

      // A KIT THAT WRAPS NOTHING SKIPS THE PHASE, not just its argument.
      //
      // The v2 pipeline was already given no `upstreamPrefix`, but the temp directory was still
      // created and the row «установка @v-uik» / "installing @v-uik" was still printed and timed
      // — an empty directory made and removed, and a ledger row naming a library EDS 2.x has no
      // relationship with (V6 audit finding #5; README:614 already stated the step is skipped).
      // A phase row is a claim that the tool did something; the honest number of phases for a
      // kit with no upstream is one fewer.
      //
      // The directory itself gets its OWN temp root rather than a subdirectory of the checkout:
      // the checkout may be the user's own working copy (`--source .`), and a command that
      // regenerates a corpus must not leave a `node_modules` in it.
      const upstreamPrefix =
        kit.extractor === "v2" ? null : await mkdtemp(join(tmpdir(), "fg-vuik-"));

      try {
        if (upstreamPrefix !== null) ctx.ui.phase(parsePhases.upstream);
        const extracted = await extract({
          uiKitRoot: source.dir,
          ...(upstreamPrefix === null ? {} : { upstreamPrefix }),
          extractor: kit.extractor,
          onStage: (stage) => {
            ctx.ui.phase(parsePhases.extract(stage));
          },
        });

        ctx.ui.phase(parsePhases.write);
        const stamp: CorpusStamp = {
          kit: kit.name,
          version: extracted.version,
          commit: extracted.commit,
          // Second precision, UTC. The notice prints the date half of it, and the full value is
          // in the file for anyone comparing two regenerations of the same day.
          extractedAt: `${new Date().toISOString().slice(0, 19)}Z`,
          extractor: EXTRACTOR_VERSION,
          source: input,
        };
        const written = await writeCorpus({
          kit: kit.name,
          corpus: extracted.corpus,
          stamp,
          env: ctx.env,
        });

        // THE ONE OUTPUT SHAPE, built by the same helper every other command uses: a headline,
        // then one absolute path per line (`packages/cli-kit/src/out.ts`). This command already
        // printed that shape by hand; the change is that the CARD carries it too, so a user
        // watching the run reads the five paths instead of only the count.
        // The `запись` phase is sealed BEFORE stdout is written, so a merged-fd run reads the
        // ledger row and then the paths rather than the other way round (V5 finding #2).
        ctx.ui.end();
        emitPaths(ctx, written);
        ctx.ui.summary({
          ok: true,
          headline: corpusWritten({ kit: kit.name, version: extracted.version, files: written }),
          // One row per corpus file, keyed by the file's own stem — `tokens`, `components`, … —
          // which is design 2.5's shape for this command and needs no second list to stay true.
          rows: written.map((path) => ({ key: stemOf(path), value: path, kind: "path" as const })),
        });
        return EXIT_OK;
      } catch (error) {
        // The typed one first: a missing npm and a registry that said no are two different
        // things to do about it, and `npmFailure` is total over the two codes.
        return isNpmError(error)
          ? refuse(ctx, npmFailure(error), EXIT_FAILURE, debug)
          : refuse(ctx, failedToParse(detailOf(error)), EXIT_FAILURE, debug);
      } finally {
        // Both temporary trees, on every path. `source.cleanup()` is a no-op for a local
        // directory (`packages/fg-source/src/resolve.ts:156-158`), so this is unconditionally
        // correct and cannot remove a user's own checkout. The upstream tree is `null` for a kit
        // that wraps nothing, and there is then nothing to remove because nothing was made.
        if (upstreamPrefix !== null) await rm(upstreamPrefix, { recursive: true, force: true });
        await source.cleanup();
      }
    },
  };

  return [command];
}

/** The commands this package contributes for corpus regeneration. */
export const parseUiKitCommands: readonly CliCommand[] = createParseUiKitCommands();

/** Exported so a test can assert the two registries agree without restating either. */
export const registeredAdapterNames = (): readonly string[] => ADAPTERS.map((entry) => entry.name);
