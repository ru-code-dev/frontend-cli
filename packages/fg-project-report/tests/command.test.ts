/**
 * TIER 1 — the command, driven through its REAL handler with the three expensive seams faked.
 *
 * What is real here and what is not, and why that split is the point:
 *
 *   REAL — the handler's control flow, the exit codes, the localized strings, and `payloadOf`.
 *          `payloadOf` is the join B3 could not check for itself: its input types were
 *          declared structurally, "NOT from `packages/fg-analyzer-engine/`"
 *          (`WORKFLOW/features/hackathon-analys/reports/b3-analyzer-report.md:296-300`). Here
 *          it is fed a result of the engine's real shape, so the reconciliation is exercised
 *          rather than asserted.
 *   FAKE — `resolveSource` (would need git and a network), `analyzeProject` (would need a
 *          project on disk and a ts-morph run) and `renderReport` (a megabyte of substitution).
 *          Each is typed as the function it replaces, so a fake that drifts does not compile.
 *
 * The WRITE is real: `-o` lands in a scratch directory and the file is read back. A faked
 * filesystem would have made "parent dirs are created" a claim about the fake.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ReportPayload } from "@smart-tools/fg-analyzer-report";
import { argName, pick, usageLineOf } from "@smart-tools/fg-cli-kit";
import type { ResolvedSource } from "@smart-tools/fg-source";
import { SourceError } from "@smart-tools/fg-source";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ReportCounts } from "../src/index.ts";
import {
  adapterNames,
  adapterNotFound,
  createProjectReportCommands,
  defaultReportPath,
  filesRow,
  findingsRow,
  headerNames,
  hiddenRow,
  missingSource,
  missingSourceDetail,
  noKitHeader,
  outWithoutFile,
  phaseUnits,
  phases,
  REPORT_FORMATS,
  reportReady,
  rowKeys,
  sourceFailure,
  unknownFormat,
  writtenFormats,
} from "../src/index.ts";
import { capture, ENGINE_RESULT, scratch, text } from "./harness.ts";

const HTML = "<!doctype html><html><body>report</body></html>";

let dir = "";
let remove: () => Promise<void> = () => Promise.resolve();

beforeEach(async () => {
  ({ dir, remove } = await scratch());
});

afterEach(async () => {
  await remove();
});

/** What the fakes recorded, so a test can assert on what the handler ASKED for. */
interface Spy {
  readonly resolved: string[];
  readonly analyzed: { dir: string; domains: readonly string[] | undefined }[];
  readonly payloads: ReportPayload[];
  cleanups: number;
}

function commandWith(options: {
  readonly spy: Spy;
  readonly source?: ((input: string) => Promise<ResolvedSource>) | undefined;
  readonly analyze?: (() => Promise<never>) | undefined;
  readonly render?: (() => string) | undefined;
}) {
  const spy = options.spy;
  const commands = createProjectReportCommands({
    resolveSource:
      options.source ??
      ((input: string) => {
        spy.resolved.push(input);
        return Promise.resolve({
          kind: "local",
          dir: "/projects/app",
          cleanup: () => {
            spy.cleanups += 1;
            return Promise.resolve();
          },
        });
      }),
    analyzeProject:
      options.analyze ??
      ((analyzeOptions) => {
        spy.analyzed.push({ dir: analyzeOptions.dir, domains: analyzeOptions.domains });
        return Promise.resolve(ENGINE_RESULT);
      }),
    renderReport:
      options.render ??
      ((payload: ReportPayload) => {
        spy.payloads.push(payload);
        return HTML;
      }),
  });
  expect(commands).toHaveLength(1);
  return commands[0] as (typeof commands)[number];
}

const freshSpy = (): Spy => ({ resolved: [], analyzed: [], payloads: [], cleanups: 0 });

/**
 * THE SUMMARY BLOCK a run over {@link ENGINE_RESULT} must produce — design §2.3's rows.
 *
 * Built from the same string builders the command uses rather than typed out, for the reason the
 * suite header gives: a test that restated the sentences would be a copy of the implementation
 * instead of a check on it. What it DOES pin is the COMPOSITION — which rows exist, in what
 * order, and that a run with no `fg.config.json` and nothing suppressed prints no `скрыто` row
 * at all.
 */
const COUNTS: ReportCounts = {
  files: 9,
  cleanFiles: 7,
  errors: 1,
  warnings: 1,
  info: 0,
  candidates: 0,
  suppressed: 0,
  configPath: null,
};

/** The engine result with its one error demoted — an exit-0 run under U2. */
const CLEAN_RESULT = {
  ...ENGINE_RESULT,
  findings: ENGINE_RESULT.findings.map((finding) => ({ ...finding, severity: "warning" as const })),
};

/**
 * `ok` is FALSE for {@link ENGINE_RESULT}: it holds one visible `error`, and U2 makes that an
 * exit-1 run whatever the formats were. The headline says so, in red, and that is the whole of
 * the difference between the two forms.
 */
const reportResult = (path: string, lang: "ru" | "en" = "ru", ok = false) =>
  `summary:${pick(reportReady(ok), lang)} ` +
  `[${pick(rowKeys.files, lang)}=${pick(filesRow(COUNTS), lang)} ` +
  `${pick(rowKeys.findings, lang)}=${pick(findingsRow(COUNTS), lang)} html=${path}]`;

/**
 * The three UI lines every run of these fakes emits before its first phase-with-progress.
 *
 * THE HEADER IS FIRST since V5 findings #3/#4 (design §2.1: "the first thing a command prints",
 * §2.6: printed before a runtime failure). It carries the design system only when the LINE
 * settles it — these fakes name no `--ui-kit`, so the header is `preport` alone and the kit is
 * reported below, once autodetection has answered.
 */
