/**
 * THE FOUR COMMANDS, END TO END, IN PROCESS — through the REAL `@smart-tools/pixso-core`
 * pipeline, against an injected fake transport, with zero network and zero subprocess
 * (design 2.1:149-153, brief 3.2 deliverable 5).
 *
 * Nothing here is mocked but the wire. `fetchScan`, the adapter registry, the parse ladder and
 * all four faces are the shipped ones; the only substitution is `FetchScanOptions.client`,
 * which is core's OWN public injection point and the one its own suites use
 * (`ru-code-packages/packages/pixso-core/tests/scanHandle.test.ts:173`). So a green run here is
 * evidence about the product, not about a test double of it.
 *
 * WHAT IS ASSERTED: files on disk, the paths reported for them, exit codes, messages. Never an
 * internal. The face renders are the engine's to guarantee and it pins them byte-for-byte in its
 * own suite; what these tests own is that the RIGHT face's bytes reach the RIGHT destination and
 * that the destination is the one the user was promised.
 *
 * ── WHAT CHANGED IN E2b, AND WHY THESE EXPECTATIONS MOVED ───────────────────────────────────
 *
 * `-o` is optional on all four commands now, and a run without it WRITES rather than printing
 * the artifact to stdout (the owner's law,
 * `WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-34`). Three families of
 * assertion therefore had to change deliberately rather than be repaired:
 *
 *  - "no `-o` ⇒ the payload is the only thing on stdout" became "no `-o` ⇒ the file appears at
 *    the documented default and stdout carries its absolute path";
 *  - "`--get-pixso-assets` without `-o` is exit 2" became "…writes to the default directory";
 *  - the card's final line is `resultOf(headline, paths)` in every case, so `done:` now carries
 *    a headline plus one path per line rather than a single sentence with a path inside it.
 *
 * Every case below runs with `cwd` pointed at a fresh scratch directory, because every case now
 * writes something (`tests/fixtures/scratch.ts`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { CliCommand } from "@smart-tools/fe-cli-kit";
import { resultOf } from "@smart-tools/fe-cli-kit";
import {
  ASSET_FILES,
  assetsTarget,
  createPixsoCommands,
  faceTarget,
  phases,
  wroteFiles,
} from "../src/index.ts";
import { deadClient, fakeClient } from "./fixtures/fakeClient.ts";
import { CLEAN_DSL, DESIGN_URL, EMPTY_SELECTION_DSL, ROOT_GUID } from "./fixtures/fakeDsl.ts";
import { makeContext } from "./fixtures/context.ts";
import { disposeScratch, scratch } from "./fixtures/scratch.ts";

function commandFor(flag: string, transport: ReturnType<typeof fakeClient>): CliCommand {
  const found = createPixsoCommands({ client: transport.client }).find((c) => c.flag === flag);
  if (found === undefined) throw new Error(`no command registered for ${flag}`);
  return found;
}

/** The cwd every context in this file gets: a fresh directory, removed after each case. */
let cwd = "";
beforeEach(() => {
  cwd = scratch();
});
afterEach(() => {
  disposeScratch(cwd);
});

/** The three single-face commands and the shape their bytes must have. */
const FACES = [
  {
    flag: "--get-pixso-svg",
    alias: "--psvg",
    kind: "svg",
    file: ASSET_FILES.svg,
    head: "<svg ",
    tail: "</svg>",
  },
  {
    flag: "--get-pixso-html",
    alias: "--phtml",
    kind: "html",
    file: ASSET_FILES.html,
    head: "<!doctype html>",
    tail: "</html>",
  },
  {
    flag: "--get-pixso-prompt",
    alias: "--pprompt",
    kind: "prompt",
    file: ASSET_FILES.prompt,
    head: "# UI SPEC",
    tail: "",
  },
] as const;

