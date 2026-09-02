import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { parseArgs, run, USAGE } from "../src/cli-run.ts";
import type { KitExtract } from "../src/types.ts";
import { fixturePackagesDir } from "./harness.ts";

const scratch = mkdtempSync(join(tmpdir(), "fe-kit-extract-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("reads the documented invocation", () => {
    expect(parseArgs(["/kit/packages", "--exclude", "a,b", "-o", "kit.json"])).toEqual({
      packagesDir: "/kit/packages",
      exclude: ["a", "b"],
      out: "kit.json",
      help: false,
    });
  });

  it("accepts `=` forms and repeated --exclude", () => {
    expect(parseArgs(["--exclude=a", "--exclude=b,c", "--out=x.json", "/kit/packages"])).toEqual({
      packagesDir: "/kit/packages",
      exclude: ["a", "b", "c"],
      out: "x.json",
      help: false,
    });
  });

  it("rejects unknown options and extra positionals", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/u);
    expect(() => parseArgs(["a", "b"])).toThrow(/extra argument/u);
    expect(() => parseArgs(["--exclude"])).toThrow(/--exclude needs a value/u);
  });
});

describe("run", () => {
  it("prints usage for --help", () => {
    expect(run(["--help"])).toEqual({ code: 0, stdout: USAGE, stderr: "" });
  });

  it("fails with usage when the packages dir is missing", () => {
    const result = run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("missing <packages-dir>");
  });

  it("fails cleanly on a directory that does not exist", () => {
    const result = run([join(scratch, "nope")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("packages directory not found");
  });

  it("writes the same JSON to a file that it prints to stdout", () => {
    const out = join(scratch, "nested", "kit.json");
    const toFile = run([fixturePackagesDir("kit-a"), "-o", out]);
    expect(toFile.code).toBe(0);
    expect(toFile.stdout.trim()).toBe(`wrote ${out}`);

    const toStdout = run([fixturePackagesDir("kit-a")]);
    expect(toStdout.code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(toStdout.stdout);

    const parsed = JSON.parse(toStdout.stdout) as KitExtract;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.components.Button?.extendsHtml).toBe("button");
  });

  it("applies --exclude from the command line", () => {
    const result = run([fixturePackagesDir("kit-a"), "--exclude", "ui-lab,ui-legacy"]);
    const parsed = JSON.parse(result.stdout) as KitExtract;
    expect(Object.keys(parsed.components)).not.toContain("Widget");
    expect(Object.keys(parsed.components)).not.toContain("Badge");
  });
});
