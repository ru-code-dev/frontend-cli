import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * The guard against carrying the source repo's private material into this one.
 *
 * h3 §5 and h5 §4.1 found a live internal Jenkins generic-webhook URL **with its auth token**
 * hardcoded in that repo's dashboard component and a second time in a skill file. None of
 * that is in this package's port path — the dashboard is not ported at all — but "we did not
 * copy it" is a claim that should be checked by a test rather than asserted in a report,
 * because the next person to paste a snippet across will not have read the report.
 *
 * The same test covers the vendor scope and the extracted-artifact paths: this engine is
 * generic by construction, and a reference to one specific design system's package or to a
 * file it never loads would mean that stopped being true.
 *
 * The needles are assembled from fragments so that this file does not itself become the
 * occurrence it is looking for.
 */

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SCANNED_DIRECTORIES = ["src", "tests"];

const SKIPPED = new Set(["node_modules", "dist"]);

/**
 * This file is excluded from its own scan.
 *
 * Some needles below have to be written out to be searched for at all — a check for
 * `artifactsDir` cannot avoid containing the word — and a guard that flagged itself would be
 * permanently red. The needles that name something genuinely private (the CI host, the
 * webhook) are still assembled from fragments, so no secret is transcribed here either way.
 */
const SELF = "forbidden-content.test.ts";

/** Literal strings no file in this package may contain, case-insensitively. */
const FORBIDDEN_STRINGS: readonly string[] = [
  // The CI host and its webhook, the two halves of the leaked URL.
  ["sbt", "-jenkins"].join(""),
  "sberworks",
  ["generic", "-webhook-trigger"].join(""),
  ["invoke?", "token="].join(""),
  // The vendor scopes: the wrapped upstream and the published kit packages.
  ["@v", "-uik"].join(""),
  ["@sds", "-eng"].join(""),
  "ui-kit-eds-ce",
  "DS_UI_KIT_ROOT",
  // The artifact seam this port exists to cut.
  "artifactsDir",
];

/** Paths of the extracted kit artifacts, which nothing here may read or name. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\bkit-(a11y|icons|signatures|cards)\.json\b/i,
  /artifacts[/\\](tokens|components)\.json/i,
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

const allFiles = SCANNED_DIRECTORIES.flatMap((directory) =>
  filesUnder(join(PACKAGE_ROOT, directory)),
);

describe("forbidden content", () => {
  it("scans every source and fixture file", () => {
    // A guard that silently scanned nothing would pass forever.
    expect(allFiles.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN_STRINGS)("no file contains %s", (needle) => {
    const offenders = allFiles.filter((file) =>
      readFileSync(file, "utf8").toLowerCase().includes(needle.toLowerCase()),
    );

    expect(offenders.map((file) => file.slice(PACKAGE_ROOT.length))).toEqual([]);
  });

  it("names no extracted kit artifact", () => {
    const offenders = allFiles.filter((file) => {
      const content = readFileSync(file, "utf8");
      return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
    });

    expect(offenders.map((file) => file.slice(PACKAGE_ROOT.length))).toEqual([]);
  });

  it("imports nothing from a design-system package", () => {
    const imports = allFiles
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(
          (match) => match[1],
        ),
      );

    expect(
      imports.filter((specifier) => specifier !== undefined && /^@(v-|sds-)/.test(specifier)),
    ).toEqual([]);
  });
});
