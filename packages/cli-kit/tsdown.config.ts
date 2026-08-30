import { defineConfig } from "tsdown";

// A plain LIBRARY build, the shape the `qwen-cli-*` packages use rather than the
// single-file-bundle shape (`ru-code-packages/packages/qwen-cli-catalog-core/tsdown.config.ts:4`):
// nothing is inlined here, because the only consumer that must be self-contained is `cli`,
// and its own tsdown config inlines every `@smart-tools/*` package at the end of the chain
// (`cli/tsdown.config.ts`). This package has no dependencies to inline anyway.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
