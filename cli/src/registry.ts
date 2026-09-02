/**
 * THE REGISTRY — and the ONLY file in `cli/src` that knows a feature package by name.
 *
 * The design's cost test for adding a feature is "a new package plus one import line"
 * (design 2.1:79-81). That is a claim about THIS file: everything downstream — parsing, help,
 * dispatch — is written against `readonly CliCommand[]` and never against a particular feature,
 * so a second feature package is an import and a spread here and zero edits anywhere else.
 *
 * Concretely, adding `fe-figma` tomorrow is:
 *
 *   import { figmaCommands } from "@smart-tools/fe-figma";        // +1 line
 *   export const COMMANDS = [...pixsoCommands, ...figmaCommands]; // +1 spread
 *
 * Nothing sorts, filters or rewrites the array: a command's `flag`, `alias` and `summary` are
 * the feature package's own, and the help renderer prints exactly what the registry holds. The
 * CLI cannot drift from what actually runs, because there is no second list to drift from.
 */
import type { CliCommand } from "@smart-tools/fe-cli-kit";
import { pixsoCommands } from "@smart-tools/fe-pixso";
import { parseUiKitCommands, projectReportCommands } from "@smart-tools/fe-project-report";

/**
 * THE REGISTRY. One flat array, concatenated from the feature packages.
 *
 * `fe-project-report` is the second feature package, and its arrival is the cost test above
 * being paid in full: ONE import line and ONE spread, with zero edits to parsing, help or
 * dispatch. `parseUiKitCommands` is that package's SECOND command and cost one more spread on
 * the same import — it appears in `--help` in both languages, and `--parse-ui-kit`/`--pkit` are
 * parseable, with nothing else in `cli/src` edited for it. (`--source` is declared in
 * `parse.ts`'s options table for the mechanical reason `--ui-kit` is: `parseArgs` is strict and
 * must be told that a flag takes a value.) `--project-report` is parseable because `optionsFor` derives the options table
 * from this array (`cli/src/parse.ts:82-99`) and it appears in `--help` in both languages
 * because `helpText` prints exactly what this array holds (`cli/src/help.ts:74-93`).
 *
 * Every consumer is still written to behave correctly at length 0 — `--help` says "none
 * registered", and any invocation still fails on the no-command rule rather than crashing —
 * because the emptiness the scaffold had was never special-cased away.
 */
export const COMMANDS: readonly CliCommand[] = [
  ...pixsoCommands,
  ...projectReportCommands,
  ...parseUiKitCommands,
];

/**
 * THE RESOLVED SETTINGS A COMMAND RUNS AGAINST — `fe-pixso`'s own type, IMPORTED rather than
 * restated (`packages/fe-pixso/src/runtime.ts:44-48`).
 *
 * Re-exported here so `settings.ts` can build one without importing a feature package directly:
 * this file stays the single seam that knows a feature by name. Importing the type instead of
 * mirroring it means the compiler — not a comment — guarantees that what the CLI resolves is
 * exactly what the feature package expects, and a future change to `PixsoRuntime`'s shape breaks
 * the build here instead of silently at runtime.
 *
 * The VALUES travel to commands through `CommandContext` under the three owner-fixed names, in
 * BOTH the `flags` and `env` slots — the order `pixso-runtime` documents at
 * `packages/fe-pixso/src/runtime.ts:11-20`. `cli/src/settings.ts` owns that decision and its
 * reasoning.
 */
export type { PixsoRuntime } from "@smart-tools/fe-pixso";