const preamble = (lang: "ru" | "en" = "ru") => [
  `header:${pick(headerNames.report, lang)}`,
  `phase:${pick(phases.resolve, lang)}`,
  `warn:${pick(adapterNotFound(adapterNames()), lang)}`,
];

// The widest line is therefore the width itself.
const widest = (document: string) => Math.max(...document.split("\n").map((line) => line.length));

describe("the registry entry itself", () => {
  it("is ONE command spelled --project-report with the alias --preport", () => {
    const commands = createProjectReportCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.flag).toBe("--project-report");
    expect(commands[0]?.alias).toBe("--preport");
  });

  /**
   * FIVE arguments since U1: `--lint` is gone, and with it the second way to ask for the console
   * output. The NAMES are asserted verbatim because they are a user-facing surface — the help
   * table's first column and every refusal's `использование:` row are built from them
   * (`cli/src/help.ts`, `usageHintOf`) — and because A5's report flagged the old ones as a
   * 143-column usage line. Only the project is required.
   */
  it("declares its five arguments; only the project is REQUIRED", () => {
    const args = createProjectReportCommands()[0]?.args ?? [];
    // LOCALIZED PLACEHOLDERS (V5 finding #12): §2.7 spells the ru page's in Russian. A flag's
    // VALUE LIST stays one string — it is the same text in both languages, and `cli/src/parse.ts`
    // reads the accepted values back out of it.
    expect(args.map((a) => argName(a, "ru"))).toEqual([
      "<путь|repo>",
      "-o <путь>",
      `--format ${REPORT_FORMATS.join("|")}`,
      `--ui-kit ${adapterNames().join("|")}`,
      "--config <файл>",
    ]);
    expect(args.map((a) => argName(a, "en"))).toEqual([
      "<path|repo>",
      "-o <path>",
      `--format ${REPORT_FORMATS.join("|")}`,
      `--ui-kit ${adapterNames().join("|")}`,
      "--config <file>",
    ]);
    expect(args.map((a) => a.required)).toEqual([true, false, false, false, false]);
    expect(args.map((a) => argName(a, "ru")).join(" ")).not.toContain("--lint");
  });

  /**
   * The whole usage line the help and every refusal print — from THE builder, and elided.
   *
   * It used to be rebuilt by hand here, which is why a 127-column line could ship: the test
   * measured a copy of the rule rather than the rule (V5 finding #5). `usageLineOf` is the one
   * builder now, and §2.8's spelling is what it produces.
   */
  it("the usage line is §2.8's, elided, and well inside the design's 100 columns", () => {
    const command = createProjectReportCommands()[0];
    if (command === undefined) throw new Error("no command");
    expect(usageLineOf(command, "ru")).toBe(
      "fg --preport <путь|repo> [-o <путь>] [--format …] [--ui-kit …] [--config …]",
    );
    for (const lang of ["ru", "en"] as const) {
      expect([...usageLineOf(command, lang)].length).toBeLessThanOrEqual(100);
      // The VALUE LISTS live on the help page's own rows, not in this line.
      expect(usageLineOf(command, lang)).not.toContain("html|compact|json|sarif");
      // …and the long spelling is a line of its own on the per-command page.
      expect(usageLineOf(command, lang)).not.toContain("--project-report");
    }
  });

  it("and the -o argument documents its default in both languages", () => {
    const out = createProjectReportCommands()[0]?.args[1];
    for (const lang of ["ru", "en"] as const) {
      expect(pick(out?.description ?? { ru: "", en: "" }, lang)).toContain("fg-out/report");
    }
  });

  it("the --ui-kit description names every accepted value, in both languages", () => {
    const uiKit = createProjectReportCommands()[0]?.args[3];
    for (const lang of ["ru", "en"] as const) {
      const text = pick(uiKit?.description ?? { ru: "", en: "" }, lang);
      // Built from the registry, so a design system added there documents itself in --help.
      for (const name of adapterNames()) expect(text).toContain(name);
    }
  });

  it("ships both languages for the summary and every argument", () => {
    const command = createProjectReportCommands()[0];
    for (const lang of ["ru", "en"] as const) {
      expect(pick(command?.summary ?? { ru: "", en: "" }, lang)).not.toBe("");
      for (const arg of command?.args ?? []) expect(pick(arg.description, lang)).not.toBe("");
    }
    expect(command?.summary.ru).not.toBe(command?.summary.en);
  });
});

