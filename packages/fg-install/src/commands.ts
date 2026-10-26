/**
 * `fg install`, `fg install --check`, `fg uninstall` — the `CliCommand`s.
 *
 * The flags are bare words (`install`, `uninstall`): `cli/src/parse.ts` recognises a command
 * whose `flag` has no dashes as a VERB typed in first position, which is the surface the owner
 * fixed (brief a1 §6). Everything impure arrives through {@link InstallDeps}, so the tier-1 suite
 * drives the real code against a scratch root with a fixture payload and a fake preflight.
 */
import type {
  ArgSpec,
  CliCommand,
  CommandContext,
  Localized,
  SummaryRow,
  UsageHint,
} from "@smart-tools/fg-cli-kit";
import { debugHintOf, emitPaths, pick, usageHintOf } from "@smart-tools/fg-cli-kit";

import { join } from "node:path";

import { MINIMUM_APP_VERSION, POINTER_JSON, RESTART_TIMEOUT_MS } from "./constants.ts";
import { embeddedPayload } from "./embedded.ts";
import {
  type InstalledState,
  LockedError,
  type SwapFs,
  inspectInstalled,
  installPlugin,
  uninstallPlugin,
} from "./install.ts";
import { type Layout, type Shadow, isFile, layoutOf, shadowOf } from "./layout.ts";
import { type InstallPayload, type PluginManifestFacts, validateManifest } from "./payload.ts";
import {
  type PreflightResult,
  parsePreflightStdout,
  runPreflight,
  runProcess,
} from "./preflight.ts";
import {
  type IsAlive,
  type Running,
  isProcessAlive,
  restartCommandOf,
  runningOf,
} from "./runtime.ts";
import * as s from "./strings.ts";
import { type AppVersion, appVersionOf } from "./version.ts";

/**
 * THE ENVIRONMENT THE USER'S SHELL GAVE `fg` — a snapshot taken when this module is evaluated.
 *
 * `fg.mjs` evaluates its imports before `run()` merges `<cwd>/.env` into the environment and
 * overlays the three `PIXSO_*` settings (and `--token`) onto `ctx.env`. `ctx.env` is therefore
 * NOT what the user typed `ru-code restart` with: handing it to the preflight or the restart
 * would pass project secrets, `T3CODE_HOME`/`VITE_DEV_SERVER_URL` (which move ru-code's state
 * dir) and the pixso token into ru-code and, through its daemon, into every process the server
 * spawns (R/ru-code/daemon/src/spawnServerChild.ts:35-37). The installer runs the preflight with
 * the shell env and no `.env` (R/ru-code/installer/parts/30-core.sh:234-239); so does fg.
 */
const SHELL_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({ ...process.env });

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** The seams. Every field has a production default. */
export interface InstallDeps {
  /** The plugin + preflight to install. Default: the payload embedded in the `fg` bundle. */
  readonly payload?: (() => InstallPayload | null) | undefined;
  /** The node that runs the preflight, as the installer's `$NODE_PATH` does. Default `process.execPath`. */
  readonly execPath?: string | undefined;
  readonly isAlive?: IsAlive | undefined;
  /** The swap's `rename`, for the mid-swap failure test. */
  readonly swapFs?: SwapFs | undefined;
  readonly restartTimeoutMs?: number | undefined;
  /**
   * The environment of the preflight AND the restart — never `ctx.env`. Default: the snapshot of
   * `process.env` taken when this module was evaluated, i.e. before `.env` and the `PIXSO_*`
   * overlay (see {@link SHELL_ENV}).
   */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

const checkSpec: ArgSpec = {
  name: "--check",
  description: s.checkArg.description,
  hint: s.checkArg.hint,
  required: false,
};

const noRestartSpec: ArgSpec = {
  name: "--no-restart",
  description: s.noRestartArg.description,
  hint: s.noRestartArg.hint,
  required: false,
};

/** Everything the three flows share, once the machine has been looked at. */
interface Located {
  readonly payload: InstallPayload;
  readonly manifest: PluginManifestFacts;
  readonly preflight: PreflightResult;
  readonly layout: Layout;
  readonly ruCodeInstalled: boolean;
}

/** The last non-empty lines of a process's output, on one line — for a failure's detail row. */
function tailOf(text: string, lines = 2): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-lines)
    .join(" | ");
}

