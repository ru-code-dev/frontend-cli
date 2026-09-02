/**
 * TIER 1 — the corpus contract: where it lives, what it looks like, and the four states.
 *
 * The claim `corpus.ts`'s header makes is strong enough to need pinning rather than asserting:
 * **there is no throwing path**. A user's `~/.fe/kits/eds/` can be truncated, hand-edited,
 * half-written by an interrupted run, or written by a version of this tool that no longer
 * exists, and the worst any of that may cost is a warning and the embedded snapshot. So the
 * matrix below is not four happy cases plus an error case — it is four cases, of which three are
 * damage, and none of them may reject.
 *
 * Every test writes into a temp `FE_KITS_DIR`. `writeCorpus` is exercised for real rather than
 * faked, because the round trip — write, read back, strip the stamp, compare — is the one
 * assertion that keeps the acceptance test honest: it proves the bytes an extractor produced
 * survive a trip through the corpus unchanged, so "the extractor output is byte-identical" and
 * "the corpus is byte-identical" are the same claim.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  corpusDir,
  corpusFile,
  KITS_DIR_ENV,
  kitsRoot,
  loadCorpus,
  writeCorpus,
} from "../src/corpus.ts";
import { CORPUS_MEMBERS, type KitCorpus } from "../src/extract/pipeline.ts";
import { EXTRACTOR_VERSION, type CorpusStamp } from "../src/extract/provenance.ts";
import { EMBEDDED_ARTIFACTS, EMBEDDED_VERSION } from "../src/index.ts";

/**
 * The embedded five, used as a stand-in for a freshly extracted corpus.
 *
 * They are real artifacts of the real kit, which is the point: a fixture small enough to hand-
 * write would not exercise the schemas at the size they actually run at, and these are already
 * in memory.
 */
const CORPUS = EMBEDDED_ARTIFACTS as unknown as KitCorpus;

const STAMP: CorpusStamp = {
  kit: "eds",
  version: "1.13.0",
  commit: "ddc3b6c2823d09ab86f004204a9451f4eb416d15",
  extractedAt: "2026-07-28T20:09:36Z",
  extractor: EXTRACTOR_VERSION,
  source: "https://gitverse.ru/sbertech/ui-kit-eds-ce.git",
};

let root: string;
let env: Record<string, string | undefined>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fe-corpus-test-"));
  env = { [KITS_DIR_ENV]: root };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = async (): Promise<readonly string[]> =>
  await writeCorpus({ kit: "eds", corpus: CORPUS, stamp: STAMP, env });

describe("where a corpus lives", () => {
  it("defaults to ~/.fe/kits and is moved wholesale by FE_KITS_DIR", () => {
    expect(kitsRoot({})).toMatch(/[/\\]\.fe[/\\]kits$/);
    expect(kitsRoot(env)).toBe(root);
    expect(corpusDir("eds", env)).toBe(join(root, "eds"));
    expect(corpusFile("eds", "tokens", env)).toBe(join(root, "eds", "tokens.json"));
  });

  it("treats an empty override as absent rather than as the empty path", () => {
    // A shell that exports `FE_KITS_DIR=` sets it to `""`. Honouring that literally would put
    // the corpus at the filesystem root; the only sane reading is "not set".
    expect(kitsRoot({ [KITS_DIR_ENV]: "" })).toBe(kitsRoot({}));
  });
});

