/**
 * NOT a test: the process `preflight.test.ts` interrupts. It runs `runPreflight` on a script given
 * in `F1_SCRIPT` (a fake SLOW preflight), exactly as `fg install` does, and says `finished` if the
 * preflight ever ends. `TMPDIR` points at the test's scratch dir, so the preflight's private temp
 * dir is observable from outside.
 */
import { runPreflight } from "../src/preflight.ts";

const script = process.env["F1_SCRIPT"] ?? "";
const run = await runPreflight(new TextEncoder().encode(script), {
  execPath: process.execPath,
  env: process.env,
});
process.stdout.write(`finished code=${String(run.code)}\n`);