/** An error's message, plus its `cause`'s when it carries one (a failed rollback rides along that way). */
const detailOf = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
};

/** `node ok · cli fail (missing) · git ok` — the preflight's own check facts, verbatim. */
function checksValue(preflight: PreflightResult): string {
  const at = (key: string) => preflight.keys.get(key) ?? "?";
  const kind = preflight.keys.get("CHECK_CLI_KIND");
  return `node ${at("CHECK_NODE")} · cli ${at("CHECK_CLI")}${kind === undefined ? "" : ` (${kind})`} · git ${at("CHECK_GIT")}`;
}

/** Report a failure through the UI (and the bare line for a UI-less context) and return `code`. */
function refuse(
  ctx: CommandContext,
  message: Localized,
  code: number,
  hint: UsageHint,
  detail?: Localized,
): number {
  ctx.ui.fail(message, hint, detail);
  ctx.stderr(
    `${pick(message, ctx.lang)}${detail === undefined ? "" : ` — ${pick(detail, ctx.lang)}`}\n`,
  );
  return code;
}

/** Warn about the shadow rule; returns the shadow for the summary. */
async function warnShadow(ctx: CommandContext, at: Located): Promise<Shadow> {
  const shadow = await shadowOf(at.layout, at.manifest.id);
  if (shadow.kind === "shadowed") {
    ctx.ui.warn(s.shadowedWarning(at.manifest.id, shadow.version, shadow.shippedDir));
  } else if (shadow.kind === "unknown") {
    ctx.ui.warn(s.shadowUnknownWarning);
  }
  return shadow;
}

/**
 * THE VERSION GATE ({@link MINIMUM_APP_VERSION}): the refusal when the installed ru-code is older
 * than the embedded plugin needs, or its version cannot be verified; `undefined` when it is new
 * enough. `fg install` and `--check` apply it; `fg uninstall` never does (removing must always work).
 */
function versionRefusal(
  at: Located,
  app: AppVersion,
): { readonly message: Localized; readonly detail: Localized } | undefined {
  if (app.kind === "ok") return undefined;
  const { id } = at.manifest;
  return app.kind === "old"
    ? { message: s.appTooOld(app.installed, id, MINIMUM_APP_VERSION), detail: s.appTooOldDetail }
    : {
        message: s.appVersionUnknown(id, MINIMUM_APP_VERSION),
        detail: s.appVersionUnknownDetail(join(at.layout.binDir, POINTER_JSON)),
      };
}

/** The `версия ru-code` and `нужен` rows. */
const versionRows = (app: AppVersion): SummaryRow[] => [
  {
    key: s.rowKeys.appVersion,
    value: app.kind === "unknown" ? s.appVersionUnknownValue : app.installed,
  },
  { key: s.rowKeys.minimum, value: s.minimumValue(MINIMUM_APP_VERSION) },
];

/** The `перезапуск` row. */
const restartRow = (value: Localized): SummaryRow => ({ key: s.rowKeys.restart, value });

