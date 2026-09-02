import { defineConfig } from "tsdown";

// LIBRARY build — deps stay external; the CLI bundle (`cli/tsdown.config.ts`) inlines once at
// the end of the chain. Same shape as every sibling library package.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  minify: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
});
