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
 *  - the run's final word is the SUMMARY BLOCK (design 2.3/2.5): one row per written file, keyed
 *    by face, on the UI's stream — while stdout carries the bare absolute paths, one per line,
 *    and only when it is not a terminal (U3, `emitPaths`).
 *
 * Every case below runs with `cwd` pointed at a fresh scratch directory, because every case now
 * writes something (`tests/fixtures/scratch.ts`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { CliCommand } from "@smart-tools/fg-cli-kit";
import {
  ASSET_FILES,
  assetsTarget,
  createPixsoCommands,
  faceTarget,
  fileUnit,
  phases,
  PIXSO_LINK,
  ready,
  routeLabels,
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

const ruFileUnit = (count: number): string => fileUnit(count).ru;

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
      expect(command.details?.ru).not.toBe(command.details?.en);
      expect(command.defaultOut?.ru.length ?? 0).toBeGreaterThan(0);
      expect(command.group.id).toBe("pixso");
      expect(command.args.length).toBeGreaterThan(0);
      for (const arg of command.args) {
        expect(arg.description.ru.length).toBeGreaterThan(0);
        expect(arg.description.en.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * THE OWNER'S REMOTE-FIRST LAW, pinned in the one place it can silently regress.
   *
   * The remote route — a design link plus a token — is the MAIN story of all four commands, and
   * the local route (a bare guid, the editor's own MCP) is the advanced case. The help page is
   * where that decision is visible to a user, so it is asserted here rather than trusted:
   *
   *  1. the FIRST example of every command is the link, spelled `<pixso-link>`;
   *  2. the guid example still exists — the local route is real — and is never first;
   *  3. NOTHING the help prints for these commands carries a URL. A literal
   *     `https://pixso.net/app/editor/…?item-id=4711` is a string a reader tries to copy: it is
   *     not their file, the ellipsis is not typeable, and the item-id is someone else's frame;
   *  4. the source argument's description names the REMOTE route before the local one, in both
   *     languages — the ordering is the message.
   */
  it("leads with the link example in both languages, and prints no URL anywhere", () => {
    for (const command of createPixsoCommands()) {
      const examples = command.examples ?? [];
      expect(examples[0]).toBe(`fg ${command.alias} ${PIXSO_LINK}`);
      expect(examples.filter((example) => example.includes("11:10"))).toHaveLength(1);
      expect(examples.findIndex((example) => example.includes("11:10"))).toBeGreaterThan(0);

      const printed = [
        ...examples,
        command.summary.ru,
        command.summary.en,
        command.details?.ru ?? "",
        command.details?.en ?? "",
        ...command.args.flatMap((arg) => [arg.description.ru, arg.description.en]),
      ];
      for (const text of printed) expect(text).not.toMatch(/https?:/u);

      const source = command.args[0]?.description;
      for (const text of [source?.ru ?? "", source?.en ?? ""]) {
        expect(text.startsWith(PIXSO_LINK)).toBe(true);
      }
      expect(source?.ru).toContain("удалённый");
      expect(source?.ru).toContain("локальный");
      expect(source?.en).toContain("remote");
      expect(source?.en).toContain("local");
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
    it(`${face.flag} with no -o writes to ./fg-out/pixso/<name> and reports the absolute path`, async () => {
      const transport = fakeClient(CLEAN_DSL);
      const { ctx, out, err } = makeContext({ cwd, source: ROOT_GUID });
      expect(await commandFor(face.flag, transport).run(ctx)).toBe(0);
      expect(err).toEqual([]);

      // The path is not spelled here — it is asked of the builder the product uses, so this
      // test cannot pass while the product writes somewhere else.
      const expected = faceTarget(ctx, ROOT_GUID, face.kind);
      expect(expected).toBe(join(cwd, "fg-out", "pixso", `11-10${face.file.slice(4)}`));
      const bytes = readFileSync(expected, "utf8");
      expect(bytes.startsWith(face.head)).toBe(true);
      if (face.tail !== "") expect(bytes.trimEnd().endsWith(face.tail)).toBe(true);

      // stdout is DATA, not prose: the absolute path, alone on its line (U3).
      expect(out).toEqual([`${expected}\n`]);
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
      expect(saved.out).toEqual([`${target}\n`]);
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
    expect(readdirSync(join(cwd, "fg-out", "pixso")).toSorted()).toEqual([
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
    expect(readdirSync(join(cwd, "fg-out", "pixso"))).toEqual(["11-10.svg"]);
  });

  /**
   * U3 SPLIT THE TWO CHANNELS, so the localization moved with the prose. Stdout is now the PATH
   * and nothing else — identical in both languages, because a path is not a sentence — and the
   * headline that IS a sentence lives in the summary block on the UI's stream.
   */
  it("the prose is localized and the data is not", async () => {
    const headlines: string[] = [];
    const paths: string[] = [];
    for (const lang of ["ru", "en"] as const) {
      const { ctx, out, ui } = makeContext({
        cwd,
        source: ROOT_GUID,
        out: join(cwd, `${lang}.svg`),
        lang,
      });
      expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
      headlines.push(ui.at(-1) ?? "");
      paths.push((out[0] ?? "").replace(join(cwd, `${lang}.svg`), ""));
    }
    expect(headlines[0]).not.toBe(headlines[1]);
    expect(headlines[0]).toMatch(/[а-яё]/i);
    expect(headlines[1]).not.toMatch(/[а-яё]/i);
    expect(paths[0]).toBe(paths[1]);
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
    expect(readdirSync(dir).toSorted()).toEqual(
      [ASSET_FILES.html, ASSET_FILES.meta, ASSET_FILES.prompt, ASSET_FILES.svg].toSorted(),
    );
    // ONE scan. Four `fetchScan` calls would show four `get_node_dsl` here.
    expect(transport.calls.filter((tool) => tool === "get_node_dsl")).toHaveLength(1);

    // Stdout's shape: FOUR absolute paths, one per line, in write order, and nothing else.
    expect(out).toEqual([
      `${join(dir, ASSET_FILES.svg)}\n`,
      `${join(dir, ASSET_FILES.html)}\n`,
      `${join(dir, ASSET_FILES.prompt)}\n`,
      `${join(dir, ASSET_FILES.meta)}\n`,
    ]);
  });

  /**
   * CHANGED IN E2b. This case used to assert `exit 2` and a message naming the four files
   * ("without -o it refuses…"). The refusal is gone with the owner's law; what replaces it is
   * the same run succeeding into the documented default directory.
   */
  it("with no -o it writes into ./fg-out/pixso/<name>/ rather than refusing", async () => {
    const transport = fakeClient(CLEAN_DSL);
    const { ctx, out } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-assets", transport).run(ctx)).toBe(0);

    const dir = assetsTarget(ctx, ROOT_GUID);
    expect(dir).toBe(join(cwd, "fg-out", "pixso", "11-10"));
    expect(readdirSync(dir).toSorted()).toEqual(
      [ASSET_FILES.html, ASSET_FILES.meta, ASSET_FILES.prompt, ASSET_FILES.svg].toSorted(),
    );
    for (const file of Object.values(ASSET_FILES)) {
      expect(out).toContain(`${join(dir, file)}\n`);
    }
  });

  it("the default directory does not collide with the default face file of the same design", async () => {
    const svg = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(svg.ctx);
    const set = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(set.ctx);

    expect(readdirSync(join(cwd, "fg-out", "pixso")).toSorted()).toEqual(["11-10", "11-10.svg"]);
    expect(readdirSync(join(cwd, "fg-out", "pixso", "11-10"))).toHaveLength(4);
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
  /**
   * ONE VOICE (U3). The failure used to be written to `ctx.stderr` AND handed to the UI, which
   * printed it twice. `ctx.stderr` is now untouched by this package: the UI's block IS the
   * message, so the assertion moved to the recorder and `err` staying empty is part of it.
   */
  it("a design the engine refuses is reported, localized, ONCE, through the UI", async () => {
    for (const lang of ["ru", "en"] as const) {
      const { ctx, out, err, ui } = makeContext({ cwd, source: ROOT_GUID, lang });
      expect(await commandFor("--get-pixso-svg", fakeClient(EMPTY_SELECTION_DSL)).run(ctx)).toBe(1);
      expect(out).toEqual([]);
      expect(err).toEqual([]);
      const failures = ui.filter((line) => line.startsWith("fail:"));
      expect(failures).toHaveLength(1);
      // Our wrapper is localized even though the engine's own detail rides along in English.
      expect(failures[0]).toContain(
        lang === "ru" ? "не удалось выполнить команду" : "the command failed",
      );
    }
  });

  it("a dead endpoint is reported, not thrown out of `run`", async () => {
    const { ctx, err, ui } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", deadClient()).run(ctx)).toBe(1);
    expect(err).toEqual([]);
    expect(ui.at(-1)).toContain("connection refused");
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
    // THE HEADER IS FIRST (design §2.1; V5 finding #3): routing is a pure read of the string the
    // user typed, so it no longer opens a phase ahead of it. `end` seals the `запись` phase
    // before the path reaches stdout (finding #2).
    expect(ui).toEqual([
      `header:psvg · ${routeLabels.local.ru} · ${ROOT_GUID}`,
      `phase:${phases.fetch.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      "end",
      `summary:${ready.ru} [svg=${target}]`,
    ]);
  });

  /**
   * CHANGED IN E2b. This used to assert that a bare run's card said "the bytes went to stdout"
   * and that stdout carried the SVG. Both halves are gone: the card names the file, and stdout
   * carries the path.
   */
  it("with no -o the block names the default file, and stdout carries the same path", async () => {
    const { ctx, out, ui } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    const target = faceTarget(ctx, ROOT_GUID, "svg");
    expect(ui.at(-1)).toBe(`summary:${ready.ru} [svg=${target}]`);
    // Same path on both channels — the block a person watches and the bytes a script reads.
    expect(out).toEqual([`${target}\n`]);
    // …and the path is ABSOLUTE, which is the point of the whole change.
    expect(target.startsWith("/")).toBe(true);
  });

  /** U3's other half: a TERMINAL gets the paths ONCE, in the block, and nothing on stdout. */
  it("when stdout is a terminal the paths are in the block only — stdout stays empty", async () => {
    const { ctx, out, ui } = makeContext({ cwd, source: ROOT_GUID, stdoutIsTTY: true });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    expect(out).toEqual([]);
    expect(ui.at(-1)).toContain(faceTarget(ctx, ROOT_GUID, "svg"));
  });

  it("the assets command counts its four writes and ends with all four paths", async () => {
    const target = join(cwd, "assets");
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID, out: target });
    expect(await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
    expect(ui).toEqual([
      `header:passets · ${routeLabels.local.ru} · ${ROOT_GUID}`,
      `phase:${phases.fetch.ru}`,
      `phase:${phases.render.ru}`,
      `phase:${phases.write.ru}`,
      // The unit AGREES WITH THE TOTAL, and four is «файла» (V5 finding #20): the fixed genitive
      // singular this used to print made a nine-file run read `9/9 файла`.
      "progress:1/4 файла",
      "progress:2/4 файла",
      "progress:3/4 файла",
      "progress:4/4 файла",
      "end",
      `summary:${ready.ru} [svg=${join(target, ASSET_FILES.svg)} ` +
        `html=${join(target, ASSET_FILES.html)} ` +
        `md=${join(target, ASSET_FILES.prompt)} ` +
        `json=${join(target, ASSET_FILES.meta)}]`,
    ]);
  });

  /**
   * V5 FINDING #20 — the progress unit AGREES WITH THE COUNT.
   *
   * `FILE_UNIT` was a fixed genitive singular, so every run said «файла» whatever the number:
   * a nine-file `--passets` read `9/9 файла`. The assets command always writes four, and four is
   * «файла» too — which is exactly why the rule itself is asserted here rather than only the one
   * count this package happens to produce.
   */
  it("pluralises the progress unit in Russian, over the whole CLDR table", () => {
    expect(ruFileUnit(1)).toBe("файл");
    expect(ruFileUnit(2)).toBe("файла");
    expect(ruFileUnit(4)).toBe("файла");
    expect(ruFileUnit(5)).toBe("файлов");
    expect(ruFileUnit(9)).toBe("файлов");
    expect(ruFileUnit(11)).toBe("файлов");
    expect(ruFileUnit(21)).toBe("файл");
    expect(ruFileUnit(22)).toBe("файла");
    expect(ruFileUnit(112)).toBe("файлов");
    expect(fileUnit(1).en).toBe("file");
    expect(fileUnit(9).en).toBe("files");
  });

  /** U6, at this package's end of it: four rows, four absolute paths, never two on one line. */
  it("the block's result rows are one absolute path each, keyed by face", async () => {
    const { ctx, out, ui } = makeContext({ cwd, source: ROOT_GUID });
    await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
    const keys = (ui.at(-1) ?? "").match(/(svg|html|md|json)=/gu);
    expect(keys).toEqual(["svg=", "html=", "md=", "json="]);
    expect(out).toHaveLength(4);
    for (const line of out) {
      expect(line.startsWith("/")).toBe(true);
      expect(line.split("\n").filter((part) => part !== "")).toHaveLength(1);
    }
  });

  it("the block is localized, and both languages list the same paths", async () => {
    const rendered: string[] = [];
    for (const lang of ["ru", "en"] as const) {
      const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID, out: join(cwd, lang), lang });
      await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
      rendered.push((ui.at(-1) ?? "").replaceAll(join(cwd, lang), ""));
    }
    // The headline differs; everything after it — the keys and the paths — does not.
    expect(rendered[0]).not.toBe(rendered[1]);
    expect(rendered[0]?.slice(rendered[0].indexOf("["))).toBe(
      rendered[1]?.slice(rendered[1].indexOf("[")),
    );
    expect(ready.ru).not.toBe(ready.en);
  });

  it("a dead endpoint fails the FETCH phase — the one that was in flight", async () => {
    const { ctx, ui } = makeContext({ cwd, source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", deadClient()).run(ctx)).toBe(1);
    // §2.6: the header IS printed before a runtime failure — the command had started.
    expect(ui.slice(0, 2)).toEqual([
      `header:psvg · ${routeLabels.local.ru} · ${ROOT_GUID}`,
      `phase:${phases.fetch.ru}`,
    ]);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    expect(ui.filter((line) => line.startsWith("summary:"))).toEqual([]);
  });

  it("a usage refusal fails before any phase begins, and says so in the language asked for", async () => {
    const { ctx, ui } = makeContext({ cwd, lang: "en" });
    expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(2);
    // NOTHING was printed before the refusal — no header, and no phase either: the run never
    // started (design §2.6), and routing is not a phase any more (V5 finding #3).
    expect(ui).toHaveLength(1);
    expect(ui.filter((line) => line.startsWith("header:"))).toEqual([]);
    expect(ui.at(-1)?.startsWith("fail:")).toBe(true);
    // …and the refusal carries the two pointer lines the design fixes.
    expect(ui.at(-1)).toContain("[fg --psvg <pixso-link|guid> [-o <path>]|fg --help --psvg]");
    // English, because the recorder resolves every label through `pick` with the ctx's lang.
    expect(ui.at(-1)).not.toMatch(/[А-Яа-яЁё]/u);
  });
});
