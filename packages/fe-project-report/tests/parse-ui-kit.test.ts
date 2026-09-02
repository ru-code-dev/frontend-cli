/**
 * TIER 1 — `fe --parse-ui-kit <name>`: the flow, the refusals, and the file that lands.
 *
 * Two seams are faked and one is not, and the split is the design of this suite.
 *
 * FAKED: `resolveSource` and `extractKit`. The first would clone a repository over the network;
 * the second would run five extractors over a real checkout and shell out to npm. Both are
 * proven for real in `packages/fe-eds-adapter` — `extract.test.ts` against a fixture kit,
 * `parse-ui-kit.integration.test.ts` byte-for-byte against the real one — so re-proving them
 * here would buy nothing and cost every contributor a minute per run.
 *
 * NOT FAKED: `writeCorpus`. It is the step whose correctness this command is responsible for —
 * the five names, the stamp, the `FE_KITS_DIR` override, the absolute paths in the output — and
 * a fake would fake away exactly the thing under test. It writes into a temp directory instead.
 *
 * WHAT EVERY REFUSAL CASE ASSERTS. Not just the exit code: the exit code AND that nothing was
 * cloned, installed or written. A command that refuses correctly but has already spent thirty
 * seconds and left a directory behind has failed at the thing refusals are for.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtractedKit, ExtractKitOptions, KitCorpus } from "@smart-tools/fe-eds-adapter";
import {
  EMBEDDED_ARTIFACTS,
  EXTRACTOR_VERSION,
  KITS_DIR_ENV,
  NpmError,
} from "@smart-tools/fe-eds-adapter";
import { SourceError } from "@smart-tools/fe-source";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createParseUiKitCommands, PARSABLE_KITS } from "../src/parse-ui-kit.ts";
import { capture, text } from "./harness.ts";

const CORPUS = EMBEDDED_ARTIFACTS as unknown as KitCorpus;

const EXTRACTED: ExtractedKit = {
  corpus: CORPUS,
  version: "1.13.0",
  commit: "ddc3b6c2823d09ab86f004204a9451f4eb416d15",
  upstreamAvailable: true,
};

let kits: string;
let checkout: string;
let env: Record<string, string | undefined>;

beforeEach(async () => {
  kits = await mkdtemp(join(tmpdir(), "fe-pkit-kits-"));
  checkout = await mkdtemp(join(tmpdir(), "fe-pkit-src-"));
  env = { [KITS_DIR_ENV]: kits };
});

afterEach(async () => {
  await rm(kits, { recursive: true, force: true });
  await rm(checkout, { recursive: true, force: true });
});

/** What the fakes recorded, so a test can assert on what the command asked for. */
interface Spy {
  readonly resolved: string[];
  readonly extracted: ExtractKitOptions[];
  cleanups: number;
}

const build = (
  spy: Spy,
  behaviour: {
    readonly resolveThrows?: unknown;
    readonly extractThrows?: unknown;
  } = {},
): ReturnType<typeof createParseUiKitCommands>[number] => {
  const [command] = createParseUiKitCommands({
    resolveSource: async (input) => {
      spy.resolved.push(input);
      if (behaviour.resolveThrows !== undefined) throw behaviour.resolveThrows;
      return {
        dir: checkout,
        kind: "cloned",
        cleanup: async () => {
          spy.cleanups += 1;
        },
      };
    },
    extractKit: async (options) => {
      spy.extracted.push(options);
      if (behaviour.extractThrows !== undefined) throw behaviour.extractThrows;
      return EXTRACTED;
    },
  });
  // `createParseUiKitCommands` always returns exactly one command; the guard is for
  // `noUncheckedIndexedAccess` rather than for a case that can happen.
  if (command === undefined) throw new Error("no command");
  return command;
};

const spy = (): Spy => ({ resolved: [], extracted: [], cleanups: 0 });