describe("the registry contribution", () => {
  it("is the four commands the design names, each with its alias", () => {
    expect(createPixsoCommands().map((c) => [c.flag, c.alias] as const)).toEqual([
      ["--get-pixso-svg", "--psvg"],
      ["--get-pixso-html", "--phtml"],
      ["--get-pixso-prompt", "--pprompt"],
      ["--get-pixso-assets", "--passets"],
    ]);
  });

  it("every user-facing string it carries exists in BOTH languages", () => {
    for (const command of createPixsoCommands()) {
      expect(command.summary.ru.length).toBeGreaterThan(0);
      expect(command.summary.en.length).toBeGreaterThan(0);
      expect(command.summary.ru).not.toBe(command.summary.en);
      expect(command.args.length).toBeGreaterThan(0);
      for (const arg of command.args) {
        expect(arg.description.ru.length).toBeGreaterThan(0);
        expect(arg.description.en.length).toBeGreaterThan(0);
      }
    }
  });

  it("the source argument is REQUIRED on all four (v1 scope, design 2.1:112-119)", () => {
    for (const command of createPixsoCommands()) {
      expect(command.args[0]?.required).toBe(true);
    }
  });

  /**
   * CHANGED IN E2b. `--get-pixso-assets` used to declare `-o` REQUIRED, which is what put
   * `-o <dir>` rather than `[-o <dir>]` in the help's usage line (`cli/src/help.ts:57`). The
   * owner's law makes it optional on every command, so the help now offers it on every command,
   * and this assertion is the one that would catch the arg spec being left behind.
   */
  it("`-o` is OPTIONAL on all four — the owner's law, visible in the help's usage line", () => {
    const required = new Map(
      createPixsoCommands().map((c) => [c.flag, c.args[1]?.required] as const),
    );
    expect([...required.values()]).toEqual([false, false, false, false]);
  });
});

describe("the three faces — a file always, at `-o` or at the documented default", () => {
  for (const face of FACES) {
    it(`${face.flag} with no -o writes to ./fe-out/pixso/<name> and reports the absolute path`, async () => {
      const transport = fakeClient(CLEAN_DSL);
      const { ctx, out, err } = makeContext({ cwd, source: ROOT_GUID });
      expect(await commandFor(face.flag, transport).run(ctx)).toBe(0);
      expect(err).toEqual([]);

      // The path is not spelled here — it is asked of the builder the product uses, so this
      // test cannot pass while the product writes somewhere else.
      const expected = faceTarget(ctx, ROOT_GUID, face.kind);
      expect(expected).toBe(join(cwd, "fe-out", "pixso", `11-10${face.file.slice(4)}`));
      const bytes = readFileSync(expected, "utf8");
      expect(bytes.startsWith(face.head)).toBe(true);
      if (face.tail !== "") expect(bytes.trimEnd().endsWith(face.tail)).toBe(true);

      // stdout is the RESULT, not the payload: a headline line, then the absolute path.
      expect(out).toEqual([`${resultOf(wroteFiles(1), [expected]).ru}\n`]);
      expect(out[0]).toContain(expected);
      expect(out[0]).not.toContain(face.head);
      expect(transport.calls[0]).toBe("get_node_dsl");
    });

    it(`${face.flag} with -o writes THE SAME bytes to that path instead`, async () => {
      const target = join(cwd, "elsewhere", `out.${face.file.split(".")[1] ?? "txt"}`);

      const bare = makeContext({ cwd, source: ROOT_GUID });
      await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(bare.ctx);
      const defaulted = readFileSync(faceTarget(bare.ctx, ROOT_GUID, face.kind), "utf8");

      const saved = makeContext({ cwd, source: ROOT_GUID, out: target });
      expect(await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(saved.ctx)).toBe(0);

      // One payload, two destinations — the default and the explicit one hold the same bytes.
      expect(readFileSync(target, "utf8")).toBe(defaulted);
      expect(saved.out).toEqual([`${resultOf(wroteFiles(1), [target]).ru}\n`]);
    });

    it(`${face.flag} creates the parent directories of an -o nobody made`, async () => {
      const target = join(cwd, "a", "b", "c", `deep.${face.file.split(".")[1] ?? "txt"}`);
      const { ctx } = makeContext({ cwd, source: ROOT_GUID, out: target });
      expect(await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
      expect(existsSync(target)).toBe(true);
    });
  }

  it("the three faces are three DIFFERENT renders of the one design", async () => {
    const bytes: string[] = [];
    for (const face of FACES) {
      const { ctx } = makeContext({ cwd, source: ROOT_GUID });
      await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(ctx);
      bytes.push(readFileSync(faceTarget(ctx, ROOT_GUID, face.kind), "utf8"));
    }
    expect(new Set(bytes).size).toBe(3);
  });

  it("all three land beside each other, one stem and three extensions", async () => {
    for (const face of FACES) {
      const { ctx } = makeContext({ cwd, source: ROOT_GUID });
      await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(ctx);
    }
    expect(readdirSync(join(cwd, "fe-out", "pixso")).sort()).toEqual([
      "11-10.html",
      "11-10.md",
      "11-10.svg",
    ]);
  });

  it("a design link and its guid name the SAME file — the name follows the design", async () => {
    const link = makeContext({
      cwd,
      source: DESIGN_URL,
      env: { PIXSO_REMOTE_MCP_TOKEN: "t" },
    });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(link.ctx)).toBe(0);
    expect(readdirSync(join(cwd, "fe-out", "pixso"))).toEqual(["11-10.svg"]);
  });

  it("the report line is localized — the same run, two languages", async () => {
    const lines: string[] = [];
    for (const lang of ["ru", "en"] as const) {
      const { ctx, out } = makeContext({
        cwd,
        source: ROOT_GUID,
        out: join(cwd, `${lang}.svg`),
        lang,
      });
      expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
      lines.push(out[0] ?? "");
    }
    expect(lines[0]).not.toBe(lines[1]);
    expect(lines[0]).toMatch(/[а-яё]/i);
    expect(lines[1]).not.toMatch(/[а-яё]/i);
    // Both name the same kind of thing: a headline, then the path.
    for (const line of lines) expect(line.split("\n")[1]).toContain(cwd);
  });
});

