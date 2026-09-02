/**
 * `fg --init-config [-o ./fg.config.json] [--ui-kit <name>]` — write the rule config and its
 * schema, listing every rule the selected design system can produce (design D12, §7.3).
 *
 * THE THIRD COMMAND IN THIS PACKAGE, and here for the same reason `--parse-ui-kit` is
 * (`parse-ui-kit.ts:4-9`): it shares the adapter registry, the `--ui-kit` spellings and the
 * string file with `--project-report`, and a package boundary between them would buy no
 * isolation while forcing all three to be exported across it.
 *
 * ── WHAT IT WRITES, AND WHY TWO FILES ────────────────────────────────────────────────────────
 *
 * `fg.config.json` is the file the analyser reads. `fg.config.schema.json` is what makes editing
 * it bearable: `$schema` points at it relatively, so an editor offers the six levels, completes
 * rule ids and shows each rule's description on hover — without which a 60-key file is a list of
 * strings nobody can verify. They are written together and refused together (see below), because
 * a config whose schema is missing is a config an editor silently stops checking.
 *
 * ── WHY IT REFUSES TO OVERWRITE ──────────────────────────────────────────────────────────────
 *
 * A config file is hand-edited work — the whole point is that a user switched things off in it.
 * Regenerating over the top of that would destroy exactly the information the command exists to
 * help produce, and it would do so silently, in a command a user runs when they are not sure what
 * they have. So an existing file at either path is a usage error (exit 2), nothing is written,
 * and the message names the two ways out (`-o`, or removing the file). There is no `--force`:
 * `rm fg.config.json` is that flag, and it is one a user cannot type by accident.
 *
 * ── HOW THE DESIGN SYSTEM IS CHOSEN ──────────────────────────────────────────────────────────
 *
 * `--ui-kit` when the user named one, otherwise autodetect from the CURRENT DIRECTORY's manifest
 * — `selectAdapter` over `ctx.cwd`, the same function `--project-report` runs over the resolved
 * project (`adapters.ts`). It is the current directory rather than a positional argument because
 * this command has no project to point at: it writes a file for the repository you are standing
 * in. Nothing matched is not a failure — the file then lists the engine's own rules, and a NOTE
 * says so, because the alternative is a user discovering the kit rules missing much later.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { KitAdapter, RuleCatalogEntry } from "@smart-tools/fg-analyzer-engine";
import { ruleCatalog } from "@smart-tools/fg-analyzer-engine";
import type {
  ArgSpec,
  CliCommand,
  CommandContext,
  Localized,
  UsageHint,
} from "@smart-tools/fg-cli-kit";
import { debugHintOf, emitPaths, pick, usageHintOf } from "@smart-tools/fg-cli-kit";

import type { AdapterEntry } from "./adapters.ts";
import { adapterNames, requestedAdapter, resolveAdapter, selectAdapter } from "./adapters.ts";
import { configDocumentOf, ruleEntriesOf, schemaDocumentOf, serialise } from "./config/files.ts";
import { CONFIG_FILE, CONFIG_SCHEMA_FILE } from "./config/names.ts";
import {
  adapterSelected,
  argNames,
  configExists,
  headerNames,
  kitVersionHeader,
  noKitHeader,
  corpusWarning,
  initConfigArgDescriptions,
  initConfigFailed,
  initConfigNoKit,
  initConfigPhases,
  analysisGroup,
  initConfigDefaultOut,
  initConfigDetails,
  initConfigSummary,
  rowKeys,
  initConfigWritten,
  unknownAdapter,
} from "./strings.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Where the config goes when `-o` was not given: `./fg.config.json`, beside the user. */
export const DEFAULT_CONFIG_OUT = `./${CONFIG_FILE}`;

const outArg: ArgSpec = {
  name: argNames.initConfigOut,
  description: initConfigArgDescriptions.out,
  required: false,
};

