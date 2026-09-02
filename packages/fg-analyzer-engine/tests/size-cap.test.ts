import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { scanProject } from "../src/index.ts";
import { MAX_PARSEABLE_FILE_BYTES } from "../src/scanner/walk.ts";

/**
 * V6 AUDIT FINDING #7 — a code/style file over {@link MAX_PARSEABLE_FILE_BYTES} (1 MiB) is
 * skipped rather than read and parsed.
 *
 * A synthetic project rather than a fixture under `tests/fixtures/`: the whole point is a file
 * too large to commit to a fixture directory, and `analyzeFixture`'s caching/golden machinery
 * (`fixtures.ts`) is for the fixed corpus baselined against goldens — this is neither.
 */

let scratch = "";

afterEach(() => {
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

describe("the 1 MiB size cap on parsed files", () => {
  it("skips a 1.1 MiB source file — a limitation, not a parse attempt — and still scans the rest", () => {
    scratch = mkdtempSync(join(tmpdir(), "fg-size-cap-"));
    writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "big-file-project" }));

    // 1.1 MiB, comfortably over the 1 MiB cap. Valid JS, not garbage: if the cap ever regressed
    // and this got parsed anyway, it must fail as a WRONG limitation reason (or none at all),
    // not merely as some `parse-error` the size cap could be mistaken for.
    const line = `export const v${"0".repeat(40)} = ${"1".repeat(40)};\n`;
    const target = 1.1 * 1024 * 1024;
    writeFileSync(join(scratch, "big.ts"), line.repeat(Math.ceil(target / line.length)));

    // An ordinary small file beside it, proving the cap skips only the oversized file and does
    // not abort or degrade the rest of the scan.
    writeFileSync(join(scratch, "small.ts"), "export const small = 1;\n");

    const { profile, observations } = scanProject({ path: scratch });

    const bigFileLimitations = profile.limitations.filter((entry) => entry.file === "big.ts");
    expect(bigFileLimitations).toHaveLength(1);
    expect(bigFileLimitations[0]?.reason).toBe("file-too-large");
    expect(bigFileLimitations[0]?.detail.length).toBeGreaterThan(0);
    // The detail is Russian — this repo's default, and every reason added since EDS 2.x is
    // written in it (`domain/profile.ts`'s `limitationSchema.detail` doc).
    expect(bigFileLimitations[0]?.detail).toMatch(/[а-яё]/i);

    // Never read, never handed to a collector: absent from the scanned-files list, and counted
    // as unparseable (like the sibling "could not be read" case) rather than as scanned.
    expect(observations.files).not.toContain("big.ts");
    expect(profile.files.unparseable).toBeGreaterThanOrEqual(1);

    // The small file was still scanned normally — the cap did not stop the run.
    expect(observations.files).toContain("small.ts");
  });

  it("leaves a file just UNDER the cap alone — no limitation, scanned normally", () => {
    scratch = mkdtempSync(join(tmpdir(), "fg-size-cap-under-"));
    writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "under-cap-project" }));

    const line = "export const value = 1;\n";
    // 1 KiB under the cap.
    const target = MAX_PARSEABLE_FILE_BYTES - 1024;
    writeFileSync(join(scratch, "almost-big.ts"), line.repeat(Math.ceil(target / line.length)));

    const { profile, observations } = scanProject({ path: scratch });

    expect(profile.limitations.some((entry) => entry.file === "almost-big.ts")).toBe(false);
    expect(observations.files).toContain("almost-big.ts");
  });
});