export function createInstallCommands(deps: InstallDeps = {}): readonly CliCommand[] {
  const execPath = deps.execPath ?? process.execPath;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const loadPayload = deps.payload ?? embeddedPayload;
  const shellEnv = deps.env ?? SHELL_ENV;

  /**
   * Payload → preflight → root → manifest. Returns the exit code instead when the run cannot go
   * on; `requireRuCode` makes "ru-code is not installed" one of those (install), and leaves it a
   * fact to report otherwise (check, uninstall).
   */
  async function locate(
    ctx: CommandContext,
    command: CliCommand,
    requireRuCode: boolean,
  ): Promise<Located | number> {
    const debug = debugHintOf(command);
    let payload: InstallPayload | null;
    try {
      payload = loadPayload();
    } catch (error) {
      return refuse(ctx, s.installFailed(detailOf(error)), EXIT_FAILURE, debug);
    }
    if (payload === null) return refuse(ctx, s.noPayload, EXIT_FAILURE, debug, s.noPayloadDetail);

    ctx.ui.phase(s.phases.preflight);
    let preflight: PreflightResult;
    try {
      const run = await runPreflight(payload.preflight, { execPath, env: shellEnv });
      if (run.timedOut) return refuse(ctx, s.preflightTimedOut, EXIT_FAILURE, debug);
      if (ctx.verbose) {
        for (const line of run.stderr.split(/\r?\n/u))
          if (line.trim() !== "") ctx.ui.note({ ru: line, en: line });
      }
      preflight = parsePreflightStdout(run.stdout, run.code);
      if (preflight.ourRoot === undefined) {
        const tail = tailOf(run.stderr);
        return refuse(
          ctx,
          s.preflightFailed,
          EXIT_FAILURE,
          debug,
          tail === "" ? undefined : { ru: tail, en: tail },
        );
      }
    } catch (error) {
      return refuse(ctx, s.installFailed(detailOf(error)), EXIT_FAILURE, debug);
    }
    ctx.ui.end({ ru: preflight.ourRoot, en: preflight.ourRoot });

    // `installed` ⇔ `<OUR_ROOT>/bin/cli.js` is a file — the installer's own test (30-core.sh:342-354).
    const probe = layoutOf(preflight.ourRoot, payload.pluginDir);
    const ruCodeInstalled = await isFile(probe.cliJs);
    if (requireRuCode && !ruCodeInstalled) {
      return refuse(
        ctx,
        s.ruCodeNotInstalled,
        EXIT_FAILURE,
        debug,
        s.ruCodeNotInstalledDetail(probe.cliJs),
      );
    }

    ctx.ui.phase(s.phases.verify);
    const validation = validateManifest(payload);
    if (!validation.ok) {
      return refuse(ctx, s.badManifest, EXIT_FAILURE, debug, s.manifestProblem(validation.problem));
    }
    const { manifest } = validation;
    ctx.ui.end(s.pluginHeader(manifest.id, manifest.version));
    return {
      payload,
      manifest,
      preflight,
      layout: layoutOf(preflight.ourRoot, manifest.id),
      ruCodeInstalled,
    };
  }

  /**
   * THE RESTART RULE (brief a1 §5): only when files changed, only when ru-code is running, never
   * under `--no-restart`. Returns the summary row and whether the restart failed.
   */
  async function restartIfNeeded(
    ctx: CommandContext,
    at: Located,
    changed: boolean,
  ): Promise<{ readonly row: SummaryRow; readonly failed: boolean }> {
    if (!changed) {
      ctx.ui.note(s.unchangedNote);
      return { row: restartRow(s.restartValues.unchanged), failed: false };
    }
    const running = await runningOf(at.layout, isAlive);
    if (!running.running) {
      ctx.ui.note(s.notRunningNote);
      return { row: restartRow(s.restartValues.notRunning), failed: false };
    }
    if (ctx.flags["no-restart"] === true) {
      ctx.ui.note(s.noRestartNote);
      return { row: restartRow(s.restartValues.skipped), failed: false };
    }
    ctx.ui.phase(s.phases.restart);
    const { command, args } = await restartCommandOf(at.layout);
    let code: number | null;
    let tail: string;
    try {
      const run = await runProcess(command, args, {
        env: shellEnv,
        timeoutMs: deps.restartTimeoutMs ?? RESTART_TIMEOUT_MS,
      });
      code = run.timedOut ? null : run.code;
      tail = tailOf(`${run.stdout}\n${run.stderr}`, 1);
    } catch (error) {
      code = null;
      tail = detailOf(error);
    }
    if (code === 0) {
      ctx.ui.end();
      return { row: restartRow(s.restartValues.done), failed: false };
    }
    const detail = s.restartFailedDetail(code, tail);
    ctx.ui.warn(detail);
    return { row: restartRow(detail), failed: true };
  }

  const install: CliCommand = {
    flag: "install",
    group: s.ruCodeGroup,
    summary: s.installSummary,
    defaultOut: null,
    details: s.installDetails,
    examples: ["fg install", "fg install --check", "fg install --no-restart"],
    args: [checkSpec, noRestartSpec],
    async run(ctx: CommandContext): Promise<number> {
      const check = ctx.flags["check"] === true;
      if (ctx.source !== undefined) {
        return refuse(
          ctx,
          s.unexpectedArgument(ctx.source),
          EXIT_USAGE,
          usageHintOf(install, ctx.lang),
        );
      }
      ctx.ui.header([check ? s.headerNames.check : s.headerNames.install]);
      const at = await locate(ctx, install, !check);
      if (typeof at === "number") return at;
      return check ? runCheck(ctx, at) : runInstall(ctx, at);
    },
  };

  async function runInstall(ctx: CommandContext, at: Located): Promise<number> {
    // Before ANY write: a too-old (or unverifiable) ru-code would load the plugin as `failed`.
    const tooOld = versionRefusal(at, await appVersionOf(at.layout));
    if (tooOld !== undefined)
      return refuse(ctx, tooOld.message, EXIT_FAILURE, debugHintOf(install), tooOld.detail);
    const shadow = await warnShadow(ctx, at);
    ctx.ui.phase(s.phases.write);
    let outcome: Awaited<ReturnType<typeof installPlugin>>;
    try {
      outcome = await installPlugin(
        at.layout.target,
        at.layout.workDir,
        at.payload,
        deps.swapFs,
        isAlive,
      );
    } catch (error) {
      if (error instanceof LockedError) {
        return refuse(
          ctx,
          s.alreadyRunning(error.pid),
          EXIT_FAILURE,
          debugHintOf(install),
          s.alreadyRunningDetail(error.lockPath),
        );
      }
      return refuse(
        ctx,
        s.installFailed(detailOf(error)),
        EXIT_FAILURE,
        debugHintOf(install),
        s.installFailedDetail,
      );
    }
    if (outcome.leftover !== undefined) ctx.ui.warn(s.leftoverWarning(outcome.leftover));
    ctx.ui.end(outcome.changed ? undefined : s.unchangedPhase);
    const restart = await restartIfNeeded(ctx, at, outcome.changed);
    if (outcome.changed) emitPaths(ctx, [at.layout.target]);

    const { id, version } = at.manifest;
    const headline = restart.failed
      ? s.restartFailedHeadline(id, version)
      : !outcome.changed
        ? s.alreadyHeadline(id, version)
        : outcome.previous === "absent"
          ? s.installedHeadline(id, version)
          : s.replacedHeadline(id, version);
    ctx.ui.summary({
      ok: !restart.failed,
      headline,
      rows: [
        { key: s.rowKeys.target, value: at.layout.target, kind: "path" },
        { key: s.rowKeys.data, value: at.layout.dataDir, kind: "path" },
        { key: s.rowKeys.checks, value: checksValue(at.preflight) },
        ...(shadow.kind === "shadowed"
          ? [{ key: s.rowKeys.shadow, value: s.shadowValue(shadow.shippedDir) }]
          : []),
        restart.row,
      ],
    });
    return restart.failed ? EXIT_FAILURE : EXIT_OK;
  }

  async function runCheck(ctx: CommandContext, at: Located): Promise<number> {
    const { id, version } = at.manifest;
    const state: InstalledState = await inspectInstalled(at.layout.target, at.payload);
    const shadow: Shadow = at.ruCodeInstalled ? await warnShadow(ctx, at) : { kind: "unknown" };
    const running: Running = await runningOf(at.layout, isAlive);
    const wouldRestart =
      running.running && state !== "identical" && ctx.flags["no-restart"] !== true;
    const app = await appVersionOf(at.layout);
    const tooOld = versionRefusal(at, app);

    const ok =
      at.ruCodeInstalled &&
      tooOld === undefined &&
      state === "identical" &&
      shadow.kind === "clear";
    const headline = ok
      ? s.checkHeadlines.ok(id, version)
      : !at.ruCodeInstalled
        ? s.checkHeadlines.noRuCode
        : tooOld !== undefined
          ? tooOld.message
          : state === "absent"
            ? s.checkHeadlines.absent(id)
            : state === "different"
              ? s.checkHeadlines.different(id)
              : shadow.kind === "shadowed"
                ? s.checkHeadlines.shadowed(id)
                : s.checkHeadlines.shadowUnknown(id);
    ctx.ui.summary({
      ok,
      headline,
      rows: [
        {
          key: s.rowKeys.root,
          value: at.ruCodeInstalled ? at.layout.root : s.ruCodeAbsentValue(at.layout.cliJs),
          kind: at.ruCodeInstalled ? "path" : "text",
        },
        ...versionRows(app),
        { key: s.rowKeys.checks, value: checksValue(at.preflight) },
        { key: s.rowKeys.target, value: at.layout.target, kind: "path" },
        { key: s.rowKeys.state, value: s.stateValues[state] },
        { key: s.rowKeys.embedded, value: `${id} ${version}` },
        {
          key: s.rowKeys.shadow,
          value:
            shadow.kind === "shadowed"
              ? s.shadowValue(shadow.shippedDir)
              : shadow.kind === "clear"
                ? s.no
                : s.shadowUnknownValue,
        },
        { key: s.rowKeys.running, value: running.running ? s.runningValue(running.pid) : s.no },
        {
          key: s.rowKeys.restart,
          value: wouldRestart ? s.restartValues.wouldRun : s.restartValues.wouldNot,
        },
      ],
    });
    return ok ? EXIT_OK : EXIT_FAILURE;
  }

  const uninstall: CliCommand = {
    flag: "uninstall",
    group: s.ruCodeGroup,
    summary: s.uninstallSummary,
    defaultOut: null,
    details: s.uninstallDetails,
    examples: ["fg uninstall", "fg uninstall --no-restart"],
    args: [noRestartSpec],
    async run(ctx: CommandContext): Promise<number> {
      if (ctx.source !== undefined) {
        return refuse(
          ctx,
          s.unexpectedArgument(ctx.source),
          EXIT_USAGE,
          usageHintOf(uninstall, ctx.lang),
        );
      }
      ctx.ui.header([s.headerNames.uninstall]);
      const at = await locate(ctx, uninstall, false);
      if (typeof at === "number") return at;

      ctx.ui.phase(s.phases.remove);
      let removed: boolean;
      try {
        removed = await uninstallPlugin(at.layout.target, at.layout.workDir, isAlive);
      } catch (error) {
        if (error instanceof LockedError) {
          return refuse(
            ctx,
            s.alreadyRunning(error.pid),
            EXIT_FAILURE,
            debugHintOf(uninstall),
            s.alreadyRunningDetail(error.lockPath),
          );
        }
        return refuse(
          ctx,
          s.uninstallFailed(detailOf(error)),
          EXIT_FAILURE,
          debugHintOf(uninstall),
        );
      }
      ctx.ui.end();
      if (!removed) {
        ctx.ui.summary({
          ok: true,
          headline: s.notInstalledHeadline(at.manifest.id),
          rows: [{ key: s.rowKeys.target, value: at.layout.target, kind: "path" }],
        });
        return EXIT_OK;
      }
      const restart = await restartIfNeeded(ctx, at, true);
      ctx.ui.summary({
        ok: !restart.failed,
        headline: restart.failed
          ? s.uninstallRestartFailedHeadline(at.manifest.id)
          : s.uninstalledHeadline(at.manifest.id),
        rows: [
          { key: s.rowKeys.target, value: at.layout.target, kind: "path" },
          { key: s.rowKeys.data, value: at.layout.dataDir, kind: "path" },
          restart.row,
        ],
      });
      return restart.failed ? EXIT_FAILURE : EXIT_OK;
    },
  };

  return [install, uninstall];
}

/** The commands this package contributes, wired to the embedded payload. */
export const installCommands: readonly CliCommand[] = createInstallCommands();