describe("--get-pixso-assets — ONE scan, FOUR files", () => {
  it("writes exactly the four named files into -o, from a single get_node_dsl call", async () => {
    const dir = join(cwd, "assets");
    const transport = fakeClient(CLEAN_DSL);
    const { ctx, out, err } = makeContext({ cwd, source: ROOT_GUID, out: dir });
    expect(await commandFor("--get-pixso-assets", transport).run(ctx)).toBe(0);
    expect(err).toEqual([]);

    // EXACTLY four, and exactly these — a fifth file is as much a failure as a missing one.
    expect(readdirSync(dir).sort()).toEqual(
      [ASSET_FILES.html, ASSET_FILES.meta, ASSET_FILES.prompt, ASSET_FILES.svg].sort(),
    );
    // ONE scan. Four `fetchScan` calls would show four `get_node_dsl` here.
    expect(transport.calls.filter((tool) => tool === "get_node_dsl")).toHaveLength(1);

    // The card's shape: a headline saying four, then FOUR absolute paths, in write order.
    const reported = (out[0] ?? "").trimEnd().split("\n");
    expect(reported[0]).toBe(wroteFiles(4).ru);
    expect(reported.slice(1)).toEqual([
      join(dir, ASSET_FILES.svg),
      join(dir, ASSET_FILES.html),
      join(dir, ASSET_FILES.prompt),
      join(dir, ASSET_FILES.meta),
    ]);
  });

  /**
   * CHANGED IN E2b. This case used to assert `exit 2` and a message naming the four files
   * ("without -o it refuses…"). The refusal is gone with the owner's law; what replaces it is
   * the same run succeeding into the documented default directory.
   */
  it("with no -o it writes into ./fe-out/pixso/<name>/ rather than refusing", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx, out } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-assets", transport).run(ctx)).toBe(0);

    const dir = assetsTarget(ctx, ROOT_GUID);
    expect(dir).toBe(join(cwd, "fe-out", "pixso", "11-10"));
    expect(readdirSync(dir).sort()).toEqual(
      [ASSET_FILES.html, ASSET_FILES.meta, ASSET_FILES.prompt, ASSET_FILES.svg].sort(),
    );
    for (const file of Object.values(ASSET_FILES)) expect(out[0]).toContain(join(dir, file));
  });

  it("the default directory does not collide with the default face file of the same design", async () => {
    const svg = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(svg.ctx);
    const set = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(set.ctx);

    expect(readdirSync(join(cwd, "fe-out", "pixso")).sort()).toEqual(["11-10", "11-10.svg"]);
    expect(readdirSync(join(cwd, "fe-out", "pixso", "11-10"))).toHaveLength(4);
  });

  it("each file holds the face its name promises", async () => {
    const dir = join(cwd, "assets");
    const { ctx } = makeContext({ cwd, source: ROOT_GUID, out: dir });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);

    expect(readFileSync(join(dir, ASSET_FILES.svg), "utf8").startsWith("<svg ")).toBe(true);
    expect(readFileSync(join(dir, ASSET_FILES.html), "utf8").startsWith("<!doctype html>")).toBe(
      true,
    );
    expect(readFileSync(join(dir, ASSET_FILES.prompt), "utf8").startsWith("# UI SPEC")).toBe(true);

    // `card.json` is the model, parseable and identifying the design that was scanned.
    const meta: unknown = JSON.parse(readFileSync(join(dir, ASSET_FILES.meta), "utf8"));
    expect(meta).toMatchObject({ name: "Card", dslVersion: "2.1.15" });
  });

  it("the four files are byte-identical to what the single-face commands write", async () => {
    const dir = join(cwd, "assets");
    const { ctx } = makeContext({ cwd, source: ROOT_GUID, out: dir });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
    for (const face of FACES) {
      const single = makeContext({ cwd, source: ROOT_GUID });
      await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(single.ctx);
      expect(readFileSync(join(dir, face.file), "utf8")).toBe(
        readFileSync(faceTarget(single.ctx, ROOT_GUID, face.kind), "utf8"),
      );
    }
  });

  it("it creates the -o directory rather than demanding one exists", async () => {
    const nested = join(cwd, "a", "b");
    const { ctx } = makeContext({ cwd, source: ROOT_GUID, out: nested });
    expect(await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    expect(readdirSync(nested)).toHaveLength(4);
  });
});

