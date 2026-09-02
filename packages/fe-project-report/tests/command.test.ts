/**
 * TIER 1 — the command, driven through its REAL handler with the three expensive seams faked.
 *
 * What is real here and what is not, and why that split is the point:
 *
 *   REAL — the handler's control flow, the exit codes, the localized strings, and `payloadOf`.
 *          `payloadOf` is the join B3 could not check for itself: its input types were
 *          declared structurally, "NOT from `packages/fe-analyzer-engine/`"
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

import type { ReportPayload } from "@smart-tools/fe-analyzer-report";
import { pick, resultOf } from "@smart-tools/fe-cli-kit";
import type { ResolvedSource } from "@smart-tools/fe-source";
import { SourceError } from "@smart-tools/fe-source";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  adapterNames,
  adapterNotFound,
  createProjectReportCommands,
  DEFAULT_REPORT,
  missingSource,
  phases,
  reportWritten,
  sourceFailure,
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

describe("the registry entry itself", () => {
  it("is ONE command spelled --project-report with the alias --preport", () => {
    const commands = createProjectReportCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]?.flag).toBe("--project-report");
    expect(commands[0]?.alias).toBe("--preport");
  });

  /**
   * CHANGED IN E2b. `-o` used to be declared REQUIRED here, which is what made the help print
   * `-o <file.html>` rather than `[-o <file.html>]` (`cli/src/help.ts:57`). The owner's law
   * makes it optional on every command — a run without one writes {@link DEFAULT_REPORT} — so
   * the project argument is now the ONLY required one.
   */
  it("declares its three arguments; only the project is REQUIRED", () => {
    const args = createProjectReportCommands()[0]?.args ?? [];
    expect(args.map((a) => a.name)).toEqual([
      "<repo-link|local-path>",
      "-o <file.html>",
      "--ui-kit <name>",
    ]);
    expect(args.map((a) => a.required)).toEqual([true, false, false]);
  });

  it("and both optional arguments document their default in both languages", () => {
    const out = createProjectReportCommands()[0]?.args[1];
    for (const lang of ["ru", "en"] as const) {
      expect(pick(out?.description ?? { ru: "", en: "" }, lang)).toContain(DEFAULT_REPORT);
    }
  });

  it("the --ui-kit description names every accepted value, in both languages", () => {
    const uiKit = createProjectReportCommands()[0]?.args[2];
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
  it("runs the three seams in order, writes the html, and exits 0", async () => {
    const spy = freshSpy();
    const command = commandWith({ spy });
    const out = join(dir, "report.html");
    const run = capture({ cwd: dir, source: "/projects/app", out });

    expect(await command.run(run.ctx)).toBe(0);

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
    expect(await commandWith({ spy }).run(capture({ cwd: dir, source: "x", out }).ctx)).toBe(0);
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
    // hold on every arm (`packages/fe-source/src/resolve.ts:76-83` explains why `cleanup` is
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
    // it: `packages/fe-analyzer-report/src/payload.ts` (`EngineFindingCounts` /
    // `withAllCategories`). The dashboard's contract declares all eight keys
    // (`packages/fe-analyzer-report/dashboard/src/contract.ts:88`) and reads `.a11y` by name
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

  it("names the project by what the USER typed and roots it where it landed", async () => {
    const spy = freshSpy();
    await commandWith({ spy }).run(
      capture({ cwd: dir, source: "https://example.invalid/app.git", out: join(dir, "r.html") })
        .ctx,
    );
    // For a clone these two differ, and the sidebar prints `name ?? root`
    // (`dashboard/src/App.tsx:142-143`): a report titled with a temp directory that no longer
    // exists names nothing a reader can use.
    expect(spy.payloads[0]?.project.name).toBe("https://example.invalid/app.git");
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

describe("the success line — one line, on stdout, in the language in play", () => {
  for (const lang of ["ru", "en"] as const) {
    it(`${lang}: counts of findings, severities and files scanned`, async () => {
      const spy = freshSpy();
      const out = join(dir, "report.html");
      const run = capture({ cwd: dir, source: "x", out, lang });

      expect(await commandWith({ spy }).run(run.ctx)).toBe(0);

      const printed = text(run.out);
      // CHANGED IN E2b: THREE lines, not two, and the path moved off the counts line onto its
      // own. In order: which design system the run measured against (here none, since the faked
      // project directory has no manifest); the counts; the absolute path of the one file
      // written. The notice comes first because it describes what is about to be measured, and
      // the path comes last because that is the one output shape every command in this repo now
      // ends with (`packages/cli-kit/src/out.ts`'s `resultOf`).
      expect(printed).toBe(
        `${pick(adapterNotFound(adapterNames()), lang)}\n` +
          `${pick(
            resultOf(reportWritten({ findings: 2, errors: 1, warnings: 1, files: 9 }), [out]),
            lang,
          )}\n`,
      );
      expect(printed.trimEnd().split("\n")).toHaveLength(3);
      expect(printed).toContain("2");
      expect(printed).toContain("9");
      // The path is a LINE, alone — not a fragment inside the counts sentence.
      expect(printed.trimEnd().split("\n").at(-1)).toBe(out);
      expect(text(run.err)).toBe("");
    });
  }

  it("findings are NOT a failure — a report full of violations still exits 0", async () => {
    const spy = freshSpy();
    expect(ENGINE_RESULT.summary.findings.total).toBeGreaterThan(0);
    expect(
      await commandWith({ spy }).run(
        capture({ cwd: dir, source: "x", out: join(dir, "r.html") }).ctx,
      ),
    ).toBe(0);
  });

  it("the two languages are genuinely different lines", () => {
    const counts = { findings: 2, errors: 1, warnings: 1, files: 9 };
    expect(reportWritten(counts).ru).not.toBe(reportWritten(counts).en);
    expect(reportWritten(counts).en).not.toMatch(/[А-Яа-яЁё]/u);
  });
});

/**
 * THE PROGRESS PHASES — five of them, two of which are driven by the engine itself.
 *
 * The engine's `onProgress` is the only place the scan/rules boundary is observable
 * (`packages/fe-analyzer-engine/src/index.ts` — `AnalyzeProgress`), so the fake below EMITS
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

  /** CHANGED IN E2b: the card's last entry is `resultOf(headline, [path])` — the counts
   *  sentence, then the absolute path on its own line — rather than a sentence with the path
   *  spliced into it. */
  it("announces resolve → scan → rules → render → write, and ends with counts + the path", async () => {
    const out = join(dir, "report.html");
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out });
    expect(await commandWithProgress().run(ctx)).toBe(0);

    expect(ui).toEqual([
      `phase:${phases.resolve.ru}`,
      `phase:${phases.scan.ru}`,
      "progress:1/2",
      "progress:2/2",
      `phase:${phases.rules.ru}`,
      "progress:1/2",
      "progress:2/2",
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      `done:${
        resultOf(reportWritten({ findings: 2, errors: 1, warnings: 1, files: 9 }), [out]).ru
      }`,
    ]);
  });

  /**
   * THE DEFAULT PATH, end to end: no `-o`, and the file lands at `./fe-out/report.html` under
   * the context's cwd with the card naming it absolutely. This is the case the owner's law is
   * actually about, and it used to be an exit-2 refusal.
   */
  it("with no -o the report is written to ./fe-out/report.html and the card names it", async () => {
    const { ctx, ui, out } = capture({ cwd: dir, source: "/projects/app" });
    expect(await commandWithProgress().run(ctx)).toBe(0);

    const expected = join(dir, DEFAULT_REPORT);
    expect(await readFile(expected, "utf8")).toBe(HTML);
    expect(ui.at(-1)).toBe(
      `done:${
        resultOf(reportWritten({ findings: 2, errors: 1, warnings: 1, files: 9 }), [expected]).ru
      }`,
    );
    // …and the same list on stdout, as the last line.
    expect(text(out).trimEnd().split("\n").at(-1)).toBe(expected);
  });

  it("a relative -o resolves against the CONTEXT's cwd, never the process's", async () => {
    const { ctx } = capture({ cwd: dir, source: "/projects/app", out: "nested/r.html" });
    expect(await commandWithProgress().run(ctx)).toBe(0);
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
    expect(await commandWith({ spy }).run(ctx)).toBe(0);
    // No tick ever arrives from this fake, and the run still names every phase it went through
    // except the one the engine alone can announce.
    expect(ui).toEqual([
      `phase:${phases.resolve.ru}`,
      `phase:${phases.scan.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      ui.at(-1) ?? "",
    ]);
    expect(ui.at(-1)?.startsWith("done:")).toBe(true);
  });

  it("a clone that fails fails the RESOLVE phase, and no card claims success", async () => {
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
    expect(ui[0]).toBe(`phase:${phases.resolve.ru}`);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    expect(ui.filter((line) => line.startsWith("done:"))).toEqual([]);
  });

  it("--lang en renders every phase label in English", async () => {
    const out = join(dir, "report.html");
    const { ctx, ui } = capture({ cwd: dir, source: "/projects/app", out, lang: "en" });
    expect(await commandWithProgress().run(ctx)).toBe(0);
    expect(ui).toContain(`phase:${phases.scan.en}`);
    expect(ui).toContain(`phase:${phases.rules.en}`);
    expect(ui.join("\n")).not.toMatch(/[А-Яа-яЁё]/u);
  });
});