describe("the registry", () => {
  it("offers eds and takes its default source from the adapter", () => {
    expect(PARSABLE_KITS.map((kit) => kit.name)).toEqual(["eds"]);
    // NOT a URL typed into the test either: the assertion is that the default is a git link to
    // the kit's own repository, which is the property that matters and survives the kit moving.
    expect(PARSABLE_KITS[0]?.defaultSource).toMatch(/^https:\/\/.+\.git$/);
  });

  it("is registered under a flag and a short alias", () => {
    const command = build(spy());
    expect(command.flag).toBe("--parse-ui-kit");
    expect(command.alias).toBe("--pkit");
    // No `-o`: the corpus goes where the tool looks for it, not where the user says.
    expect(command.args.map((arg) => arg.name)).toEqual([
      "<name>",
      "--source <git-url|local-path>",
    ]);
  });

  it("documents both arguments in both languages", () => {
    for (const arg of build(spy()).args) {
      expect(arg.description.ru.length).toBeGreaterThan(10);
      expect(arg.description.en.length).toBeGreaterThan(10);
      expect(arg.description.ru).not.toBe(arg.description.en);
    }
  });
});

describe("refusals, before anything is fetched", () => {
  it("no kit named → exit 2, and the message teaches the accepted values", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, env });

    expect(await build(s).run(cap.ctx)).toBe(2);
    expect(text(cap.err)).toContain("eds");
    expect(s.resolved).toEqual([]);
  });

  it("an unknown kit → exit 2, named, with the list", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "bootstrap", lang: "en", env });

    expect(await build(s).run(cap.ctx)).toBe(2);
    expect(text(cap.err)).toContain("bootstrap");
    expect(text(cap.err)).toContain("eds");
    // The point of refusing early: a misspelled name costs no clone and no npm install.
    expect(s.resolved).toEqual([]);
    expect(s.extracted).toEqual([]);
  });

  it("refuses in the language in play", async () => {
    const cap = capture({ cwd: checkout, source: "bootstrap", lang: "ru", env });
    await build(spy()).run(cap.ctx);
    expect(text(cap.err)).toContain("неизвестная дизайн-система");
  });
});

describe("the source", () => {
  it("defaults to the adapter's own repository", async () => {
    const s = spy();
    await build(s).run(capture({ cwd: checkout, source: "eds", env }).ctx);
    expect(s.resolved).toEqual([PARSABLE_KITS[0]?.defaultSource]);
  });

  it("uses --source when given", async () => {
    const s = spy();
    await build(s).run(
      capture({ cwd: checkout, source: "eds", sourceFlag: "/tmp/my-kit", env }).ctx,
    );
    expect(s.resolved).toEqual(["/tmp/my-kit"]);
  });

  it("treats an empty --source as absent rather than as the empty path", async () => {
    const s = spy();
    await build(s).run(capture({ cwd: checkout, source: "eds", sourceFlag: "", env }).ctx);
    expect(s.resolved).toEqual([PARSABLE_KITS[0]?.defaultSource]);
  });

  it("maps a clone failure onto its localized sentence, with git's own words", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    const command = build(s, {
      resolveThrows: new SourceError({
        code: "clone-failed",
        input: "https://example.invalid/kit.git",
        gitStderr: "fatal: repository not found",
      }),
    });

    expect(await command.run(cap.ctx)).toBe(1);
    expect(text(cap.err)).toContain("could not clone");
    expect(text(cap.err)).toContain("fatal: repository not found");
    expect(await readdir(kits)).toEqual([]);
  });

  it("maps a missing git onto its own sentence, not the generic one", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    const command = build(spy(), {
      resolveThrows: new SourceError({ code: "git-not-installed", input: "x" }),
    });

    expect(await command.run(cap.ctx)).toBe(1);
    expect(text(cap.err)).toContain("needs git");
  });
});

describe("a missing or refusing npm", () => {
  it("stops the command and explains why nothing was written", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    const command = build(s, {
      extractThrows: new NpmError("npm-not-installed", "npm not found"),
    });

    expect(await command.run(cap.ctx)).toBe(1);
    expect(text(cap.err)).toContain("npm");
    // The message must say WHY the command stopped instead of degrading, because a corpus
    // without upstream evidence would silently replace an embedded snapshot that has it.
    expect(text(cap.err)).toContain("embedded");
    // Nothing half-written.
    expect(await readdir(kits)).toEqual([]);
    // And the clone is still cleaned up on the failure path.
    expect(s.cleanups).toBe(1);
  });

  it("quotes npm's own words when the registry refused", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    const command = build(spy(), {
      extractThrows: new NpmError("install-failed", "no", "E404 Not Found"),
    });

    expect(await command.run(cap.ctx)).toBe(1);
    expect(text(cap.err)).toContain("E404 Not Found");
  });

  it("reports an ordinary extractor failure through the generic sentence", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    const command = build(spy(), { extractThrows: new Error("the theme is not self-contained") });

    expect(await command.run(cap.ctx)).toBe(1);
    expect(text(cap.err)).toContain("the theme is not self-contained");
  });
});