describe("the happy flow — resolve → analyze → payload → render → write", () => {
  it("runs the three seams in order, writes the html, and exits 1 on a visible error", async () => {
    const spy = freshSpy();
    const command = commandWith({ spy });
    const out = join(dir, "report.html");
    const run = capture({ cwd: dir, source: "/projects/app", out });

    // U2: the report is written and complete, and the run still fails — {@link ENGINE_RESULT}
    // holds one visible `error`. The file's existence and the exit code are two facts.
    expect(await command.run(run.ctx)).toBe(1);

    expect(spy.resolved).toEqual(["/projects/app"]);
    // The resolved DIRECTORY is what gets analysed, not the string the user typed — that is
    // the whole point of the acquisition seam, and for a clone they are different paths.
    expect(spy.analyzed).toEqual([
      { dir: "/projects/app", domains: ["a11y", "components", "icons"] },
    ]);
    expect(await readFile(out, "utf8")).toBe(HTML);
    expect(text(run.err)).toBe("");
  });

  it("always asks the engine for ALL THREE domains (h4-design.md:9-10)", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx,
    );
    expect(spy.analyzed[0]?.domains).toEqual(["a11y", "components", "icons"]);
  });

  it("creates missing parent directories rather than failing on them", async () => {
    const spy = freshSpy();
    const out = join(dir, "a", "b", "c", "report.html");
    expect(await commandWith({ spy }).run(capture({ cwd: dir, source: "x", out }).ctx)).toBe(1);
    expect((await stat(out)).isFile()).toBe(true);
  });

  it("cleans the source up — on success", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx,
    );
    expect(spy.cleanups).toBe(1);
  });

  it("cleans the source up — even when the analysis throws", async () => {
    const spy = freshSpy();
    const command = commandWith({ spy, analyze: () => Promise.reject(new Error("ts-morph")) });
    expect(
      await command.run(capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx),
    ).toBe(1);
    // A clone left behind is a directory nobody will ever remove. `finally` is what makes this
    // hold on every arm (`packages/fg-source/src/resolve.ts:76-83` explains why `cleanup` is
    // on the value rather than a free function).
    expect(spy.cleanups).toBe(1);
  });
});

describe("payloadOf gets the REAL engine result — the B2/B3 reconciliation", () => {
  it("maps every finding and keeps the engine's own counters", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: "/projects/app", out: join(dir, "r.html") }).ctx,
    );
    const payload = spy.payloads[0];
    expect(payload).toBeDefined();
    expect(payload?.findings.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(payload?.summary.findings.total).toBe(2);
    expect(payload?.summary.files).toEqual({ scanned: 9, clean: 7 });
  });

  it("widens the engine's three categories to the dashboard's eight, seeding the rest at 0", () => {
    // The one structural mismatch between B2's result and B3's payload input, and the fix for
    // it: `packages/fg-analyzer-report/src/payload.ts` (`EngineFindingCounts` /
    // `withAllCategories`). The dashboard's contract declares all eight keys
    // (`packages/fg-analyzer-report/dashboard/src/contract.ts:88`) and reads `.a11y` by name
    // (`dashboard/src/screens/Overview.tsx:116`), so a payload with holes would be a payload
    // the dashboard's own types do not describe.
    const spy = freshSpy();
    const command = commandWith({ spy });
    return command
      .run(capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx)
      .then(() => {
        const byCategory = spy.payloads[0]?.summary.findings.byCategory;
        expect(byCategory).toEqual({
          token: 0,
          typography: 0,
          font: 0,
          api: 0,
          override: 0,
          component: 0,
          icon: 1,
          a11y: 1,
        });
      });
  });

  it("for a CLONE, names the project by what the USER typed and roots it where it landed", async () => {
    const spy = freshSpy();
    await commandWith({
      spy,
      source: (input: string) => {
        spy.resolved.push(input);
        return Promise.resolve({
          kind: "cloned",
          dir: "/tmp/fg-source-xyz/app",
          cleanup: () => {
            spy.cleanups += 1;
            return Promise.resolve();
          },
        });
      },
    }).run(
      capture({ cwd: dir, source: "https://example.invalid/app.git", out: join(dir, "r.html") })
        .ctx,
    );
    // For a clone these two differ, and the sidebar prints `name ?? root`
    // (`dashboard/src/App.tsx:142-143`): a report titled with a temp directory that no longer
    // exists names nothing a reader can use.
    expect(spy.payloads[0]?.project.name).toBe("https://example.invalid/app.git");
    expect(spy.payloads[0]?.project.root).toBe("/tmp/fg-source-xyz/app");
  });

  /**
   * V6 AUDIT FINDING #10 — the dashboard sidebar must never show a relative arg (a bare «.»).
   *
   * For a LOCAL directory `input` is whatever the user typed on the command line, which is
   * usually relative (`fg --preport .`) and never what the sidebar should print verbatim; the
   * resolved directory's own basename is the real project name, and it always exists (unlike a
   * clone's, which may already be a removed temp dir by the time the report is opened).
   */
  it("for a LOCAL directory, names the project by the resolved directory's basename, not the typed arg", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: ".", out: join(dir, "r.html") }).ctx,
    );
    expect(spy.resolved).toEqual(["."]);
    // The default fake resolves every input to `/projects/app` — so `name` must be `"app"`,
    // never the literal `"."` the user typed.
    expect(spy.payloads[0]?.project.name).toBe("app");
    expect(spy.payloads[0]?.project.root).toBe("/projects/app");
  });

  it("carries the engine's rule descriptions, so the report can say what was checked", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx,
    );
    const descriptions = spy.payloads[0]?.ruleDescriptions ?? {};
    // Eleven ported rules (B2 §2). Named by count rather than listed, so adding a rule to the
    // engine does not require editing this file — but a registry that went empty would fail.
    expect(Object.keys(descriptions).length).toBe(11);
    expect(descriptions["a11y.name.missing"]).toBeTruthy();
    expect(descriptions["icon.foreign-pack"]).toBeTruthy();
    expect(descriptions["component.duplicate"]).toBeTruthy();
  });
});

