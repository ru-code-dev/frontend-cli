/**
 * THE GUARD: the hackathon's leaked secret must never live in this repo.
 *
 * `hackathon2026/ds-analyzer/dashboard/src/components/PrFlow.tsx:21-22` hardcodes an internal
 * Sber Jenkins `generic-webhook-trigger` URL WITH its auth token in the query string, and it
 * is compiled verbatim into that repo's committed `dashboard/dist/index.html` (h3 §5, h5 §4).
 * This port deletes the component rather than disabling it, and this suite is what keeps it
 * deleted — over the ported SOURCES and over the two BUILD ARTIFACTS, because the source
 * being clean says nothing about a build that inlines a megabyte of someone else's HTML.
 *
 * The token itself is deliberately NOT written here. Spelling a secret out inside the guard
 * that exists to keep it out would be the same mistake in a different file, and it is
 * unnecessary: a `token=<20+ opaque characters>` query parameter has no legitimate reason to
 * appear in a static report, so the shape is the assertion.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { builtBundle, builtTemplate, packageRoot } from "./support.ts";

/** This file names the strings it forbids, so it is the one file exempt from its own scan. */
const guardFile = fileURLToPath(import.meta.url);

/** Literal strings that may not appear anywhere in this package or its output. */
const FORBIDDEN_LITERALS: readonly string[] = [
  "sbt-jenkins",
  "sigma.sbrf.ru",
  "generic-webhook-trigger",
  "@v-uik",
  "@sds-eng",
];

/** Any embedded credential in a URL, whatever its value. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [/[?&]token=[A-Za-z0-9_-]{16,}/, /_DNU_ST_/];

const SOURCE_DIRECTORIES = ["src", "tests", "scripts", join("dashboard", "src")];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".css", ".html", ".json"];

const filesUnder = (directory: string): string[] => {
  const entries = readdirSync(directory).map((entry) => join(directory, entry));
  return entries.flatMap((entry) =>
    statSync(entry).isDirectory()
      ? filesUnder(entry)
      : SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))
        ? [entry]
        : [],
  );
};

const sourceFiles = [
  ...SOURCE_DIRECTORIES.flatMap((directory) => filesUnder(join(packageRoot, directory))),
  join(packageRoot, "package.json"),
  join(packageRoot, "dashboard", "index.html"),
  join(packageRoot, "dashboard", "vite.config.ts"),
].filter((file) => file !== guardFile);

describe("forbidden strings — the ported sources", () => {
  it("scans a non-trivial number of files (a guard that greps nothing proves nothing)", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  for (const forbidden of FORBIDDEN_LITERALS) {
    it(`never writes «${forbidden}»`, () => {
      const offenders = sourceFiles
        .filter((file) => readFileSync(file, "utf8").includes(forbidden))
        .map((file) => relative(packageRoot, file));

      expect(offenders).toEqual([]);
    });
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`never writes anything matching ${String(pattern)}`, () => {
      const offenders = sourceFiles
        .filter((file) => pattern.test(readFileSync(file, "utf8")))
        .map((file) => relative(packageRoot, file));

      expect(offenders).toEqual([]);
    });
  }
});

describe("forbidden strings — the built artifacts", () => {
  it("keeps the built dashboard clean", () => {
    const html = builtTemplate();

    expect(FORBIDDEN_LITERALS.filter((forbidden) => html.includes(forbidden))).toEqual([]);
    expect(FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(html)).map(String)).toEqual([]);
  });

  it("keeps the library bundle clean — the dashboard is inlined into it", () => {
    const bundle = builtBundle();

    expect(FORBIDDEN_LITERALS.filter((forbidden) => bundle.includes(forbidden))).toEqual([]);
    expect(FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(bundle)).map(String)).toEqual([]);
  });
});