describe("a successful run", () => {
  it("writes the five members into FE_KITS_DIR and lists them as absolute paths", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });

    expect(await build(s).run(cap.ctx)).toBe(0);

    expect((await readdir(join(kits, "eds"))).sort()).toEqual([
      "components.json",
      "kit-a11y.json",
      "kit-icons.json",
      "kit-signatures.json",
      "tokens.json",
    ]);

    const out = text(cap.out);
    expect(out).toContain("the eds 1.13.0 corpus is built, 5 files");
    // Absolute, one per line — the shape a shell user can pipe.
    for (const member of ["tokens", "components", "kit-a11y", "kit-icons", "kit-signatures"]) {
      expect(out).toContain(`${join(kits, "eds", `${member}.json`)}\n`);
    }
  });

  it("stamps every file with where it came from", async () => {
    const cap = capture({ cwd: checkout, source: "eds", sourceFlag: "/tmp/my-kit", env });
    await build(spy()).run(cap.ctx);

    const parsed = JSON.parse(await readFile(join(kits, "eds", "tokens.json"), "utf8")) as {
      meta: { corpus: Record<string, unknown> };
    };
    expect(parsed.meta.corpus).toMatchObject({
      kit: "eds",
      version: "1.13.0",
      commit: "ddc3b6c2823d09ab86f004204a9451f4eb416d15",
      extractor: EXTRACTOR_VERSION,
      // What the USER asked for, verbatim — so a corpus can say which checkout produced it even
      // when that was a local directory.
      source: "/tmp/my-kit",
    });
    expect(parsed.meta.corpus["extractedAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("installs the upstream into a temp prefix, never into the checkout", async () => {
    const s = spy();
    await build(s).run(capture({ cwd: checkout, source: "eds", env }).ctx);

    const options = s.extracted[0];
    expect(options?.uiKitRoot).toBe(checkout);
    expect(options?.upstreamPrefix).toBeDefined();
    // `--source .` is a legal invocation, and a command that regenerates a corpus must not leave
    // a `node_modules` inside the user's own working copy.
    expect(options?.upstreamPrefix?.startsWith(checkout)).toBe(false);
    // And the prefix is gone by the time the command returns.
    await expect(readdir(options?.upstreamPrefix ?? "")).rejects.toThrow();
  });

  it("announces every stage, so a two-minute run is legible", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);

    expect(cap.ui).toContain("phase:Fetching the sources");
    expect(cap.ui).toContain("phase:Installing @v-uik");
    expect(cap.ui).toContain("phase:Writing the corpus");
    expect(cap.ui.some((line) => line.startsWith("done:"))).toBe(true);
  });

  /**
   * ADDED IN E2b. `--parse-ui-kit` takes no `-o` — the corpus goes where the tool reads it from
   * — but the other half of the owner's law applies to it exactly as to everything else: the run
   * ends with a card whose result lines are the absolute paths of every file written. It used to
   * print those paths on stdout only, and hand the card a bare count.
   */
  it("the CARD lists all five JSONs as absolute paths, one per line", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);

    const lines = (cap.ui.at(-1) ?? "").replace(/^done:/u, "").split("\n");
    expect(lines[0]).toBe("the eds 1.13.0 corpus is built, 5 files");
    expect(lines.slice(1).sort()).toEqual(
      ["components", "kit-a11y", "kit-icons", "kit-signatures", "tokens"]
        .map((member) => join(kits, "eds", `${member}.json`))
        .sort(),
    );
    for (const path of lines.slice(1)) expect(path.startsWith("/")).toBe(true);
  });

  it("the card and stdout carry the SAME list — one contract, two channels", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);
    expect(text(cap.out)).toBe(`${(cap.ui.at(-1) ?? "").replace(/^done:/u, "")}\n`);
  });

  it("cleans up the clone", async () => {
    const s = spy();
    await build(s).run(capture({ cwd: checkout, source: "eds", env }).ctx);
    expect(s.cleanups).toBe(1);
  });

  it("says the same things in Russian", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "ru", env });
    await build(spy()).run(cap.ctx);
    expect(text(cap.out)).toContain("корпус eds 1.13.0 собран, файлов: 5");
  });
});
