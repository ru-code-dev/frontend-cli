import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The dashboard is built once, when `ds-analyzer` is set up, and then never again.
 *
 * Analysing a project only substitutes a JSON payload into the produced HTML, so a
 * consumer needs no Node toolchain at all — which is the difference between a tool a team
 * runs and a tool a team installs.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    // Everything inlined; the output is one file opened by double-clicking.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