describe("usage errors — exit 2, and nothing is acquired", () => {
  it("no project argument", async () => {
    const spy = freshSpy();
    const run = capture({ cwd: dir, out: join(dir, "r.html") });
    expect(await commandWith({ spy }).run(run.ctx)).toBe(2);
    expect(text(run.err)).toBe(`${missingSource.ru}\n`);
    expect(spy.resolved).toEqual([]);
  });

  /**
   * V5 FINDING #21 — §2.6's headline is four words, and the explanation is the line below it.
   *
   * `✖ не указан проект: передайте каталог … (http(s)://…, git@…, file://…)` was 104 columns on
   * a page the design caps at 100, with the elapsed column at 51. The block is three lines now:
   * what went wrong, what it means, what to type.
   */
  it("the missing-project refusal is a four-word headline with the detail below it", async () => {
    const spy = freshSpy();
    const run = capture({ cwd: dir });
    expect(await commandWith({ spy }).run(run.ctx)).toBe(2);
    expect(missingSource.ru).toBe("не указан проект");
    expect([...missingSource.ru].length).toBeLessThanOrEqual(40);
    expect([...missingSource.en].length).toBeLessThanOrEqual(40);
    // The detail is a SEPARATE line the renderer dims, not part of the headline.
    expect(missingSourceDetail.ru).toContain("http(s)://…");
    expect(missingSource.ru).not.toContain("http(s)://…");
    // NO HEADER before a usage error — the run never started (§2.6) — and nothing else either.
    expect(run.ui).toHaveLength(1);
    expect(run.ui[0]).toBe(
      `fail:${missingSource.ru} <${missingSourceDetail.ru}> ` +
        "[fg --preport <путь|repo> [-o <путь>] [--format …] [--ui-kit …] [--config …]" +
        "|fg --help --preport]",
    );
  });

  it('an EMPTY project argument is the same refusal, not an attempt on ""', async () => {
    const spy = freshSpy();
    expect(
      await commandWith({ spy }).run(capture({ cwd: dir, source: "", out: "r.html" }).ctx),
    ).toBe(2);
    expect(spy.resolved).toEqual([]);
  });

  for (const lang of ["ru", "en"] as const) {
    it(`refuses in ${lang} when the language says so`, async () => {
      const spy = freshSpy();
      const run = capture({ cwd: dir, lang });
      await commandWith({ spy }).run(run.ctx);
      expect(text(run.err)).toBe(`${pick(missingSource, lang)}\n`);
    });
  }
});

describe("SourceError mapping — one localized sentence per code, exit 1", () => {
  const CODES = ["path-not-found", "not-a-directory", "git-not-installed", "clone-failed"] as const;

  for (const code of CODES) {
    for (const lang of ["ru", "en"] as const) {
      it(`${code} → the ${lang} message for that code`, async () => {
        const error = new SourceError({
          code,
          input: "/nope",
          ...(code === "clone-failed" ? { gitStderr: "fatal: repository not found" } : {}),
        });
        const spy = freshSpy();
        const command = commandWith({ spy, source: () => Promise.reject(error) });
        const run = capture({ cwd: dir, source: "/nope", out: join(dir, "r.html"), lang });

        expect(await command.run(run.ctx)).toBe(1);
        expect(text(run.err)).toBe(`${pick(sourceFailure(error), lang)}\n`);
        // The four messages must be four messages. A copy-paste that gave two codes the same
        // sentence would pass every assertion above and still be a bug.
        for (const other of CODES.filter((c) => c !== code)) {
          const twin = new SourceError({ code: other, input: "/nope" });
          expect(pick(sourceFailure(error), lang)).not.toBe(pick(sourceFailure(twin), lang));
        }
        expect(spy.analyzed).toEqual([]);
      });
    }
  }

  it("the two languages genuinely differ for every code", () => {
    for (const code of CODES) {
      const error = new SourceError({ code, input: "/nope" });
      expect(sourceFailure(error).ru).not.toBe(sourceFailure(error).en);
    }
  });

  it("git-not-installed names git, in both languages", () => {
    const error = new SourceError({ code: "git-not-installed", input: "https://host/r.git" });
    expect(sourceFailure(error).ru).toContain("git");
    expect(sourceFailure(error).en).toContain("git");
  });

  it("clone-failed carries git's own stderr when there is any, and omits it when there is not", () => {
    const withStderr = new SourceError({
      code: "clone-failed",
      input: "https://host/r.git",
      gitStderr: "fatal: repository not found",
    });
    expect(sourceFailure(withStderr).ru).toContain("fatal: repository not found");
    expect(sourceFailure(withStderr).en).toContain("fatal: repository not found");

    const without = new SourceError({ code: "clone-failed", input: "https://host/r.git" });
    // No dangling "git says:" with nothing after it.
    expect(sourceFailure(without).ru).not.toContain("сообщает");
    expect(sourceFailure(without).en).not.toContain("says");
  });

  it("a non-SourceError escaping the seam still exits 1 with a localized line", async () => {
    const spy = freshSpy();
    const command = commandWith({ spy, source: () => Promise.reject(new Error("boom")) });
    const run = capture({ cwd: dir, source: "x", out: join(dir, "r.html") });
    expect(await command.run(run.ctx)).toBe(1);
    expect(text(run.err)).toContain("boom");
    expect(text(run.err)).toMatch(/[А-Яа-яЁё]/u);
  });
});

describe("runtime failures after the source is in hand — exit 1", () => {
  it("the analysis throwing", async () => {
    const spy = freshSpy();
    const command = commandWith({ spy, analyze: () => Promise.reject(new Error("parse died")) });
    const run = capture({ cwd: dir, source: "x", out: join(dir, "r.html") });
    expect(await command.run(run.ctx)).toBe(1);
    expect(text(run.err)).toContain("parse died");
  });

  it("the render throwing", async () => {
    const spy = freshSpy();
    const command = commandWith({
      spy,
      render: () => {
        throw new Error("no ds-data slot");
      },
    });
    expect(
      await command.run(capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx),
    ).toBe(1);
  });

  it("the write failing — a directory where the file should go", async () => {
    const spy = freshSpy();
    const run = capture({ cwd: dir, source: "x", out: dir });
    // `dir` exists and is a directory; `writeFile` cannot replace it.
    expect(await commandWith({ spy }).run(run.ctx)).toBe(1);
    expect(text(run.err)).not.toBe("");
  });
});