const uiKitArg: ArgSpec = {
  name: `--ui-kit ${adapterNames().join("|")}`,
  description: initConfigArgDescriptions.uiKit,
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

/** `true` when something is already at `path`. A read failure is "not there" — the write decides. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The seams. `ruleCatalog` is NOT one: it is the fact the file is about. */
export interface InitConfigDeps {
  /** The registry `--ui-kit` and autodetect choose from — injectable for the tier-1 suite. */
  readonly adapters?: readonly AdapterEntry[] | undefined;
}

export function createInitConfigCommands(deps: InitConfigDeps = {}): readonly CliCommand[] {
  const adapters = deps.adapters;
  const names = adapterNames(adapters);

  const command: CliCommand = {
    flag: "--init-config",
    alias: "--iconf",
    group: analysisGroup,
    summary: initConfigSummary,
    defaultOut: initConfigDefaultOut,
    details: initConfigDetails,
    examples: ["fg --iconf", "fg --iconf --ui-kit eds"],
    args: [outArg, uiKitArg],
    async run(ctx: CommandContext): Promise<number> {
      // Built per run: the usage line it quotes is localized (V5 finding #12).
      const hint = usageHintOf(command, ctx.lang);
      // §2.6's runtime block: `✖ …` plus the `--debug` pointer (V5 finding #4).
      const debug = debugHintOf(command);
      const uiKit = ctx.flags["ui-kit"];
      const requested = typeof uiKit === "string" && uiKit !== "" ? uiKit : undefined;
      const named = requested === undefined ? null : requestedAdapter(requested, adapters);
      // Refused before the disk is touched, exactly as `--project-report` does it: a misspelled
      // design system is a line to retype.
      if (named?.kind === "unknown") {
        return refuse(ctx, unknownAdapter(named.value, names), EXIT_USAGE, hint);
      }

      const out = ctx.out === undefined || ctx.out === "" ? DEFAULT_CONFIG_OUT : ctx.out;
      const configPath = resolve(ctx.cwd, out);
      // The schema lands BESIDE the config, whatever the config was called: `$schema` is
      // relative, and the two only work as a pair.
      const schemaPath = join(dirname(configPath), CONFIG_SCHEMA_FILE);

      try {
        // THE HEADER IS THE RUN'S FIRST OUTPUT (design §2.1, §2.6; V5 findings #3 and #4). It
        // carries the design system when `--ui-kit` already settles it — resolving a named kit
        // reads the kits directory, not the project — and says only `iconf` when the kit still
        // has to be detected. What detection finds is then a NOTE, below, which is the shape
        // §2.5 gives news that arrives mid-run.
        const namedResolution =
          named?.kind === "adapter" ? await resolveAdapter(named.entry, ctx.env) : null;
        ctx.ui.header([
          headerNames.initConfig,
          ...(named === null
            ? []
            : [
                named.kind === "adapter" && namedResolution !== null
                  ? kitVersionHeader(named.entry.name, namedResolution.provenance.version)
                  : noKitHeader,
              ]),
        ]);

        ctx.ui.phase(initConfigPhases.detect);
        const choice =
          named ??
          (await selectAdapter({
            dir: ctx.cwd,
            ...(adapters === undefined ? {} : { adapters }),
          }));
        const entry = choice.kind === "adapter" ? choice.entry : null;
        // Resolved ONCE: when the flag named the kit, the header above already read its corpus.
        const resolution =
          entry === null ? null : (namedResolution ?? (await resolveAdapter(entry, ctx.env)));

        // A corpus that could not be read is a WARNING: the file is still written, from the
        // embedded snapshot, and a user may want to know why their regenerated corpus was not
        // the one used (§2.6's `!` gutter).
        for (const warning of resolution?.warnings ?? []) {
          ctx.ui.warn(corpusWarning(entry?.name ?? "", warning));
        }
        // `--ui-kit none` is a decision, not an absence: the user asked for the generic rules,
        // so they are not told that "nothing was detected".
        if (choice.kind === "none" && choice.why === "no-match") {
          ctx.ui.warn(initConfigNoKit(names));
        } else if (named === null && entry !== null && resolution !== null) {
          // The header could not name it — detection had not run yet — so the note does. When
          // `--ui-kit` named it, the header did, and repeating it is the line V5 finding #9
          // removed from `--preport`.
          ctx.ui.note(adapterSelected(entry.name, resolution.provenance, "autodetect"));
        }

        const adapter: KitAdapter | undefined = resolution?.adapter;
        const catalog: readonly RuleCatalogEntry[] =
          adapter === undefined ? ruleCatalog() : ruleCatalog(adapter);

        // BOTH paths are checked BEFORE either is written, so a refusal never leaves half a pair
        // on disk.
        for (const path of [configPath, schemaPath]) {
          if (await exists(path)) return refuse(ctx, configExists(path), EXIT_USAGE, hint);
        }

        ctx.ui.phase(initConfigPhases.write);
        await mkdir(dirname(configPath), { recursive: true });
        const document = configDocumentOf({ catalog, uiKit: entry?.name ?? null });
        // `ctx.lang` reaches the SCHEMA too: its title and every description are hover text a
        // user reads while editing the config, so they follow `--lang` like the console output
        // does (PROTOCOL §4; V4 audit finding 1).
        const schema = schemaDocumentOf({ catalog, kitNames: names, lang: ctx.lang });
        // `wx` fails rather than truncates: between the check above and this line another process
        // could have created the file, and "never overwrite a configuration" has to survive that
        // window too.
        await writeFile(configPath, serialise(document), { encoding: "utf8", flag: "wx" });
        await writeFile(schemaPath, serialise(schema), { encoding: "utf8", flag: "wx" });

        const entries = ruleEntriesOf(catalog);
        // The same information the card carried, as design 2.5's block: the headline with the
        // rule counts, then one row per written file with its absolute path (U6).
        // The `запись` phase is sealed BEFORE stdout is written, so the two path lines land
        // after the ledger row that announces them and not inside it (V5 finding #2).
        ctx.ui.end();
        emitPaths(ctx, [configPath, schemaPath]);
        ctx.ui.summary({
          ok: true,
          headline: initConfigWritten({
            rules: catalog.length,
            subrules: entries.length - catalog.length,
          }),
          rows: [
            { key: rowKeys.config, value: configPath, kind: "path" },
            { key: rowKeys.schema, value: schemaPath, kind: "path" },
          ],
        });
        return EXIT_OK;
      } catch (error) {
        return refuse(ctx, initConfigFailed(detailOf(error)), EXIT_FAILURE, debug);
      }
    },
  };

  return [command];
}

/** The command this package contributes for generating a rule config (design §7.3). */
export const initConfigCommands: readonly CliCommand[] = createInitConfigCommands();
