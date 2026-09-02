/**
 * Regenerates `src/artifacts/v2/*.json` from an EDS 2.x checkout.
 *
 * NOT part of the build and not shipped: the five files it writes are committed, and this script
 * is how they were produced and how they are reproduced. Run it against a checkout of
 * `develop-2.0` and diff the result — a change in the kit shows up as a change in the artifacts,
 * which is the only place a reviewer can see it.
 *
 *   node --experimental-strip-types scripts/generate-v2-artifacts.ts ../../../ui-kit-eds-ce-2
 *
 * The checkout is READ ONLY. Nothing is installed into it and nothing is written to it — the
 * whole v2 token extraction runs under a vanilla-extract stub for that reason
 * (`src/extract/v2/theme-loader.ts`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS_MEMBERS } from "../src/extract/pipeline.ts";
import { resolveKitPathsV2 } from "../src/extract/v2/paths.ts";
import { extractCorpusV2, readKitVersionV2 } from "../src/extract/v2/pipeline.ts";
import { EXTRACTOR_VERSION } from "../src/extract/provenance.ts";
import { EDS_PROFILES } from "../src/profile.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, "..", "src", "artifacts", "v2");

const checkout = resolve(process.argv[2] ?? "../../../ui-kit-eds-ce-2");

const commitOf = (dir: string): string | null => {
  try {
    const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};

const paths = resolveKitPathsV2(checkout);
const corpus = await extractCorpusV2({
  paths,
  onStage: (stage) => {
    process.stdout.write(`  ${stage}\n`);
  },
});

const provenance = {
  kit: EDS_PROFILES.eds2.id,
  version: await readKitVersionV2(checkout),
  commit: commitOf(checkout),
  extractor: EXTRACTOR_VERSION,
  source: EDS_PROFILES.eds2.source.repo,
  ref: EDS_PROFILES.eds2.source.ref,
};

mkdirSync(outputDir, { recursive: true });

for (const member of CORPUS_MEMBERS) {
  const artifact = corpus[member] as { meta?: Record<string, unknown> };
  // The stamp goes under `meta`, last, exactly where `writeCorpus` puts a regenerated corpus's
  // (`src/corpus.ts:364-369`), so an embedded artifact and an on-disk one carry provenance in
  // the same field and a reader compares like with like.
  const stamped = { ...artifact, meta: { ...artifact.meta, corpus: provenance } };
  const file = join(outputDir, `${member}.json`);
  writeFileSync(file, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  process.stdout.write(`${file}\n`);
}

process.stdout.write(`\nprovenance ${JSON.stringify(provenance)}\n`);