describe("stdout is DATA ONLY — U3 — and the counts live in the block", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`${lang}: stdout carries the written path and nothing else`, async () => {
      const spy = freshSpy();
      const out = join(dir, "report.html");
      const run = capture({ cwd: dir, source: "x", out, lang });

      expect(await commandWith({ spy }).run(run.ctx)).toBe(1);

      // THE WHOLE OF STDOUT: one absolute path, one line. The design-system sentence that used
      // to sit above it is a UI note now (U3 — stdout is the data channel), which is what makes
      // `fg --preport … | xargs open` work in any language.
      expect(text(run.out)).toBe(`${out}\n`);
      // The counts are in the block, which is where a person reads them.
      const block = run.ui.at(-1) ?? "";
      expect(block).toBe(reportResult(out, lang));
      expect(block).toContain("9");
      expect(text(run.err)).toBe("");
    });
  }

  it("a TTY gets NO path on stdout — it already has it in the block (U3)", async () => {
    const spy = freshSpy();
    const out = join(dir, "report.html");
    const run = capture({ cwd: dir, source: "x", out, stdoutIsTTY: true });
    expect(await commandWith({ spy }).run(run.ctx)).toBe(1);
    expect(text(run.out)).toBe("");
    expect(run.ui.at(-1)).toBe(reportResult(out));
  });

  it("U2: no visible error is exit 0, and the headline says so", async () => {
    const spy = freshSpy();
    const command = createProjectReportCommands({
      resolveSource: () =>
        Promise.resolve({ kind: "local", dir: "/projects/app", cleanup: () => Promise.resolve() }),
      analyzeProject: () => Promise.resolve(CLEAN_RESULT),
      renderReport: () => HTML,
    })[0];
    const out = join(dir, "report.html");
    const run = capture({ cwd: dir, source: "x", out });
    expect(await command?.run(run.ctx)).toBe(0);
    expect(run.ui.at(-1)).toContain(pick(reportReady(true), "ru"));
    expect(spy.resolved).toEqual([]);
  });

  it("the two headlines are two sentences, in both languages", () => {
    for (const lang of ["ru", "en"] as const) {
      expect(pick(reportReady(true), lang)).not.toBe(pick(reportReady(false), lang));
    }
    expect(reportReady(false).ru).not.toBe(reportReady(false).en);
    expect(reportReady(false).en).not.toMatch(/[А-Яа-яЁё]/u);
  });
});

/**
 * THE PROGRESS PHASES — five of them, two of which are driven by the engine itself.
 *
 * The engine's `onProgress` is the only place the scan/rules boundary is observable
 * (`packages/fg-analyzer-engine/src/index.ts` — `AnalyzeProgress`), so the fake below EMITS
 * that callback rather than ignoring it: what is under test is the translation from the
 * engine's ticks into phases and percentages, and a fake that never ticked would leave exactly
 * that untested. How a phase LOOKS on a terminal belongs to
 * `packages/cli-kit/tests/ui.test.ts`; what belongs here is which phases exist and in what
 * order they are announced.
 */
