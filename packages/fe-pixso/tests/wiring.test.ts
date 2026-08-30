/**
 * SKELETON suite. Its job is not to test behaviour that does not exist yet — it is to pin
 * the two wiring facts the whole scaffold rests on, so 3.3 starts from a proven floor:
 *
 *  1. the frozen contract resolves across the workspace link (`workspace:*`), and
 *  2. `@smart-tools/pixso-core` resolves through BOTH halves of its exports map — the
 *     browser-safe root `.` and the world-touching `./node`
 *     (`ru-code-packages/packages/pixso-core/package.json:10-19`, report 1.3 §1). Under the
 *     `.pnpmfile.cjs` hook that resolution goes to the LOCAL build, so this suite failing is
 *     the first sign the cross-repo link broke.
 */
import { describe, expect, it } from "vite-plus/test";

import { PIXSO_REMOTE_MCP_ENDPOINT } from "@smart-tools/pixso-core";
import { fetchScan, loadCapture } from "@smart-tools/pixso-core/node";

import { pixsoCommands } from "../src/index.ts";

describe("fe-pixso — the wiring the feature work will stand on", () => {
  it("exports a registry contribution — the four commands 3.2 filled it with", () => {
    expect(Array.isArray(pixsoCommands)).toBe(true);
    expect(pixsoCommands).toHaveLength(4);
  });

  it("resolves pixso-core's browser-safe root entry", () => {
    expect(typeof PIXSO_REMOTE_MCP_ENDPOINT).toBe("string");
    expect(PIXSO_REMOTE_MCP_ENDPOINT.length).toBeGreaterThan(0);
  });

  it("resolves pixso-core's `./node` entry — the front door 3.3 composes", () => {
    expect(typeof fetchScan).toBe("function");
    expect(typeof loadCapture).toBe("function");
  });
});
