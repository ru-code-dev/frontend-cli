/**
 * FAKE COMMANDS — the registry the parsing/help/dispatch suites run against.
 *
 * Not a shortcut around testing the real registry, and the suites test that one too. It is a
 * necessity with a reason of its own: `COMMANDS` is legitimately EMPTY today
 * (`packages/fe-pixso/src/index.ts:15` ships `pixsoCommands = []` until brief 3.2 lands), so
 * every assertion about aliases, the one-command rule and per-command help rendering would pass
 * VACUOUSLY against it — a suite that cannot fail is not a suite
 * (`ru-code-packages/packages/pixso-cli/vite.config.ts:10-15`).
 *
 * Fixtures also test the right thing. What `cli` owns is the machinery — mapping a registry to
 * a parser, counting command flags, rendering both languages — and that machinery is generic
 * over `CliCommand` by design (design 2.1:79-81). Driving it with commands whose spellings the
 * suite chose proves the generic behaviour; driving it only with pixso's four would prove the
 * behaviour for pixso's four.
 *
 * The shapes are the real ones: `CliCommand` from the frozen contract, `Localized` summaries and
 * argument descriptions in both languages, `run` returning an exit code.
 */
import type { CliCommand, CommandContext } from "@smart-tools/fe-cli-kit";

/** Records what a fixture command was handed, so dispatch can be asserted on behaviour. */
export interface Invocation {
  readonly flag: string;
  readonly ctx: CommandContext;
}

/** Populated by the fixture commands' `run`. Reset with `calls.length = 0` between tests. */
export const calls: Invocation[] = [];

/** A command with a long alias — the shape the design specifies (`--psvg`, design 2.1:87). */
export const alphaCommand: CliCommand = {
  flag: "--fake-alpha",
  alias: "--falpha",
  summary: { ru: "тестовая команда альфа", en: "fake command alpha" },
  args: [
    {
      name: "<url|guid>",
      description: { ru: "ссылка или идентификатор", en: "link or identifier" },
      required: true,
    },
  ],
  run: (ctx) => {
    calls.push({ flag: "--fake-alpha", ctx });
    return Promise.resolve(0);
  },
};

/** A command with NO alias, so the help renderer's single-spelling branch is covered too. */
export const betaCommand: CliCommand = {
  flag: "--fake-beta",
  summary: { ru: "тестовая команда бета", en: "fake command beta" },
  args: [],
  run: (ctx) => {
    calls.push({ flag: "--fake-beta", ctx });
    return Promise.resolve(0);
  },
};

/** A command that throws, for the top-level error handler. */
export const explodingCommand: CliCommand = {
  flag: "--fake-explode",
  alias: "--fboom",
  summary: { ru: "падающая команда", en: "exploding command" },
  args: [],
  run: () => Promise.reject(new Error("engine said no")),
};

/** A command that reports its own non-zero exit code without throwing. */
export const refusingCommand: CliCommand = {
  flag: "--fake-refuse",
  summary: { ru: "команда, возвращающая код", en: "command returning a code" },
  args: [],
  run: () => Promise.resolve(2),
};

export const FAKE_COMMANDS: readonly CliCommand[] = [
  alphaCommand,
  betaCommand,
  explodingCommand,
  refusingCommand,
];
