/**
 * TIER 1 — the payload: manifest validation (the checks ru-code's loader applies, run before
 * anything is written), the packed form's integrity, and the build-time packer's refusals.
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { FORBIDDEN_LITERALS, FORBIDDEN_PATTERNS } from "../src/forbidden.ts";
import { VendorError, packVendor } from "../src/pack.ts";
import { payloadOf, sha256, unpackPayload, validateManifest } from "../src/payload.ts";
import { MANIFEST, cleanScratch, fixturePayload, scratch } from "./support.ts";

afterEach(cleanScratch);

const withManifest = (manifest: unknown, pluginDir = "pixso") =>
  payloadOf({
    preflight: "",
    pluginDir,
    files: {
      "plugin.json": typeof manifest === "string" ? manifest : JSON.stringify(manifest),
      "server/index.mjs": "s",
      "web/index.mjs": "w",
      "web/styles.css": "c",
    },
  });

describe("validateManifest", () => {
  it("accepts the real plugin's shape and reports its id and version", () => {
    expect(validateManifest(fixturePayload("/r"))).toEqual({
      ok: true,
      manifest: { id: "pixso", version: "1.0.0" },
    });
  });

  const cases: readonly [string, unknown, string, string?][] = [
    ["unparseable JSON", "{nope", "json"],
    ["a JSON array", "[]", "json"],
    ["an id that breaks the pattern", { ...MANIFEST, id: "Pixso" }, "id"],
    ["a one-letter id", { ...MANIFEST, id: "p" }, "id"],
    ["an id that is not the folder name", { ...MANIFEST, id: "pixso-two" }, "folder"],
    ["apiVersion 1", { ...MANIFEST, apiVersion: 1 }, "api"],
    ['apiVersion "2" (a string)', { ...MANIFEST, apiVersion: "2" }, "api"],
    ["no version", { ...MANIFEST, version: "" }, "version"],
    ["an absolute entry", { ...MANIFEST, server: "/etc/passwd" }, "entry"],
    ["a Windows-absolute entry", { ...MANIFEST, server: "C:\\x.mjs" }, "entry"],
    ["an entry with ..", { ...MANIFEST, web: "../web/index.mjs" }, "entry"],
    ["an entry with a NUL", { ...MANIFEST, web: "web/index.mjs\u0000" }, "entry"],
    ["an entry naming a missing file", { ...MANIFEST, styles: "web/missing.css" }, "entry"],
    ["an entry that is not a string", { ...MANIFEST, server: 3 }, "entry"],
  ];
  for (const [what, manifest, kind] of cases) {
    it(`refuses ${what}`, () => {
      const result = validateManifest(withManifest(manifest));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem.kind).toBe(kind);
    });
  }

  it("refuses a payload without plugin.json", () => {
    const result = validateManifest(
      payloadOf({ preflight: "", pluginDir: "pixso", files: { "a.txt": "a" } }),
    );
    expect(result.ok ? "ok" : result.problem.kind).toBe("missing");
  });

  it("accepts entries that are simply absent (they are optional)", () => {
    const { server: _s, web: _w, styles: _c, ...bare } = MANIFEST;
    expect(validateManifest(withManifest(bare)).ok).toBe(true);
  });
});

describe("the packed form", () => {
  it("round-trips every byte, and the recorded sha256 is the original's", () => {
    const vendor = scratch();
    writeFileSync(join(vendor, "preflight.mjs"), "console.log('OUR_ROOT=/x')");
    mkdirSync(join(vendor, "plugins", "pixso", "web"), { recursive: true });
    const css = new Uint8Array([0, 255, 10, 13, 128]);
    writeFileSync(join(vendor, "plugins", "pixso", "plugin.json"), JSON.stringify(MANIFEST));
    writeFileSync(join(vendor, "plugins", "pixso", "web", "styles.css"), css);

    const packed = packVendor(vendor);
    expect(packed.pluginDir).toBe("pixso");
    expect(packed.files.map((f) => f.path)).toEqual(["plugin.json", "web/styles.css"]);
    expect(packed.files[1]?.sha256).toBe(sha256(css));

    const payload = unpackPayload(JSON.parse(JSON.stringify(packed)));
    expect(new TextDecoder().decode(payload.preflight)).toBe("console.log('OUR_ROOT=/x')");
    expect([...(payload.files[1]?.bytes ?? [])]).toEqual([...css]);
  });

  it("refuses a payload whose bytes do not match the recorded sha256", () => {
    const vendor = scratch();
    writeFileSync(join(vendor, "preflight.mjs"), "x");
    mkdirSync(join(vendor, "plugins", "pixso"), { recursive: true });
    writeFileSync(join(vendor, "plugins", "pixso", "plugin.json"), "{}");
    const packed = packVendor(vendor);
    const zero = "0".repeat(64);
    const tampered = {
      ...packed,
      files: packed.files.map((f) => ({ path: f.path, size: f.size, data: f.data, sha256: zero })),
    };
    expect(() => unpackPayload(tampered)).toThrow(/corrupt/);
  });
});

function vendorWith(layout: (dir: string) => void): string {
  const dir = scratch();
  layout(dir);
  return dir;
}

describe("packVendor refuses a vendor tree fg cannot ship (the build-fail guard)", () => {
  it("no preflight.mjs", () => {
    const dir = vendorWith((d) => {
      mkdirSync(join(d, "plugins", "pixso"), { recursive: true });
      writeFileSync(join(d, "plugins", "pixso", "plugin.json"), "{}");
    });
    expect(() => packVendor(dir)).toThrow(/preflight.*missing/);
  });

  it("no plugins/ folder", () => {
    const dir = vendorWith((d) => writeFileSync(join(d, "preflight.mjs"), "x"));
    expect(() => packVendor(dir)).toThrow(/plugin folder is missing/);
  });

  it("a plugin folder without plugin.json", () => {
    const dir = vendorWith((d) => {
      writeFileSync(join(d, "preflight.mjs"), "x");
      mkdirSync(join(d, "plugins", "pixso"), { recursive: true });
    });
    expect(() => packVendor(dir)).toThrow(/plugin manifest.*missing/);
  });

  it("two plugin folders", () => {
    const dir = vendorWith((d) => {
      writeFileSync(join(d, "preflight.mjs"), "x");
      for (const id of ["pixso", "other"]) {
        mkdirSync(join(d, "plugins", id), { recursive: true });
        writeFileSync(join(d, "plugins", id, "plugin.json"), "{}");
      }
    });
    expect(() => packVendor(dir)).toThrow(/exactly one plugin folder/);
  });

  it("a symlink inside the plugin (ru-code wants real files)", () => {
    const dir = vendorWith((d) => {
      writeFileSync(join(d, "preflight.mjs"), "x");
      mkdirSync(join(d, "plugins", "pixso"), { recursive: true });
      writeFileSync(join(d, "plugins", "pixso", "plugin.json"), "{}");
      symlinkSync(join(d, "preflight.mjs"), join(d, "plugins", "pixso", "link.mjs"));
    });
    expect(() => packVendor(dir)).toThrow(/only regular files/);
  });
});

describe("packVendor enforces the repo's FULL forbidden-string set and FAILS THE BUILD on a hit (audit 2)", () => {
  const cleanVendor = (preflight: string, plugin: string): string =>
    vendorWith((d) => {
      writeFileSync(join(d, "preflight.mjs"), preflight);
      mkdirSync(join(d, "plugins", "pixso", "web"), { recursive: true });
      writeFileSync(join(d, "plugins", "pixso", "plugin.json"), JSON.stringify(MANIFEST));
      writeFileSync(join(d, "plugins", "pixso", "web", "index.mjs"), plugin);
    });

  it("a clean tree packs", () => {
    expect(() => packVendor(cleanVendor("ok", "export default 1;"))).not.toThrow();
  });

  it("a fake `?token=<16+ chars>` in a plugin file throws, naming the file and the pattern", () => {
    const fake = `https://example.invalid/hook?token=${"a1B2c3D4".repeat(3)}`;
    const dir = cleanVendor("ok", `export const url = "${fake}";`);
    expect(() => packVendor(dir)).toThrow(/web\/index\.mjs/);
    expect(() => packVendor(dir)).toThrow(/token=/);
    expect(() => packVendor(dir)).toThrow(VendorError);
  });

  it("`&token=` and a 16-char token also match; a 15-char one does not (the guard's {16,})", () => {
    expect(() => packVendor(cleanVendor("ok", `x?a=1&token=${"z".repeat(16)}`))).toThrow(
      /forbidden/,
    );
    expect(() => packVendor(cleanVendor("ok", `x?a=1&token=${"z".repeat(15)}`))).not.toThrow();
  });

  it("the preflight is scanned too", () => {
    const dir = cleanVendor(`// ?token=${"Q".repeat(20)}`, "ok");
    expect(() => packVendor(dir)).toThrow(/preflight\.mjs/);
  });

  it("EVERY literal of the guard set is refused in a plugin file, and named in the message", () => {
    expect(FORBIDDEN_LITERALS.length).toBeGreaterThanOrEqual(5);
    for (const literal of FORBIDDEN_LITERALS) {
      const dir = cleanVendor("ok", `// ${literal}`);
      expect(() => packVendor(dir), literal).toThrow(
        new RegExp(`web/index\\.mjs.*${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    }
  });

  it("EVERY pattern of the guard set is refused (the design-system marker too)", () => {
    expect(FORBIDDEN_PATTERNS.length).toBe(2);
    expect(() => packVendor(cleanVendor("ok", "const a = '_DNU_ST_x';"))).toThrow(/_DNU_ST_/);
  });

  it("the shared list is the repo guard's: the same literals the analyzer-report guard carries", () => {
    for (const literal of [
      "sbt-jenkins",
      "sigma.sbrf.ru",
      "generic-webhook-trigger",
      "@v-uik",
      "@sds-eng",
    ]) {
      expect(FORBIDDEN_LITERALS).toContain(literal);
    }
    expect(FORBIDDEN_PATTERNS.map(String)).toContain(String(/[?&]token=[A-Za-z0-9_-]{16,}/));
  });
});