describe("writing", () => {
  it("writes exactly the five members, as absolute paths, in the documented order", async () => {
    const written = await write();
    expect(written).toEqual(CORPUS_MEMBERS.map((member) => join(root, "eds", `${member}.json`)));
  });

  it("leaves no temporary files behind", async () => {
    await write();
    // Each member is written to `<name>.json.tmp` and renamed, so a `.tmp` surviving means a
    // rename did not happen and a reader could see a partial document.
    for (const member of CORPUS_MEMBERS) {
      await expect(readFile(join(root, "eds", `${member}.json.tmp`), "utf8")).rejects.toThrow();
    }
  });

  it("stamps every member without disturbing the artifact's own meta", async () => {
    await write();
    const text = await readFile(join(root, "eds", "kit-a11y.json"), "utf8");
    const parsed = JSON.parse(text) as { meta: Record<string, unknown> };

    expect(parsed.meta["corpus"]).toEqual(STAMP);
    // The hackathon's own fields are still there, unchanged — "keep the existing meta intact".
    expect(parsed.meta["upstreamVersion"]).toBe("1.23.0");
    expect(parsed.meta["packagesScanned"]).toBe(63);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("round-trips: stripping the stamp returns the artifact byte for byte", async () => {
    await write();
    for (const member of CORPUS_MEMBERS) {
      const parsed = JSON.parse(await readFile(join(root, "eds", `${member}.json`), "utf8")) as {
        meta: Record<string, unknown>;
      };
      const { corpus: _stamp, ...meta } = parsed.meta;
      expect(JSON.stringify({ ...parsed, meta })).toBe(JSON.stringify(CORPUS[member]));
    }
  });
});

describe("the precedence matrix", () => {
  it("NOTHING THERE → the embedded snapshot, silently", async () => {
    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    // Silence is the assertion. A user who never ran `--parse-ui-kit` must not be told about it.
    expect(loaded.warnings).toEqual([]);
  });

  it("ALL FIVE, VALID → the on-disk corpus, with its provenance", async () => {
    await write();
    const loaded = await loadCorpus({ kit: "eds", env });

    expect(loaded.warnings).toEqual([]);
    expect(loaded.provenance).toEqual({
      kind: "updated",
      version: "1.13.0",
      commit: "ddc3b6c2823d09ab86f004204a9451f4eb416d15",
      extractedAt: "2026-07-28T20:09:36Z",
    });
    // What comes back is the artifact, not the stamped file: the stamp has been taken off, so
    // the specs read exactly what the extractor produced.
    expect(JSON.stringify(loaded.corpus?.["kit-a11y"])).toBe(JSON.stringify(CORPUS["kit-a11y"]));
  });

  it("SOME MISSING → the embedded snapshot, and the warning names the missing file", async () => {
    await write();
    await rm(join(root, "eds", "kit-icons.json"));

    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    expect(loaded.warnings).toEqual([
      { reason: "incomplete", file: join(root, "eds", "kit-icons.json") },
    ]);
  });

  it("PRESENT BUT UNPARSEABLE → the embedded snapshot, and the warning names the bad file", async () => {
    await write();
    await writeFile(join(root, "eds", "tokens.json"), "{ not json", "utf8");

    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toMatchObject({
      reason: "invalid",
      file: join(root, "eds", "tokens.json"),
    });
    expect(loaded.warnings[0]?.detail).toBeTruthy();
  });

  it("PRESENT BUT SCHEMA-INVALID → the embedded snapshot, and the detail names the field", async () => {
    await write();
    const file = join(root, "eds", "kit-icons.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...parsed, icons: "not an array" }), "utf8");

    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    // Naming the FIELD is the value of the message; "the corpus is invalid" sends someone to
    // four megabytes of JSON.
    expect(loaded.warnings[0]?.detail).toContain("icons");
  });

  it("A FILE WITH NO STAMP is refused — provenance is not optional", async () => {
    await write();
    const file = join(root, "eds", "components.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as { meta: Record<string, unknown> };
    const { corpus: _stamp, ...meta } = parsed.meta;
    await writeFile(file, JSON.stringify({ ...parsed, meta }), "utf8");

    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    expect(loaded.warnings[0]?.detail).toContain("meta.corpus");
  });

  it("A FILE STAMPED FOR ANOTHER KIT is refused", async () => {
    await writeCorpus({ kit: "eds", corpus: CORPUS, stamp: { ...STAMP, kit: "other" }, env });

    const loaded = await loadCorpus({ kit: "eds", env });
    expect(loaded.corpus).toBeNull();
    // Five files, five warnings: the reader does not stop at the first, so one run tells a user
    // about everything wrong rather than making them fix five things one at a time.
    expect(loaded.warnings).toHaveLength(CORPUS_MEMBERS.length);
  });

  it("never rejects, whatever is in the directory", async () => {
    await write();
    for (const member of CORPUS_MEMBERS) {
      await writeFile(join(root, "eds", `${member}.json`), " garbage", "utf8");
    }
    await expect(loadCorpus({ kit: "eds", env })).resolves.toMatchObject({ corpus: null });
  });
});

describe("the embedded snapshot's own version", () => {
  it("is read off tokens.json rather than written down twice", () => {
    // The notice prints `eds 1.13.0 (embedded)`, and this is where the `1.13.0` comes from. A
    // literal here would be a second place to update when a newer snapshot is embedded.
    expect(EMBEDDED_VERSION).toBe("1.13.0");
  });
});