describe("a failure after the line was accepted — exit 1, never 2", () => {
  it("a design the engine refuses is reported, localized, on stderr", async () => {
    for (const lang of ["ru", "en"] as const) {
      const { ctx, out, err } = makeContext({ cwd, source: ROOT_GUID, lang });
      expect(await commandFor("--get-pixso-svg", fakeClient(EMPTY_SELECTION_DSL)).run(ctx)).toBe(1);
      expect(out).toEqual([]);
      expect(err).toHaveLength(1);
      // Our wrapper is localized even though the engine's own detail rides along in English.
      expect(err[0]).toContain(
        lang === "ru" ? "не удалось выполнить команду" : "the command failed",
      );
    }
  });

  it("a dead endpoint is reported, not thrown out of `run`", async () => {
    const { ctx, err } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", deadClient()).run(ctx)).toBe(1);
    expect(err[0]).toContain("connection refused");
  });

  it("nothing is written when the fetch fails — not even the default directory", async () => {
    const { ctx } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-assets", deadClient()).run(ctx)).toBe(1);
    expect(readdirSync(cwd)).toEqual([]);
  });
});

/**
 * THE PROGRESS PHASES — the second thing every command now emits, and the only one a user
 * watching a slow fetch actually sees.
 *
 * Asserted against the RECORDER on the context (`tests/fixtures/context.ts`) rather than
 * against escape codes: what belongs to this package is WHICH phases are announced and IN WHAT
 * ORDER, and what belongs to `cli-kit` is how a phase looks on a terminal
 * (`packages/cli-kit/tests/ui.test.ts`). Splitting it that way means a change to the bar's
 * glyphs cannot break this suite and a dropped phase cannot pass it.
 */
