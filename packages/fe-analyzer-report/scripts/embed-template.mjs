// Step 3 of the package build: inline the built dashboard into the library bundle.
//
// `vite build dashboard` produces one self-contained HTML file; `tsdown` produces
// `dist/index.mjs` with a placeholder string where that HTML belongs (`src/template.ts`).
// This script swaps the two, so consumers get `REPORT_TEMPLATE` as a plain string export and
// the cli bundle inlines it like any other module — no runtime file read, no asset to copy.
//
// It refuses to guess: the placeholder must appear exactly once, and the HTML must carry the
// `ds-data` slot the renderer substitutes into.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(packageRoot, "dashboard", "dist", "index.html");
const bundlePath = join(packageRoot, "dist", "index.mjs");
const PLACEHOLDER = '"__FE_ANALYZER_REPORT_TEMPLATE__"';
const DS_DATA_SLOT = '<script type="application/json" id="ds-data">';

const fail = (message) => {
  console.error(`embed-template: ${message}`);
  process.exit(1);
};

const html = await readFile(htmlPath, "utf8").catch(() =>
  fail(`dashboard build not found at ${htmlPath} — run \`vite build dashboard\` first`),
);

if (!html.includes(DS_DATA_SLOT)) {
  fail("the dashboard build has no ds-data slot; rebuild it from dashboard/index.html");
}

const bundle = await readFile(bundlePath, "utf8").catch(() =>
  fail(`library bundle not found at ${bundlePath} — run \`tsdown\` first`),
);

const occurrences = bundle.split(PLACEHOLDER).length - 1;
if (occurrences !== 1) {
  fail(`expected exactly one template placeholder in dist/index.mjs, found ${occurrences}`);
}

await writeFile(
  bundlePath,
  bundle.replace(PLACEHOLDER, () => JSON.stringify(html)),
  "utf8",
);

console.log(`embed-template: inlined ${html.length} chars of dashboard into dist/index.mjs`);
