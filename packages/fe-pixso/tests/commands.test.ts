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
 * WHAT IS ASSERTED: bytes on stdout, files on disk, exit codes, messages. Never an internal.
 * The face renders are the engine's to guarantee and it pins them byte-for-byte in its own
 * suite; what these tests own is that the RIGHT face's bytes reach the RIGHT destination.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import type { CliCommand } from "@smart-tools/fe-cli-kit";
import { ASSET_FILES, createPixsoCommands } from "../src/index.ts";
import { deadClient, fakeClient } from "./fixtures/fakeClient.ts";
import { CLEAN_DSL, EMPTY_SELECTION_DSL, ROOT_GUID } from "./fixtures/fakeDsl.ts";
import { makeContext } from "./fixtures/context.ts";

function commandFor(flag: string, transport: ReturnType<typeof fakeClient>): CliCommand {
  const found = createPixsoCommands({ client: transport.client }).find((c) => c.flag === flag);
  if (found === undefined) throw new Error(`no command registered for ${flag}`);
  return found;
}

/** A scratch directory, removed by the caller. `pixso-core`'s own suite does exactly this
 *  (`tests/scanHandle.test.ts:155`) rather than reaching for a helper package. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fe-pixso-"));
}

/** The three single-face commands and the shape their bytes must have. */
const FACES = [
  {
    flag: "--get-pixso-svg",
    alias: "--psvg",
    file: ASSET_FILES.svg,
    head: "<svg ",
    tail: "</svg>",
  },
  {
    flag: "--get-pixso-html",
    alias: "--phtml",
    file: ASSET_FILES.html,
    head: "<!doctype html>",
    tail: "</html>",
  },
  {
    flag: "--get-pixso-prompt",
    alias: "--pprompt",
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

  it("`-o` is optional for the three faces and REQUIRED for the asset set", () => {
    const required = new Map(
      createPixsoCommands().map((c) => [c.flag, c.args[1]?.required] as const),
    );
    expect(required.get("--get-pixso-svg")).toBe(false);
    expect(required.get("--get-pixso-html")).toBe(false);
    expect(required.get("--get-pixso-prompt")).toBe(false);
    expect(required.get("--get-pixso-assets")).toBe(true);
  });
});

