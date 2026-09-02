/**
 * WHERE A CORPUS CAME FROM — the stamp, and the one place its shape is written down.
 *
 * A regenerated corpus and the embedded one are the same five files with the same five schemas,
 * and that is exactly the problem: opened side by side they are indistinguishable, so a report
 * built against a six-month-old regeneration would look identical to one built against the
 * snapshot this package ships. The stamp is what makes the difference visible — in the
 * `--project-report` notice, in the payload's `adapter` field, and in the file itself.
 *
 * ── WHY IT LIVES UNDER `meta` AND NOT BESIDE IT ─────────────────────────────────────────────
 *
 * Every artifact already has a `meta` object, and every one of the hackathon's fields in it is
 * kept untouched (`meta.sourceRoot`, `meta.themePackageVersion`, `meta.counts`, …). The stamp is
 * ONE added key, `meta.corpus`. Adding a sibling top-level key instead would have meant five
 * schemas each growing a root-level field; nesting it under the object that already means "facts
 * about this extraction rather than about the kit" costs one key and reads correctly.
 *
 * ── WHY THE EXTRACTORS DO NOT ADD IT ────────────────────────────────────────────────────────
 *
 * The stamp is added by the WRITER (`corpus.ts`), never by an extractor. That is what keeps the
 * acceptance test meaningful: an extractor's output must be byte-identical to the artifact the
 * hackathon's esbuild-based pipeline produced, and a timestamp is by definition not identical
 * between two runs. So extraction is pure and reproducible, and the one non-reproducible fact —
 * when this happened — is applied at the moment the bytes hit the disk.
 * `tests/corpus.test.ts` pins both halves: stripping `meta.corpus` from a written file returns
 * the byte-identical artifact.
 */
import { z } from "zod";

/**
 * The extraction pipeline's own version.
 *
 * A literal, deliberately, rather than the package version read at build time. It answers a
 * different question: `0.1.0` is which release of this package you have, and this is which
 * revision of the EXTRACTION SEMANTICS produced the numbers in the file. Bump it when an
 * extractor changes what it emits for unchanged input — that is precisely when a corpus on disk
 * stops being comparable with one produced today, and the byte-identity suite is what tells you
 * a change had that effect.
 */
export const EXTRACTOR_VERSION = "1.0.0";

/** The default upstream this kit is cloned from when `--source` says nothing. */
export const DEFAULT_KIT_SOURCE = "https://gitverse.ru/sbertech/ui-kit-eds-ce.git";

export const corpusStampSchema = z.object({
  /** The kit id this corpus is for — `eds`. Guards against a file copied into the wrong dir. */
  kit: z.string().min(1),
  /** The design system's own version, e.g. `1.13.0`. `null` when the checkout did not say. */
  version: z.string().nullable(),
  /** Full commit sha of the checkout it was extracted from, or `null` when git could not say. */
  commit: z.string().nullable(),
  /** ISO-8601, UTC, second precision — the moment the file was written. */
  extractedAt: z.string().min(1),
  /** {@link EXTRACTOR_VERSION} at the time of extraction. */
  extractor: z.string().min(1),
  /** What the user passed as `--source` (or the default), verbatim. */
  source: z.string().min(1),
});

export type CorpusStamp = z.infer<typeof corpusStampSchema>;
