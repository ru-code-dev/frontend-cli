// `pnpm release`'s second half: publish the built bundle as `<repo root>/fg.mjs`.
//
// `pnpm -r run build` (the first half, in the root `release` script) rebuilds every package
// from clean — tsdown's `clean: true` wipes each `dist/` before it writes, so the file this
// script copies is always the artifact of the run that just happened, never a leftover.
//
// The copy exists because the product IS one self-contained zero-dependency file
// (`cli/tsdown.config.ts`): a user may take `fg.mjs` anywhere and run it with nothing
// installed beside it. Keeping that file at the repo root is how the owner hands it over,
// which is also why `.gitignore` carries `/fg.mjs` — the release thread commits it, a build
// never does. Plain `pnpm build` is unchanged and copies nothing.
//
// Node builtins only, and it refuses to guess: a missing source or a size outside the guard
// band is a loud failure, because a truncated or mysteriously tiny bundle that got copied
// anyway is exactly the artifact nobody notices until a user runs it.
//
// DESTINATION IS OVERRIDABLE — `--out <path>` or `FG_RELEASE_OUT` (the flag wins if both are
// given) — so `cli/tests/release.integration.test.ts` can run the REAL script against a scratch
// path instead of the repo root (f1-fixes item 5: the integration gate must not rewrite an
// owner's own release artifact by merely running). `pnpm release`, typed plain, is unchanged:
// neither is set, so `destination` is `<repo root>/fg.mjs` exactly as before.

import { copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "cli", "dist", "fg.mjs");

const outFlagIndex = process.argv.indexOf("--out");
const outFlagValue = outFlagIndex === -1 ? undefined : process.argv[outFlagIndex + 1];
const requestedDestination = outFlagValue ?? process.env["FG_RELEASE_OUT"];
const destination =
  requestedDestination === undefined
    ? join(repoRoot, "fg.mjs")
    : resolve(process.cwd(), requestedDestination);

/**
 * The guard band, in bytes. The bundle measured 20 115 307 B when this script was written, so
 * 18 MiB is comfortably under it and 25 MiB comfortably over: the band catches a build that
 * emitted a stub or one that silently swallowed a second copy of the analyzer closure, without
 * tripping on ordinary growth. `cli/tests/project-report.integration.test.ts` guards the same
 * number from the other side, against the built `dist/fg.mjs` itself.
 */
const MIN_BYTES = 18 * 1024 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;

const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

let bytes;
try {
  const stats = statSync(source);
  if (!stats.isFile()) fail(`${source} is not a file`);
  bytes = stats.size;
} catch {
  fail(`bundle not found at ${source} — \`pnpm -r run build\` must run first`);
}

if (bytes < MIN_BYTES || bytes > MAX_BYTES) {
  fail(
    `bundle is ${String(bytes)} bytes, outside the ${String(MIN_BYTES)}–${String(MAX_BYTES)} byte guard band`,
  );
}

copyFileSync(source, destination);

console.log(`release: ${destination} (${String(bytes)} bytes)`);