describe("the terminal UI a command drives", () => {
  it("a face command walks route → fetch → render → write and ends with the written path", async () => {
    const target = join(cwd, "card.svg");
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID, out: target });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    expect(ui).toEqual([
      `phase:${phases.route.ru}`,
      `phase:${phases.fetch.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      `done:${resultOf(wroteFiles(1), [target]).ru}`,
    ]);
  });

  /**
   * CHANGED IN E2b. This used to assert that a bare run's card said "the bytes went to stdout"
   * and that stdout carried the SVG. Both halves are gone: the card names the file, and stdout
   * carries the path.
   */
  it("with no -o the card names the default file, and stdout carries the same path", async () => {
    const { ctx, out, ui } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    const target = faceTarget(ctx, ROOT_GUID, "svg");
    expect(ui.at(-1)).toBe(`done:${resultOf(wroteFiles(1), [target]).ru}`);
    // Same list on both channels — the card a person watches and the bytes a script reads.
    expect(out).toEqual([`${resultOf(wroteFiles(1), [target]).ru}\n`]);
    // …and the path in the card is ABSOLUTE, which is the point of the whole change.
    expect(target.startsWith("/")).toBe(true);
  });

  it("the assets command counts its four writes and ends with all four paths", async () => {
    const target = join(cwd, "assets");
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID, out: target });
    expect(await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    expect(ui).toEqual([
      `phase:${phases.route.ru}`,
      `phase:${phases.fetch.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      "progress:1/4",
      "progress:2/4",
      "progress:3/4",
      "progress:4/4",
      `done:${
        resultOf(wroteFiles(4), [
          join(target, ASSET_FILES.svg),
          join(target, ASSET_FILES.html),
          join(target, ASSET_FILES.prompt),
          join(target, ASSET_FILES.meta),
        ]).ru
      }`,
    ]);
  });

  it("the card's result lines are one absolute path each — never two paths on one line", async () => {
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
    const lines = (ui.at(-1) ?? "").replace(/^done:/u, "").split("\n");
    expect(lines).toHaveLength(5);
    for (const path of lines.slice(1)) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.trim()).toBe(path);
    }
  });

  it("the card is localized, and both languages list the same paths", async () => {
    const paths: string[][] = [];
    for (const lang of ["ru", "en"] as const) {
      const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID, out: join(cwd, lang), lang });
      await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
      const lines = (ui.at(-1) ?? "").replace(/^done:/u, "").split("\n");
      expect(lines[0]).toBe(wroteFiles(4)[lang]);
      paths.push(lines.slice(1).map((p) => p.replace(join(cwd, lang), "")));
    }
    expect(paths[0]).toEqual(paths[1]);
    expect(wroteFiles(4).ru).not.toBe(wroteFiles(4).en);
  });

  it("a dead endpoint fails the FETCH phase — the one that was in flight", async () => {
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", deadClient()).run(ctx)).toBe(1);
    expect(ui.slice(0, 2)).toEqual([`phase:${phases.route.ru}`, `phase:${phases.fetch.ru}`]);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    expect(ui.filter((line) => line.startsWith("done:"))).toEqual([]);
  });

  it("a usage refusal fails before any phase begins, and says so in the language asked for", async () => {
    const { ctx, ui } = makeContext({ cwd, lang: "en" });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(2);
    // `route` opened, and it is the phase the ✗ lands on.
    expect(ui[0]).toBe(`phase:${phases.route.en}`);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    // English, because the recorder resolves every label through `pick` with the ctx's lang.
    expect(ui.at(-1)).not.toMatch(/[А-Яа-яЁё]/u);
  });
});
