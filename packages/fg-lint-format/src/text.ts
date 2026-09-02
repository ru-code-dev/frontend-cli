/**
 * Path and string plumbing shared by the three formatters.
 *
 * NOTHING here imports `node:path`, and that is deliberate rather than an oversight of the
 * zero-dependency rule. `path.join` produces `\` separators on Windows, so a report generated
 * on a developer's Windows box and one generated in Linux CI would differ in every location
 * of every finding — and SARIF, whose `artifactLocation.uri` is a URI and not a path, would
 * be wrong on one of the two. Joining with `/` by hand makes the output a property of the
 * INPUT only, which is what "deterministic" has to mean for a format consumed by tooling.
 */

/** Windows separators to URI/POSIX ones. SARIF requires it; the text formats read better. */
export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * `projectRoot` + `finding.file` as one absolute POSIX-ish path, for the two human formats.
 *
 * `./` prefixes and a leading separator on the relative half are dropped so a finding whose
 * `file` arrived as `./src/a.tsx` or `/src/a.tsx` lands on the same line as one that arrived
 * as `src/a.tsx`; a trailing separator on the root is dropped for the same reason. A drive
 * letter survives untouched: `C:\p` + `src\a.tsx` → `C:/p/src/a.tsx`.
 */
export function absolutePathOf(projectRoot: string, file: string): string {
  const root = toPosix(projectRoot).replace(/\/+$/u, "");
  const relative = toPosix(file).replace(/^\.\//u, "").replace(/^\/+/u, "");
  return relative === "" ? root : `${root}/${relative}`;
}

/**
 * `projectRoot` as the `file://` URI SARIF's `originalUriBaseIds` wants, with the trailing
 * slash the spec requires of a base URI (without it a relative `uri` resolves against the
 * PARENT directory, which silently moves every result one level up).
 *
 * Percent-encoding is deliberately NOT applied: the value must round-trip back to the path
 * the user typed when a tool prints it, and encoding is the consuming tool's business.
 */
export function projectRootUri(projectRoot: string): string {
  const root = toPosix(projectRoot).replace(/^\/+/u, "").replace(/\/+$/u, "");
  return `file:///${root}/`;
}

/**
 * Collapse embedded newlines so a message cannot forge a second line.
 *
 * `compact` is a LINE format: one finding is one row, and a value out of the analysed project
 * that carried a newline would print a second row — for a file nobody analysed, at a line
 * number nobody found. Rules do not write multi-line text today; this makes it impossible for
 * one to break the layout tomorrow. `compact.ts` composes it with `stripAnsi` (`sanitize`),
 * because an escape is the other way a value can forge output.
 */
export function singleLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/gu, " ");
}

/**
 * Drop a sentence-final period, because one at the end of a table cell is noise.
 *
 * Transcribed from ESLint's stylish
 * (`node_modules/.pnpm/eslint@9.39.5_jiti@2.7.0/node_modules/eslint/lib/cli-engine/formatters/stylish.js:67`,
 * `message.message.replace(/([^ ])\.$/u, "$1")`), including the `[^ ]` guard that leaves
 * `"…  ."` alone. `stylish` is gone (design U1) and `compact` prints LABELS, which are noun
 * phrases and carry no period to strip — so this has no caller inside the package today. It
 * stays exported because it is part of the published surface and costs one line; a formatter
 * that ever prints a rule's own sentence will want exactly this.
 */
export function stripTrailingPeriod(text: string): string {
  return text.replace(/([^ ])\.$/u, "$1");
}
