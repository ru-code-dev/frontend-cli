/**
 * TIER 1 — the same handler with the RENDER SEAM LEFT REAL.
 *
 * `command.test.ts` fakes `renderReport` so its assertions are about control flow. This file
 * fakes only acquisition and analysis, so the real `payloadOf` output goes into the real
 * built dashboard template and the real file is read back. It is the cheapest place to catch
 * the failure that would otherwise wait for tier 2: a payload the template cannot carry.
 *
 * It reads `@smart-tools/fe-analyzer-report`'s BUILT `dist/` (the package's exports map points
 * there, and the megabyte template only exists after `pnpm build` — the template lives in
 * `dist/index.mjs`, never in `src/`, `packages/fe-analyzer-report/src/template.ts` holding only
 * a placeholder). The same assumption every suite in that package makes
 * (`packages/fe-analyzer-report/tests/template.test.ts`).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createProjectReportCommands } from "../src/index.ts";
import { capture, ENGINE_RESULT, scratch } from "./harness.ts";

let dir = "";
let remove: () => Promise<void> = () => Promise.resolve();

beforeEach(async () => {
  ({ dir, remove } = await scratch());
});

afterEach(async () => {
  await remove();
});

/** Only the two seams that need a project on disk are replaced. */
const command = createProjectReportCommands({
  resolveSource: (input: string) =>
    Promise.resolve({ kind: "local", dir: `/projects/${input}`, cleanup: () => Promise.resolve() }),
  analyzeProject: () => Promise.resolve(ENGINE_RESULT),
})[0];

/** The JSON the dashboard boots from, lifted back out of the written page. */
function embedded(html: string): Record<string, unknown> {
  // The slot's exact spelling is the renderer's own (`packages/fe-analyzer-report/src/render.ts:26`).
  const match = /<script type="application\/json" id="ds-data">([\S\s]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse((match?.[1] ?? "{}").replace(/\\u003C/gu, "<")) as Record<string, unknown>;
}

describe("the written file is the real report", () => {
  it("is one self-contained page carrying the payload the engine result produced", async () => {
    const out = join(dir, "report.html");
    expect(await command?.run(capture({ source: "app", out }).ctx)).toBe(0);

    const html = await readFile(out, "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.length).toBeGreaterThan(500_000);

    // SELF-CONTAINED: no asset is fetched over the network when the file is opened. The
    // remaining `http(s)` strings in the build are inert text — W3C namespaces, a React error
    // link, library credits (`b3-analyzer-report.md:223-226`) — so the check is on the
    // ATTRIBUTES that would cause a request, not on the substring.
    expect(html).not.toMatch(/<(?:script|link|img|iframe)[^>]+(?:src|href)="https?:\/\//iu);
    expect(html).not.toMatch(/@import\s+(?:url\()?["']https?:\/\//iu);

    const data = embedded(html);
    expect(data["findings"]).toHaveLength(2);
    expect((data["summary"] as { files: unknown }).files).toEqual({ scanned: 9, clean: 7 });
    expect((data["project"] as { name: unknown }).name).toBe("app");
  });

  it("the payload survives the substitution byte for byte", async () => {
    const out = join(dir, "report.html");
    await command?.run(capture({ source: "app", out }).ctx);
    const data = embedded(await readFile(out, "utf8"));
    const findings = data["findings"] as {
      id: string;
      rule: string;
      snippet: { before: string };
    }[];
    expect(findings.map((f) => f.rule)).toEqual(["a11y.name.missing", "icon.foreign-pack"]);
    // The snippet is the field with the sharp edges — it is source text, and the renderer's
    // escaping exists so a `</script>` or a `$'` inside it cannot break the page
    // (`packages/fe-analyzer-report/src/render.ts`).
    expect(findings[0]?.snippet.before).toBe('<button className="icon-button" />');
  });
});
