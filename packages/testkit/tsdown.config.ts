import { defineConfig } from "tsdown";

// LIBRARY build, deps external — same shape as the other two `packages/*`
// (`ru-code-packages/packages/qwen-cli-catalog-core/tsdown.config.ts:4`). This package has no
// dependencies at all beyond node builtins, which is the property that keeps it out of the
// shipped bundle: nothing importable from here can drag a third party into `dist/main.mjs`.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
