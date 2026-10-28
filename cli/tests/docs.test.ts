/**
 * TIER 1 — the docs show the command a user can actually type (D4, review-1 finding 3).
 *
 * `fg` is a shell builtin: a doc or screenshot that shows `fg --passets …` sends the reader to job
 * control. Every Markdown doc of the docs law (README + docs/**) is scanned; so is every image a
 * doc embeds — it must exist (the stale `fg v1.0.0` pixso captures were deleted, not kept).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));
}

const DOCS = [join(repoRoot, "README.md"), ...markdownFiles(join(repoRoot, "docs"))];

/** `fg` used AS THE COMMAND: at a line/word start, followed by a flag, a placeholder or a verb. */
const FG_COMMAND = /(^|[\s`$(«])fg (--|-[a-z]|<|install|uninstall|token)/mu;

describe("docs show `fguard`, never `fg`, as the command", () => {
  it("there are docs to check", () => {
    expect(DOCS.length).toBeGreaterThan(10);
  });

  for (const file of DOCS) {
    it(`${file.slice(repoRoot.length + 1)}: no \`fg …\` command`, () => {
      const hit = FG_COMMAND.exec(readFileSync(file, "utf8"));
      expect(hit?.[0] ?? null).toBeNull();
    });
  }

  it("no doc embeds one of the deleted fg-era pixso captures, and every embedded image exists", () => {
    const stale = /(27-psvg|28-phtml|29-pprompt|30-passets|31-passets|34-psvg-local|43-psvg-pipe)-[a-z-]*\.png/u;
    for (const file of DOCS) {
      const text = readFileSync(file, "utf8");
      expect(stale.exec(text)?.[0] ?? null, file).toBeNull();
      for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+\.png)\)/gu)) {
        expect(existsSync(resolve(dirname(file), match[1] ?? "")), `${file}: ${match[1] ?? ""}`).toBe(true);
      }
    }
  });
});
