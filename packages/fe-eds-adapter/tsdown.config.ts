import { defineConfig } from "tsdown";

// LIBRARY build — deps stay external, exactly like the sibling library packages in
// `ru-code-packages` ("effect, react, @smart-tools/* etc. stay external (peer/deps), so they
// are not inlined and dedupe" — `ru-code-packages/packages/qwen-cli-catalog-core/tsdown.config.ts:4`).
// The inlining that makes the shipped artifact self-contained happens once, at the end of the
// chain, in `cli/tsdown.config.ts` — doing it here too would bundle `pixso-core` twice.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
