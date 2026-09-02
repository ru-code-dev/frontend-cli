import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

/**
 * The adapter package's version, read HERE — in the build process — and substituted into this
 * package's output as a literal.
 *
 * `cli/tsdown.config.ts:6-16` documents the mechanism and the requirement it serves: the
 * shipped `dist/main.mjs` is one file a user may copy anywhere, so nothing in it may read a
 * `package.json` at runtime. `src/adapters.ts` documents the consuming half. Reading the
 * SIBLING package's manifest rather than this one's is the point — the number stamped into a
 * report must be the version of the artifacts that produced it.
 */
const { version: edsAdapterVersion } = JSON.parse(
  readFileSync(new URL("../fe-eds-adapter/package.json", import.meta.url), "utf8"),
) as { version: string };

// LIBRARY build — deps stay external, exactly like the sibling library packages in
// `ru-code-packages` ("effect, react, @smart-tools/* etc. stay external (peer/deps), so they
// are not inlined and dedupe" — `ru-code-packages/packages/qwen-cli-catalog-core/tsdown.config.ts:4`).
// The inlining that makes the shipped artifact self-contained happens once, at the end of the
// chain, in `cli/tsdown.config.ts` — doing it here too would bundle `pixso-core` twice.
export default defineConfig({
  define: { __FE_EDS_ADAPTER_VERSION__: JSON.stringify(edsAdapterVersion) },
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
