import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The secrets guard, extended over four megabytes of copied data and the built bundle.
 *
 * h3 §5 and h5 §4.1 found a live internal Jenkins generic-webhook URL **with its auth token**
 * hardcoded in the hackathon repo's dashboard component, and a second copy of the same token in
 * a skill file. This package copies more from that repo than any other in this workspace — five
 * extracted artifacts, sixteen rule functions — so "we did not copy the secret" is exactly the
 * claim that has to be a test here rather than a sentence in a report.
 *
 * It differs from the engine's guard in two ways, and both are deliberate.
 *
 *  1. **The vendor scopes are allowed.** This *is* the design system's adapter: `@sds-eng/base`
 *     is what `kitPackages` holds and `@v-uik` is the scope it wraps. Forbidding them here would
 *     forbid the package from doing its job. The engine's guard, which does forbid them, is what
 *     keeps that knowledge on this side of the seam.
 *  2. **It scans `dist/` when a build is present**, because the brief's hygiene requirement is
 *     about what ships, and an artifact is only clean if the bundle that embeds it is.
 *
 * The needles are assembled from fragments so that this file does not itself become the
 * occurrence it is looking for.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SCANNED_DIRECTORIES = ["src", "tests", "dist"];

const SKIPPED = new Set(["node_modules"]);

/**
 * This file is excluded from the directory walk; see the engine's guard for the same reasoning.
 *
 * The exclusion is NOT what keeps it green — that is the case at the bottom of this file, which
 * runs the whole needle list against this file's own text. V3 MINOR-7 found the exclusion doing
 * real work: the machine path was transcribed verbatim in prose above, so the guard's own
 * source held two of the strings it bans. It no longer does, and the self-check is what stops
 * that from becoming true again quietly.
 */
const SELF = "forbidden-content.test.ts";

/** Literal strings no file in this package may contain, case-insensitively. */
const FORBIDDEN_STRINGS: readonly string[] = [
  // The CI host and its webhook: the two halves of the leaked URL, plus the query the token
  // was passed in.
  ["sbt", "-jenkins"].join(""),
  ["sber", "works"].join(""),
  ["generic", "-webhook-trigger"].join(""),
  ["invoke?", "token="].join(""),
  ["build", "WithParameters"].join(""),
  // Absolute paths and env vars from the extraction machine, which would leak a layout nobody
  // outside that machine can satisfy.
  //
  // E2a NARROWED THIS PAIR, and the narrowing is the point rather than a relaxation.
  // `ui-kit-eds-ce` used to be banned outright as a proxy for the leak that was actually found —
  // `extraction-summary.json`'s `uiKitRoot`, which read
  //   "/home/" + "zach/" + "WORKSPACE/" + "hackathon" + "/ui-kit-eds-ce"
  // (E1 §3), an absolute path from the machine that produced the hackathon's artifacts. V3
  // MINOR-7: that value used to be transcribed here as one string, so the guard's own prose
  // held both needles it bans and stayed green only because the file skips itself. It is
  // written in the same fragment idiom as the entries below instead — the reader still sees the
  // exact path, and no file in this package contains it. The
  // repository NAME is not that leak, and it is now a value this package must hold: the default
  // `--parse-ui-kit --source` is `https://gitverse.ru/sbertech/ui-kit-eds-ce.git`
  // (`src/extract/provenance.ts`), which the brief fixes. So the two machine-path fragments are
  // banned directly, which is both narrower and STRICTER — the old needle would not have caught
  // that path under any other repository name.
  ["/home/", "zach/"].join(""),
  ["WORKSPACE/", "hackathon"].join(""),
  // The hackathon's kit-root environment variable (`ds-analyzer/src/config.ts:62`). Dropped
  // deliberately by this port — a bundle that discovers its input from the environment is a
  // bundle whose behaviour depends on a shell nobody reviewed — so no file here may name it,
  // including in prose.
  ["DS_UI", "_KIT_ROOT"].join(""),
  ["DS_SKILL", "_ASSETS"].join(""),
];

/**
 * Shapes a credential takes, for the strings no fixed list can enumerate.
 *
 * Deliberately narrow: the artifacts are full of component names and CSS values, and a pattern
 * loose enough to match "any long hex string" would match half of `kit-icons.json`.
 */
const FORBIDDEN_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["an http(s) URL with credentials or a token query", /https?:\/\/[^\s"']*(?:@|token=)/i],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._-]{12,}/],
  ["an ssh private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an aws access key id", /\bAKIA[0-9A-Z]{16}\b/],
  [
    "an assignment to a secret-looking name",
    /\b(?:api[_-]?key|secret|passwd)\s*[:=]\s*["'][^"']{8,}/i,
  ],
];

const filesUnder = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIPPED.has(entry.name)) {
      continue;
    }

    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(absolute));
    } else if (entry.isFile() && entry.name !== SELF && statSync(absolute).size > 0) {
      files.push(absolute);
    }
  }

  return files;
};

const allFiles = SCANNED_DIRECTORIES.flatMap((directory) => {
  const absolute = join(PACKAGE_ROOT, directory);
  // `dist` is absent before the first build; `src` and `tests` never are, and the count
  // assertion below is what catches a scan that found nothing.
  try {
    return filesUnder(absolute);
  } catch {
    return [];
  }
});

const relative = (file: string): string => file.slice(PACKAGE_ROOT.length);

describe("forbidden content", () => {
  it("scans the sources, the embedded artifacts and the fixtures", () => {
    // A guard that silently scanned nothing would pass forever.
    expect(allFiles.length).toBeGreaterThan(30);

    // Specifically: the four megabytes this package copied in.
    const artifacts = allFiles.filter((file) => file.includes(join("src", "artifacts")));
    expect(artifacts.filter((file) => file.endsWith(".json"))).toHaveLength(5);
  });

  it.each(FORBIDDEN_STRINGS)("no file contains %s", (needle) => {
    const offenders = allFiles.filter((file) =>
      readFileSync(file, "utf8").toLowerCase().includes(needle.toLowerCase()),
    );

    expect(offenders.map(relative)).toEqual([]);
  });

  it.each(FORBIDDEN_PATTERNS)("no file contains %s", (_label, pattern) => {
    const offenders = allFiles.filter((file) => pattern.test(readFileSync(file, "utf8")));

    expect(offenders.map(relative)).toEqual([]);
  });

  /**
   * V3 MINOR-7 — THE GUARD OBEYS ITSELF.
   *
   * Every needle is written as fragments joined at runtime, so the list can name a secret
   * without becoming an occurrence of it. That was a header comment and an intention; here it
   * is a test. Only the string needles: the patterns are regex sources whose own text is not a
   * credential, and asserting a `Bearer` matcher never appears in a file that has to spell one
   * would ban the guard from existing.
   */
  it("contains none of the strings it bans — the exclusion is a convenience, not the reason", () => {
    const own = readFileSync(join(PACKAGE_ROOT, "tests", SELF), "utf8").toLowerCase();
    const transcribed = FORBIDDEN_STRINGS.filter((needle) => own.includes(needle.toLowerCase()));

    expect(transcribed).toEqual([]);
  });
});
