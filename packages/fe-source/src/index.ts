/**
 * `@smart-tools/fe-source` — the SHARED ACQUISITION package: one function that turns whatever
 * the user typed into a directory on disk, plus the four ways that can fail.
 *
 * It exists so that «where does the tree come from» is answered ONCE for every analyzer,
 * report and command that follows, rather than re-derived per feature. Design h4 sketched the
 * behaviour inside the feature package
 * (`WORKFLOW/features/hackathon-analys/plans/h4-design.md:50-53`); brief B1 pulled it out.
 *
 * TWO STANDING PROPERTIES, both structural rather than aspirational:
 *
 *   NO RUNTIME DEPENDENCIES. `node:child_process`, `node:fs/promises`, `node:os`, `node:path`,
 *   `node:util` — that is the entire import list of this package's `src/`. `package.json` has
 *   no `dependencies` key at all, so nothing this package pulls in can ever grow the shipped
 *   `dist/main.mjs` (design h4:56-64 is a bundle-size budget; this side of it stays at zero).
 *
 *   NO USER-FACING STRINGS. This is an internal core package. Every message a person reads is
 *   built by a FEATURE package, in ru and en, from `SourceError.code` — see `src/errors.ts`.
 *
 * The whole surface:
 *
 * ```ts
 * import { isSourceError, resolveSource } from "@smart-tools/fe-source";
 *
 * const src = await resolveSource(input);      // a path, or a git URL
 * try { await analyze(src.dir); } finally { await src.cleanup(); }
 * ```
 */
export {
  isSourceError,
  SourceError,
  type SourceErrorCode,
  type SourceErrorInit,
} from "./errors.ts";
export {
  isGitUrl,
  resolveSource,
  type ResolvedSource,
  type ResolveSourceOptions,
  type SourceKind,
} from "./resolve.ts";