describe("svg / html / prompt — stdout without `-o`, a file with it", () => {
  for (const face of FACES) {
    it(`${face.flag} writes its face's bytes to stdout when no -o is given`, async () => {
      const transport = fakeClient(CLEAN_DSL);
      const { ctx, out, err } = makeContext({ source: ROOT_GUID });
      expect(await commandFor(face.flag, transport).run(ctx)).toBe(0);
      expect(err).toEqual([]);
      // ONE write, and it is the payload itself — nothing framed around it, because the
      // bytes are meant to survive a shell redirect unchanged.
      expect(out).toHaveLength(1);
      const bytes = out[0] ?? "";
      expect(bytes.startsWith(face.head)).toBe(true);
      if (face.tail !== "") expect(bytes.trimEnd().endsWith(face.tail)).toBe(true);
      expect(transport.calls[0]).toBe("get_node_dsl");
    });

    it(`${face.flag} with -o writes THE SAME bytes to the path and reports it`, async () => {
      const dir = tempDir();
      try {
        const target = join(dir, `out.${face.file.split(".")[1] ?? "txt"}`);

        const piped = makeContext({ source: ROOT_GUID });
        await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(piped.ctx);

        const saved = makeContext({ source: ROOT_GUID, out: target });
        expect(await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(saved.ctx)).toBe(0);

        // The file holds exactly what stdout mode emitted — one payload, two destinations.
        expect(readFileSync(target, "utf8")).toBe(piped.out[0]);
        // …and stdout now carries the REPORT, not the payload.
        expect(saved.out).toHaveLength(1);
        expect(saved.out[0]).toContain(target);
        expect(saved.out[0]).not.toBe(piped.out[0]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("the three faces are three DIFFERENT renders of the one design", async () => {
    const bytes: string[] = [];
    for (const face of FACES) {
      const { ctx, out } = makeContext({ source: ROOT_GUID });
      await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(ctx);
      bytes.push(out[0] ?? "");
    }
    expect(new Set(bytes).size).toBe(3);
  });

  it("the report line is localized — the same run, two languages", async () => {
    const dir = tempDir();
    try {
      const lines: string[] = [];
      for (const lang of ["ru", "en"] as const) {
        const { ctx, out } = makeContext({
          source: ROOT_GUID,
          out: join(dir, `${lang}.svg`),
          lang,
        });
        expect(await commandFor("--get-pixso-svg", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
        lines.push(out[0] ?? "");
      }
      expect(lines[0]).not.toBe(lines[1]);
      expect(lines[0]).toMatch(/[а-яё]/i);
      expect(lines[1]).not.toMatch(/[а-яё]/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("--get-pixso-assets — ONE scan, FOUR files", () => {
  it("writes exactly the four named files into -o, from a single get_node_dsl call", async () => {
    const dir = tempDir();
    try {
      const transport = fakeClient(CLEAN_DSL);
      const { ctx, out, err } = makeContext({ source: ROOT_GUID, out: dir });
      expect(await commandFor("--get-pixso-assets", transport).run(ctx)).toBe(0);
      expect(err).toEqual([]);

      // EXACTLY four, and exactly these — a fifth file is as much a failure as a missing one.
      expect(readdirSync(dir).sort()).toEqual(
        [ASSET_FILES.html, ASSET_FILES.meta, ASSET_FILES.prompt, ASSET_FILES.svg].sort(),
      );
      // ONE scan. Four `fetchScan` calls would show four `get_node_dsl` here.
      expect(transport.calls.filter((tool) => tool === "get_node_dsl")).toHaveLength(1);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("each file holds the face its name promises", async () => {
    const dir = tempDir();
    try {
      const { ctx } = makeContext({ source: ROOT_GUID, out: dir });
      await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);

      const svg = readFileSync(join(dir, ASSET_FILES.svg), "utf8");
      const html = readFileSync(join(dir, ASSET_FILES.html), "utf8");
      const prompt = readFileSync(join(dir, ASSET_FILES.prompt), "utf8");
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(prompt.startsWith("# UI SPEC")).toBe(true);

      // `card.json` is the model, parseable and identifying the design that was scanned.
      const meta: unknown = JSON.parse(readFileSync(join(dir, ASSET_FILES.meta), "utf8"));
      expect(meta).toMatchObject({ name: "Card", dslVersion: "2.1.15" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the four files are byte-identical to what the single-face commands emit", async () => {
    const dir = tempDir();
    try {
      const { ctx } = makeContext({ source: ROOT_GUID, out: dir });
      await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx);
      for (const face of FACES) {
        const piped = makeContext({ source: ROOT_GUID });
        await commandFor(face.flag, fakeClient(CLEAN_DSL)).run(piped.ctx);
        expect(readFileSync(join(dir, face.file), "utf8")).toBe(piped.out[0]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("it creates the -o directory rather than demanding one exists", async () => {
    const root = tempDir();
    try {
      const nested = join(root, "a", "b");
      const { ctx } = makeContext({ source: ROOT_GUID, out: nested });
      expect(await commandFor("--get-pixso-assets", fakeClient(CLEAN_DSL)).run(ctx)).toBe(0);
      expect(readdirSync(nested)).toHaveLength(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("without -o it refuses with exit 2 and names the four files, in both languages", async () => {
    for (const lang of ["ru", "en"] as const) {
      const transport = fakeClient(CLEAN_DSL);
      const { ctx, out, err } = makeContext({ source: ROOT_GUID, lang });
      expect(await commandFor("--get-pixso-assets", transport).run(ctx)).toBe(2);
      expect(out).toEqual([]);
      const message = err[0] ?? "";
      expect(message).toContain("-o");
      for (const name of Object.values(ASSET_FILES)) expect(message).toContain(name);
      expect(message.match(/[а-яё]/i) !== null).toBe(lang === "ru");
      // Refused before the wire was touched.
      expect(transport.calls).toEqual([]);
    }
  });
});

describe("a failure after the line was accepted — exit 1, never 2", () => {
  it("a design the engine refuses is reported, localized, on stderr", async () => {
    for (const lang of ["ru", "en"] as const) {
      const { ctx, out, err } = makeContext({ source: ROOT_GUID, lang });
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
    const { ctx, err } = makeContext({ source: ROOT_GUID });
    expect(await commandFor("--get-pixso-svg", deadClient()).run(ctx)).toBe(1);
    expect(err[0]).toContain("connection refused");
  });

  it("the asset command fails the same way, and writes nothing", async () => {
    const dir = tempDir();
    try {
      const { ctx } = makeContext({ source: ROOT_GUID, out: join(dir, "assets") });
      expect(await commandFor("--get-pixso-assets", deadClient()).run(ctx)).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
