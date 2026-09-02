/**
 * TIER 1 — `fg --parse-ui-kit <name>`: the flow, the refusals, and the file that lands.
 *
 * Two seams are faked and one is not, and the split is the design of this suite.
 *
 * FAKED: `resolveSource` and `extractKit`. The first would clone a repository over the network;
 * the second would run five extractors over a real checkout and shell out to npm. Both are
 * proven for real in `packages/fg-eds-adapter` — `extract.test.ts` against a fixture kit,
 * `parse-ui-kit.integration.test.ts` byte-for-byte against the real one — so re-proving them
 * here would buy nothing and cost every contributor a minute per run.
 *
 * NOT FAKED: `writeCorpus`. It is the step whose correctness this command is responsible for —
 * the five names, the stamp, the `FG_KITS_DIR` override, the absolute paths in the output — and
 * a fake would fake away exactly the thing under test. It writes into a temp directory instead.
 *
 * WHAT EVERY REFUSAL CASE ASSERTS. Not just the exit code: the exit code AND that nothing was
 * cloned, installed or written. A command that refuses correctly but has already spent thirty
 * seconds and left a directory behind has failed at the thing refusals are for.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { argName } from "@smart-tools/fg-cli-kit";
import type { ExtractedKit, ExtractKitOptions, KitCorpus } from "@smart-tools/fg-eds-adapter";
import {
  EMBEDDED_ARTIFACTS,
  EXTRACTOR_VERSION,
  KITS_DIR_ENV,
  NpmError,
} from "@smart-tools/fg-eds-adapter";
import { SourceError } from "@smart-tools/fg-source";
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
  kits = await mkdtemp(join(tmpdir(), "fg-pkit-kits-"));
  checkout = await mkdtemp(join(tmpdir(), "fg-pkit-src-"));
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
    /**
     * What `resolveSource` says it produced. `cloned` by default, which is the network path.
     *
     * A case that names a kit with a `ref` needs `local`: a CLONED checkout is switched to the
     * kit's branch with a real `git checkout`, and there is no branch in a `mkdtemp`.
     */
    readonly sourceKind?: "local" | "cloned";
  } = {},
): ReturnType<typeof createParseUiKitCommands>[number] => {
  const [command] = createParseUiKitCommands({
    resolveSource: async (input) => {
      spy.resolved.push(input);
      if (behaviour.resolveThrows !== undefined) throw behaviour.resolveThrows;
      return {
        dir: checkout,
        kind: behaviour.sourceKind ?? "cloned",
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
  it("offers eds and eds2 and takes each default source from the adapter", () => {
    expect(PARSABLE_KITS.map((kit) => kit.name)).toEqual(["eds", "eds2"]);
    // NOT a URL typed into the test either: the assertion is that the default is a git link to
    // the kit's own repository, which is the property that matters and survives the kit moving.
    for (const kit of PARSABLE_KITS) expect(kit.defaultSource).toMatch(/^https:\/\/.+\.git$/);
  });

  it("sends the two EDS versions to the same repository on different refs", () => {
    // Design E2: EDS 2.x is a BRANCH of the 1.x repository, so the source URL alone does not
    // identify the design system and the ref is the thing that does.
    const [v1, v2] = PARSABLE_KITS;
    expect(v2?.defaultSource).toBe(v1?.defaultSource);
    expect(v1?.ref ?? null).toBeNull();
    expect(v2?.ref).toBe("develop-2.0");
    expect([v1?.extractor, v2?.extractor]).toEqual(["v1", "v2"]);
  });

  it("is registered under a flag and a short alias", () => {
    const command = build(spy());
    expect(command.flag).toBe("--parse-ui-kit");
    expect(command.alias).toBe("--pkit");
    // No `-o`: the corpus goes where the tool looks for it, not where the user says.
    // The positional IS the list of parsable kits — §2.5/§2.7 spell the row `--pkit eds`, and a
    // placeholder standing for a set of one taught users to type `<name>` (V5 finding #14).
    expect(command.args.map((arg) => argName(arg, "en"))).toEqual([
      "eds|eds2",
      "--source <path|repo>",
    ]);
    expect(command.args.map((arg) => argName(arg, "ru"))).toEqual([
      "eds|eds2",
      "--source <путь|repo>",
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
  it("writes the five members into FG_KITS_DIR and lists them as absolute paths", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });

    expect(await build(s).run(cap.ctx)).toBe(0);

    expect((await readdir(join(kits, "eds"))).toSorted()).toEqual([
      "components.json",
      "kit-a11y.json",
      "kit-icons.json",
      "kit-signatures.json",
      "tokens.json",
    ]);

    // U3: the headline is the block's, on the UI's stream; stdout is the paths, one per line,
    // absolute — the shape a shell user can pipe.
    expect(cap.ui.at(-1)).toContain("the corpus is built, 5 files");
    const out = text(cap.out);
    expect(out).not.toContain("corpus is built");
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

  /**
   * V6 AUDIT FINDING #5 — A KIT THAT WRAPS NOTHING SKIPS THE PHASE, NOT JUST ITS ARGUMENT.
   *
   * `eds2` was already given no `upstreamPrefix`, but the temp directory was still created and
   * the row «установка @v-uik» was still printed and timed. A phase row is a claim that the run
   * did something, and this one named a library EDS 2.x has no relationship with — while
   * `README:614` already told the reader the step is skipped.
   */
  it("skips the upstream phase entirely for a kit that wraps nothing", async () => {
    const s = spy();
    const cap = capture({ cwd: checkout, source: "eds2", sourceFlag: checkout, lang: "en", env });
    await build(s, { sourceKind: "local" }).run(cap.ctx);

    expect(cap.ui).not.toContain("phase:installing @v-uik");
    // Not merely unannounced: no temp tree was made for it either.
    expect(s.extracted[0]?.upstreamPrefix).toBeUndefined();
    // The rest of the ledger is untouched — the run still says what it did.
    expect(cap.ui).toContain("phase:fetching the sources");
    expect(cap.ui).toContain("phase:writing the corpus");
  });

  it("keeps the upstream phase for the kit that HAS an upstream", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);
    expect(cap.ui).toContain("phase:installing @v-uik");
  });

  it("announces every stage, so a two-minute run is legible", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);

    // Lowercase, like every other phase label in the redesign (design §2.2): the ledger reads
    // as a list of what the run is doing, not as a set of headings.
    expect(cap.ui).toContain("phase:fetching the sources");
    expect(cap.ui).toContain("phase:installing @v-uik");
    expect(cap.ui).toContain("phase:writing the corpus");
    expect(cap.ui.some((line) => line.startsWith("summary:"))).toBe(true);
    // …and the header (§2.5) names the kit and where its sources came from.
    // The default source is the ADAPTER's repository, because this case names no `--source`.
    expect(cap.ui[0]).toBe("header:pkit · eds · https://gitverse.ru/sbertech/ui-kit-eds-ce.git");
  });

  /**
   * `--parse-ui-kit` takes no `-o` — the corpus goes where the tool reads it from — but the
   * other half of the owner's law applies to it exactly as to everything else: the run ends
   * with a block that names the absolute path of every file written, one ROW each, keyed by the
   * corpus member (design 2.5). Never wrapped, never truncated (U6).
   */
  it("the summary block lists all five JSONs as absolute paths, one row each", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);

    const block = cap.ui.at(-1) ?? "";
    expect(block.startsWith("summary:the corpus is built, 5 files [")).toBe(true);
    for (const member of ["components", "kit-a11y", "kit-icons", "kit-signatures", "tokens"]) {
      expect(block).toContain(`${member}=${join(kits, "eds", `${member}.json`)}`);
    }
  });

  it("the block and stdout carry the SAME list — one contract, two channels", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "en", env });
    await build(spy()).run(cap.ctx);
    const block = cap.ui.at(-1) ?? "";
    // Stdout is the paths and nothing else (U3); the block is the same paths, with their keys.
    expect(cap.out).toHaveLength(5);
    for (const line of cap.out) expect(block).toContain(line.trimEnd());
  });

  it("cleans up the clone", async () => {
    const s = spy();
    await build(s).run(capture({ cwd: checkout, source: "eds", env }).ctx);
    expect(s.cleanups).toBe(1);
  });

  it("says the same things in Russian", async () => {
    const cap = capture({ cwd: checkout, source: "eds", lang: "ru", env });
    await build(spy()).run(cap.ctx);
    expect(cap.ui.at(-1)).toContain("корпус собран, файлов: 5");
  });
});