describe("the terminal UI the command drives", () => {
  /** A command whose engine reports two scan ticks and two rule ticks as it goes. */
  function commandWithProgress() {
    const commands = createProjectReportCommands({
      resolveSource: () =>
        Promise.resolve({ kind: "local", dir: "/projects/app", cleanup: () => Promise.resolve() }),
      analyzeProject: (options) => {
        options.onProgress?.({ stage: "scan", done: 1, total: 2 });
        options.onProgress?.({ stage: "scan", done: 2, total: 2 });
        options.onProgress?.({ stage: "rules", done: 1, total: 2 });
        options.onProgress?.({ stage: "rules", done: 2, total: 2 });
        return Promise.resolve(ENGINE_RESULT);
      },
      renderReport: () => HTML,
    });
    return commands[0] as (typeof commands)[number];
  }

  /** The run's last word is the SUMMARY BLOCK (design 2.3): the counts headline, the config
   *  row, and the report's absolute path as a row of its own — never a sentence with the path
   *  spliced into it and wrapped. */
  it("announces resolve → header → scan → rules → render → write, and ends with the block", async () => {
    const out = join(dir, "report.html");
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out });
    expect(await commandWithProgress().run(ctx)).toBe(1);

    expect(ui).toEqual([
      ...preamble(),
      `phase:${phases.scan.ru}`,
      `progress:1/2 ${phaseUnits.files(2).ru}`,
      `progress:2/2 ${phaseUnits.files(2).ru}`,
      `phase:${phases.rules.ru}`,
      `progress:1/2 ${phaseUnits.rules(2).ru}`,
      `progress:2/2 ${phaseUnits.rules(2).ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru} (${writtenFormats(["html"]).ru})`,
      // The write phase is SEALED before the path reaches stdout (V5 finding #2) — the ledger
      // row lands ahead of the data instead of after it.
      "end",
      reportResult(out),
    ]);
  });

  /**
   * THE HEADER IS THE RUN'S FIRST LINE — design §2.1, and V5 findings #3 and #4.
   *
   * It used to be printed once the project was on disk, so that it could name the design system:
   * a run that failed while FETCHING the project printed no header at all, and every successful
   * run opened with a live progress line. It is printed the moment the invocation is accepted
   * now, and the design system joins it only when the flag already settles it — otherwise
   * autodetection reports itself as a note below.
   */
  it("the header is the FIRST line, once, and names the design system only when told", async () => {
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out: join(dir, "r.html") });
    await commandWithProgress().run(ctx);
    expect(ui.filter((line) => line.startsWith("header:"))).toEqual(["header:preport"]);
    expect(ui[0]).toBe("header:preport");

    // …and with `--ui-kit none` on the line, the header says so — no project needed.
    const named = capture({
      cwd: dir,
      source: "/projects/app",
      out: join(dir, "r2.html"),
      uiKit: "none",
    });
    await commandWithProgress().run(named.ctx);
    expect(named.ui[0]).toBe(`header:preport · ${noKitHeader.ru}`);
  });

  /**
   * V5 FINDING #9 — a note that never carries news is a line nobody reads.
   *
   * With `--ui-kit` on the line the header one row above already names the design system, so
   * «— выбрана флагом --ui-kit» tells the user what they just typed. Without it the note is the
   * only place the answer appears, so it must be there.
   */
  it("states the design system EITHER in the header OR in a note — never twice", async () => {
    const detected = capture({ cwd: dir, source: "/projects/app", out: join(dir, "a.html") });
    await commandWithProgress().run(detected.ctx);
    // Nothing named a kit and nothing matched: the header is bare and the WARN carries the news.
    expect(detected.ui[0]).toBe("header:preport");
    expect(detected.ui.filter((l) => l.startsWith("warn:") || l.startsWith("note:"))).toHaveLength(
      1,
    );

    const named = capture({
      cwd: dir,
      source: "/projects/app",
      out: join(dir, "b.html"),
      uiKit: "none",
    });
    await commandWithProgress().run(named.ctx);
    expect(named.ui[0]).toBe(`header:preport · ${noKitHeader.ru}`);
    expect(named.ui.filter((l) => l.startsWith("note:") || l.startsWith("warn:"))).toEqual([]);
  });

  /**
   * THE UNIT is what makes the non-TTY phase row say `598 файлов` rather than `598`
   * (design §2.2, and the orchestrator's own observation on the rebuilt bundle). It is passed
   * on every tick, and the two stages count different things.
   */
  it("every progress tick carries the unit its stage counts", async () => {
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out: join(dir, "r.html") });
    await commandWithProgress().run(ctx);
    const ticks = ui.filter((line) => line.startsWith("progress:"));
    expect(ticks.filter((line) => line.endsWith(phaseUnits.files(2).ru))).toHaveLength(2);
    expect(ticks.filter((line) => line.endsWith(phaseUnits.rules(2).ru))).toHaveLength(2);
    // Agreement with the count, not a fixed word: «2 файла», «1 файл», «598 файлов».
    expect(phaseUnits.files(1).ru).toBe("файл");
    expect(phaseUnits.files(2).ru).toBe("файла");
    expect(phaseUnits.files(598).ru).toBe("файлов");
    expect(phaseUnits.rules(11).ru).toBe("правил");
    expect(phaseUnits.files(1).en).toBe("file");
    expect(phaseUnits.files(2).en).toBe("files");
  });

  /**
   * THE DEFAULT PATH, end to end: no `-o`, and the file lands at `./fg-out/report.html` under
   * the context's cwd with the block naming it absolutely. This is the case the owner's law is
   * actually about, and it used to be an exit-2 refusal.
   */
  it("with no -o the report is written to ./fg-out/report.html and the block names it", async () => {
    const { ctx, ui, out } = capture({ cwd: dir, source: "/projects/app" });
    expect(await commandWithProgress().run(ctx)).toBe(1);

    const expected = join(dir, defaultReportPath("html"));
    expect(await readFile(expected, "utf8")).toBe(HTML);
    expect(ui.at(-1)).toBe(reportResult(expected));
    // …and the same path on stdout, as the last line.
    expect(text(out).trimEnd().split("\n").at(-1)).toBe(expected);
  });

  it("a relative -o resolves against the CONTEXT's cwd, never the process's", async () => {
    const { ctx } = capture({ cwd: dir, source: "/projects/app", out: "nested/r.html" });
    expect(await commandWithProgress().run(ctx)).toBe(1);
    expect(await readFile(join(dir, "nested", "r.html"), "utf8")).toBe(HTML);
  });

  it("the rules phase is announced ONCE, on the first tick that says the engine moved on", async () => {
    const out = join(dir, "report.html");
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out });
    await commandWithProgress().run(ctx);
    expect(ui.filter((line) => line === `phase:${phases.rules.ru}`)).toHaveLength(1);
  });

  it("the scan phase exists even for a project the engine reports nothing about", async () => {
    const out = join(dir, "report.html");
    const spy = freshSpy();
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out });
    expect(await commandWith({ spy }).run(ctx)).toBe(1);
    // No tick ever arrives from this fake, and the run still names every phase it went through
    // except the one the engine alone can announce.
    expect(ui).toEqual([
      ...preamble(),
      `phase:${phases.scan.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru} (${writtenFormats(["html"]).ru})`,
      "end",
      ui.at(-1) ?? "",
    ]);
    expect(ui.at(-1)?.startsWith("summary:")).toBe(true);
  });

  it("a clone that fails fails the RESOLVE phase, and no block claims success", async () => {
    const spy = freshSpy();
    const command = commandWith({
      spy,
      source: () =>
        Promise.reject(
          new SourceError({
            code: "clone-failed",
            input: "git@example.com:nope.git",
            gitStderr: "repository not found",
          }),
        ),
    });
    const { ctx, ui } = capture({
      cwd: dir,
      source: "git@example.com:nope.git",
      out: join(dir, "r.html"),
    });
    expect(await command.run(ctx)).toBe(1);
    // §2.6: the HEADER comes first even here — "the command had started" — and the phase that
    // was in flight when it failed is the one the failure erases (V5 findings #3 and #4).
    expect(ui[0]).toBe("header:preport");
    expect(ui[1]).toBe(`phase:${phases.resolve.ru}`);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    expect(ui.filter((line) => line.startsWith("summary:"))).toEqual([]);
    // …and the failure block carries §2.6's SECOND line: the `--debug` pointer, and NO usage row
    // (the invocation was accepted, so there is nothing about it to correct) — V5 finding #4.
    expect(ui.at(-1)).toContain("[|fg --preport … --debug]");
  });

  it("--lang en renders every phase label in English", async () => {
    const out = join(dir, "report.html");
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out, lang: "en" });
    expect(await commandWithProgress().run(ctx)).toBe(1);
    expect(ui).toContain(`phase:${phases.scan.en}`);
    expect(ui).toContain(`phase:${phases.rules.en}`);
    expect(ui.join("\n")).not.toMatch(/[А-Яа-яЁё]/u);
  });
});

