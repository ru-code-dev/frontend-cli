import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { FIXTURES, fixturePath, readGolden } from "./fixtures.ts";

/**
 * TIER 2 — the suite that makes the goldens mean something.
 *
 * `parity.test.ts` compares this package against files under `tests/golden/`. Those files are
 * only evidence if they really are what the hackathon's tool prints, and a committed file
 * proves nothing about a program it was never compared to. So this suite runs the program:
 *
 *     node <hackathon>/skills/ds-audit/scripts/ds.mjs analyze <fixture> --out <tmp>
 *
 * and asserts its output equals the committed goldens byte for byte. Together the two suites
 * close the loop — tier 1 says "we match the goldens", tier 2 says "the goldens are ds.mjs".
 *
 * It is tier 2 rather than tier 1 for one reason: it needs the hackathon checkout, which is a
 * sibling of this repository rather than part of it. The path can be overridden with
 * `DS_REFERENCE` for a different layout. The repository is read only — `analyze` writes to a
 * temporary directory this suite creates and removes, never inside the fixture or the source
 * tree.
 */

const DEFAULT_REFERENCE = new URL(
  "../../../../hackathon2026/skills/ds-audit/scripts/ds.mjs",
  import.meta.url,
).pathname;

const reference = process.env["DS_REFERENCE"] ?? DEFAULT_REFERENCE;

const workspace = mkdtempSync(join(tmpdir(), "fe-eds-parity-"));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("the goldens are the hackathon tool's own output", () => {
  it("the reference tool is present", () => {
    // A skipped parity check that reports success is exactly the failure mode this project
    // refuses, so absence is a failure with the path in the message, not a silent pass.
    expect(
      existsSync(reference),
      `ds.mjs not found at ${reference}. Set DS_REFERENCE to the hackathon checkout's ` +
        `skills/ds-audit/scripts/ds.mjs to run the tier-2 parity check.`,
    ).toBe(true);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture}: ds.mjs reproduces the committed goldens`, () => {
      const out = join(workspace, fixture);

      execFileSync(process.execPath, [reference, "analyze", fixturePath(fixture), "--out", out], {
        stdio: "pipe",
        timeout: 240_000,
      });

      for (const kind of ["findings", "usage", "summary"] as const) {
        expect(readFileSync(join(out, `${kind}.json`), "utf8")).toBe(readGolden(fixture, kind));
      }
    });
  }
});