/**
 * U1 + U9 — ONE ANALYSIS, N OUTPUTS, and what `-o` names.
 *
 * The analysis seam is counted in every case here: "one analysis" is the property the design
 * states (§5) and a run that scanned twice for two formats would pass every content assertion
 * below and still be the bug.
 */
describe("--format and -o (U1, U9)", () => {
  const runWith = async (fields: Parameters<typeof capture>[0]) => {
    const spy = freshSpy();
    const run = capture(fields);
    const code = await commandWith({ spy }).run(run.ctx);
    return { code, run, spy };
  };

  it("no --format at all writes the html report, and only it", async () => {
    const { code, run, spy } = await runWith({ cwd: dir, source: "x" });
    expect(code).toBe(1);
    expect(await readFile(join(dir, defaultReportPath("html")), "utf8")).toBe(HTML);
    expect(text(run.out)).toBe(`${join(dir, defaultReportPath("html"))}\n`);
    expect(spy.analyzed).toHaveLength(1);
  });

  it("three formats, one scan, three files under ./fg-out", async () => {
    const { code, run, spy } = await runWith({
      cwd: dir,
      source: "x",
      formats: ["html", "json", "sarif"],
    });
    expect(code).toBe(1);
    expect(spy.analyzed).toHaveLength(1);
    for (const format of ["html", "json", "sarif"] as const) {
      expect((await stat(join(dir, defaultReportPath(format)))).isFile()).toBe(true);
    }
    // Every written path, on stdout, in the order the user asked for them.
    expect(text(run.out)).toBe(
      ["html", "json", "sarif"].map((f) => join(dir, `fg-out/report.${f}`)).join("\n") + "\n",
    );
    // …and one row per format in the block, keyed by the format's own name.
    const block = run.ui.at(-1) ?? "";
    for (const format of ["html", "json", "sarif"]) expect(block).toContain(`${format}=`);
  });

  it("the json and sarif documents are the formatter's, over the VISIBLE findings", async () => {
    await runWith({ cwd: dir, source: "x", formats: ["json", "sarif"] });
    const json: unknown = JSON.parse(await readFile(join(dir, defaultReportPath("json")), "utf8"));
    expect(Array.isArray(json)).toBe(true);
    const sarif: { version?: string; runs?: unknown[] } = JSON.parse(
      await readFile(join(dir, defaultReportPath("sarif")), "utf8"),
    ) as { version?: string; runs?: unknown[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
  });

  it("ONE file format + -o = that file, extension not enforced (U9)", async () => {
    const out = join(dir, "somewhere", "report.txt");
    const { code } = await runWith({ cwd: dir, source: "x", out, formats: ["html"] });
    expect(code).toBe(1);
    expect(await readFile(out, "utf8")).toBe(HTML);
  });

  it("SEVERAL file formats + -o = a directory of report.<ext> (U9)", async () => {
    const out = join(dir, "out");
    const { code, run } = await runWith({
      cwd: dir,
      source: "x",
      out,
      formats: ["sarif", "html"],
    });
    expect(code).toBe(1);
    expect(await readFile(join(out, "report.html"), "utf8")).toBe(HTML);
    expect((await stat(join(out, "report.sarif"))).isFile()).toBe(true);
    // The user's order is kept — it decides the rows and the stdout lines.
    expect(text(run.out)).toBe(`${join(out, "report.sarif")}\n${join(out, "report.html")}\n`);
  });

  it("compact ALONE prints the findings on stdout and writes no file", async () => {
    const { code, run } = await runWith({ cwd: dir, source: "x", formats: ["compact"] });
    expect(code).toBe(1);
    const document = text(run.out);
    expect(document).toContain("src/App.tsx");
    expect(document).toContain("a11y.name.missing");
    // §2.3, in full: "Compact-only runs print NO summary block: the compact footer is the
    // summary." The run still has to SEAL the phase in flight — otherwise a terminal keeps the
    // live line and a pipe loses the last ledger row — and `end` is that, without a headline
    // (V5 finding #10). So stderr ends with the phase row and nothing after it.
    expect(run.ui.filter((line) => line.startsWith("summary:"))).toEqual([]);
    expect(run.ui.at(-1)).toBe("end");
    // Nothing was written: `fg-out` does not exist at all.
    await expect(stat(join(dir, "fg-out"))).rejects.toThrow();
    // A pipe gets no escapes: colour follows STDOUT's capability (U7), and this stdout is not
    // a terminal.
    expect(document).not.toContain("\u001b[");
  });

  it("compact + html prints the findings on stdout AND the block on the UI (§2.3)", async () => {
    const { code, run } = await runWith({ cwd: dir, source: "x", formats: ["compact", "html"] });
    expect(code).toBe(1);
    const printed = text(run.out);
    expect(printed).toContain("src/App.tsx");
    // The path trails the document, one line, last.
    expect(printed.trimEnd().split("\n").at(-1)).toBe(join(dir, defaultReportPath("html")));
    expect(run.ui.at(-1)).toBe(reportResult(join(dir, defaultReportPath("html"))));
  });

  it("--verbose reaches the compact document", async () => {
    const plainRun = await runWith({ cwd: dir, source: "x", formats: ["compact"] });
    const loudRun = await runWith({
      cwd: dir,
      source: "x",
      formats: ["compact"],
      verbose: true,
    });
    expect(text(loudRun.run.out).length).toBeGreaterThan(text(plainRun.run.out).length);
    // `why` is the rule's own sentence, printed only under --verbose (design U5).
    expect(text(loudRun.run.out)).toContain("кнопка без доступного имени");
    expect(text(plainRun.run.out)).not.toContain("кнопка без доступного имени");
  });

  it("the terminal width reaches compact through the environment, and only then", async () => {
    const narrow = await runWith({
      cwd: dir,
      source: "x",
      formats: ["compact"],
      // NO_COLOR so the measurement is of TEXT: on a terminal `compact` would be coloured
      // (U7), and an escape sequence is width the eye does not see.
      columns: 200,
      env: { NO_COLOR: "1" },
      stdoutIsTTY: true,
    });
    const piped = await runWith({ cwd: dir, source: "x", formats: ["compact"] });
    // With a width the rule id is flushed right; without one it sits two spaces after the
    // message.
    expect(widest(text(narrow.run.out))).toBe(200);
    expect(widest(text(piped.run.out))).toBeLessThan(200);
  });

  it("-o with compact only is a usage error — nothing to write (U9)", async () => {
    const { code, run, spy } = await runWith({
      cwd: dir,
      source: "x",
      out: join(dir, "x.txt"),
      formats: ["compact"],
    });
    expect(code).toBe(2);
    expect(run.ui.at(-1)?.startsWith(`fail:${outWithoutFile.ru}`)).toBe(true);
    // Refused BEFORE the clone: a line to retype costs nobody a scan.
    expect(spy.resolved).toEqual([]);
  });

  it("an unknown format is a usage error naming the accepted values", async () => {
    const { code, run, spy } = await runWith({ cwd: dir, source: "x", formats: ["htlm"] });
    expect(code).toBe(2);
    expect(run.ui.at(-1)?.startsWith(`fail:${unknownFormat("htlm", REPORT_FORMATS).ru}`)).toBe(
      true,
    );
    for (const format of REPORT_FORMATS) expect(run.ui.at(-1)).toContain(format);
    expect(spy.resolved).toEqual([]);
  });

  it("duplicates collapse and the order is the user's", async () => {
    const { run } = await runWith({
      cwd: dir,
      source: "x",
      formats: ["sarif", "html", "sarif"],
    });
    expect(text(run.out)).toBe(
      `${join(dir, defaultReportPath("sarif"))}\n${join(dir, defaultReportPath("html"))}\n`,
    );
  });
});

/** The `скрыто` row and its `конфиг:` value — §2.3, and the addendum's "not twice" rule. */
describe("the hidden row", () => {
  it("is absent when nothing was hidden and no file was in force", async () => {
    const spy = freshSpy();
    const run = capture({ cwd: dir, source: "x", out: join(dir, "r.html") });
    await commandWith({ spy }).run(run.ctx);
    expect(run.ui.at(-1)).not.toContain(pick(rowKeys.hidden, "ru"));
  });

  it("names the config once, in the value, in both languages", () => {
    const counts: ReportCounts = { ...COUNTS, suppressed: 3, configPath: "/abs/rules.json" };
    for (const lang of ["ru", "en"] as const) {
      const row = pick(hiddenRow(counts), lang);
      expect(row).toContain("3");
      expect(row).toContain("/abs/rules.json");
      // The key is `скрыто`; the word `конфиг` appears exactly once, inside the value.
      expect(row.split(lang === "ru" ? "конфиг" : "config").length - 1).toBe(1);
    }
    expect(pick(hiddenRow({ ...COUNTS, suppressed: 0 }), "ru")).toContain("по умолчанию");
  });

  it("the findings row breaks the four severities out with their glyphs", () => {
    const row = pick(findingsRow({ ...COUNTS, info: 5, candidates: 2 }), "ru");
    expect(row.startsWith("9")).toBe(true);
    expect(row).toContain("✖ 1 ошибка");
    expect(row).toContain("▲ 1 предупреждение");
    expect(row).toContain("● 5 инфо");
    expect(row).toContain("◇ 2 кандидата");
    // A severity with nothing in it says nothing at all.
    const quiet = pick(
      findingsRow({ ...COUNTS, errors: 0, warnings: 0, info: 0, candidates: 0 }),
      "ru",
    );
    expect(quiet).toBe("0");
  });

  it("the files row states both numbers, in both languages", () => {
    expect(pick(filesRow(COUNTS), "ru")).toBe("9 просмотрено · 7 чистых");
    expect(pick(filesRow(COUNTS), "en")).toBe("9 scanned · 7 clean");
  });
});
