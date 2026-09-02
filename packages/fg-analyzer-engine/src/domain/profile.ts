import { z } from "zod";

/**
 * What the engine knows about the *shape* of the scanned project. Ported from
 * `hackathon2026/ds-analyzer/src/domain/profile.ts:1-156`.
 *
 * `kitSources`/`kitVersion`/`usesKit` (source lines 99-114,130-137) are back, and they are the
 * one part of this record that needs a word. They say where design-system symbols enter *this*
 * project; they name no design system. Which packages count, and which upstream scope the kit
 * wraps, arrive from a {@link KitAdapter} (`scanner/profile/kit-sources.ts`), so the enum
 * member `wrapped-upstream` is a *kind*, not the hackathon's hardcoded vendor scope. With no
 * adapter the closure is never computed and all three stay empty/`null`/`false` — the profile
 * is not part of `AnalyzerResult`, so nothing a caller sees changes either way.
 *
 * Two properties of what remains are load-bearing:
 *
 *  - `limitations` is never empty by accident. A file that failed to parse appears here
 *    rather than silently contributing nothing, because a silent skip reads as "clean".
 *  - `styleSyntaxes` records what was actually found, so a project without SCSS never pays
 *    for the SCSS collector.
 */

export const packageManagerSchema = z.enum(["npm", "yarn", "pnpm", "bun", "unknown"]);

export const aliasSourceSchema = z.enum([
  "tsconfig",
  "vite",
  "webpack",
  "craco",
  "package-imports",
  "next",
  "babel-module-resolver",
  "ds-config",
]);

export const styleSyntaxSchema = z.enum([
  "css",
  "css-modules",
  "scss",
  "scss-modules",
  "less",
  "styled-components",
  "emotion",
  "inline-style",
  "jss",
  /**
   * A design literal sitting in a plain TypeScript string — a colour map, a padding table.
   * Not a style syntax as such, but the same decision written somewhere the CSS collectors
   * cannot see, and the rules treat it as having no property context.
   */
  "ts-literal",
  /**
   * `.css.ts` — style objects handed to vanilla-extract's `style`/`recipe`/`styleVariants`/
   * `globalStyle`, and to a kit's own factories built on them.
   *
   * A sixth dialect, and it earns the enum member for the reason the boundary in
   * `observations.ts` exists at all: it is the *only* place a token reference is not a string.
   * `color: tokens.sys.color.textPrimary` is a member expression, so the value a rule
   * reads carries no `var(--…)` to match on and the reference lives in
   * {@link StyleValue.reference} instead. Every rule stays syntax-free; the collector absorbs
   * the difference.
   */
  "vanilla-extract",
]);

export const limitationReasonSchema = z.enum([
  /** The file could not be parsed at all. */
  "parse-error",
  /** A style value depends on runtime data and has no literal to check. */
  "dynamic-styles",
  /** A construct the collectors knowingly do not model. */
  "unsupported-syntax",
  /** A module specifier could not be resolved to a file or a package. */
  "unresolved-import",
  /** A configuration file was found but could not be read statically. */
  "unreadable-config",
  /**
   * A rule could not run because a specification it depends on was not built.
   *
   * Retained from the source enum although no ported rule emits it: the wire contract stays
   * comparable with the hackathon's, and `a11y.focus.suppressed` is one collector change
   * away from needing a sibling of it.
   */
  "spec-unavailable",
  /**
   * A token reference was written as something other than a direct member path.
   *
   * `tokens.sys.color[role]` and ``padding: `${gap}px` `` are real design decisions this
   * collector cannot resolve to a token id. UNRESOLVED IS NOT CLEAN (design E5): the value is
   * still recorded, the finding is downgraded, and the file appears here — otherwise a project
   * that computes every reference reads as a project that references nothing.
   */
  "unresolved-token-reference",
  /**
   * The kit wraps no upstream library, so the rules that look for one had nothing to check.
   *
   * Emitted by an adapter, never by this package: a kit profile whose `wrappedUpstreamScope`
   * is `null` still registers its bypass rule (design E6, so one `fg.config.json` addresses
   * both kit versions) and must say that it emitted nothing on purpose.
   */
  "no-upstream",
  /**
   * A code or style file exceeded `walk.ts`'s {@link MAX_PARSEABLE_FILE_BYTES} (1 MiB) and was
   * skipped without being read — never parsed and never reported on otherwise (V6 audit finding
   * #7). Not `parse-error`: the file was never opened, so this is a deliberate skip rather than
   * a failed attempt, and the two are worth telling apart in a report's limitations list.
   */
  "file-too-large",
]);

export const limitationSchema = z.object({
  /** Project-relative POSIX path. */
  file: z.string(),
  line: z.number().int().positive().nullable(),
  reason: limitationReasonSchema,
  /**
   * One sentence naming the construct, in RUSSIAN — the repository's default output language.
   *
   * `reason` is the machine half and is localized by the reader (the dashboard's
   * `LIMITATION_LABEL`); `detail` is prose and is not, so it is written in the language every
   * other user-facing string in this tool defaults to. The details written before EDS 2.x are
   * English and stay English: they are pinned by goldens this package must keep byte-identical,
   * and rewriting them would be a parity change for a cosmetic gain. Everything added from that
   * change onwards is Russian, so that a limitations list mixing engine and adapter entries
   * reads as one voice (V6 audit finding #6).
   */
  detail: z.string(),
});

export const aliasSchema = z.object({
  /** Pattern as authored, e.g. `@/*`. */
  pattern: z.string().min(1),
  /** Project-relative POSIX targets, e.g. `["src/*"]`. */
  resolvesTo: z.array(z.string()),
  source: aliasSourceSchema,
});

export const tsconfigSchema = z.object({
  /** Project-relative POSIX path. */
  path: z.string(),
  /** Directory the config governs, project-relative; `""` for the root. */
  directory: z.string(),
  baseUrl: z.string().nullable(),
  /** Configs reached through `extends`, in resolution order. */
  extendsChain: z.array(z.string()),
});

/**
 * How a module comes to yield design-system symbols.
 *
 *  - `package` — the kit itself, as declared by the adapter;
 *  - `project-barrel` — a local module re-exporting one of those, transitively;
 *  - `wrapped-upstream` — the library the kit wraps. Reaching it directly is stepping around
 *    the design system, which is a finding rather than adoption.
 */
export const kitSourceSchema = z.object({
  /** Package name, or project-relative path for a local barrel. */
  specifier: z.string(),
  kind: z.enum(["package", "project-barrel", "wrapped-upstream"]),
  /** What made this module a kit source, sorted. */
  via: z.array(z.string()),
  /** Names it contributes; empty when they cannot be enumerated (a star re-export). */
  names: z.array(z.string()),
});

export const projectProfileSchema = z.object({
  $schema: z.literal("fg-analyzer-engine/project-profile@1"),
  /** Absolute path; the only absolute path in any record. */
  root: z.string(),
  /** Project-relative POSIX path that was requested, `""` for the whole project. */
  scope: z.string(),
  name: z.string().nullable(),
  packageManager: packageManagerSchema,
  monorepo: z.object({
    detected: z.boolean(),
    workspaces: z.array(z.string()),
  }),
  tsconfigs: z.array(tsconfigSchema),
  aliases: z.array(aliasSchema),
  /** Modules that yield design-system symbols; empty when no adapter is connected. */
  kitSources: z.array(kitSourceSchema),
  /** Declared version of the kit package, when the manifest names one. */
  kitVersion: z.string().nullable(),
  usesKit: z.boolean(),
  styleSyntaxes: z.array(styleSyntaxSchema),
  files: z.object({
    scanned: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    unparseable: z.number().int().nonnegative(),
    byExtension: z.record(z.string(), z.number().int().nonnegative()),
  }),
  limitations: z.array(limitationSchema),
});

export type PackageManager = z.infer<typeof packageManagerSchema>;
export type AliasSource = z.infer<typeof aliasSourceSchema>;
export type StyleSyntax = z.infer<typeof styleSyntaxSchema>;
export type LimitationReason = z.infer<typeof limitationReasonSchema>;
export type Limitation = z.infer<typeof limitationSchema>;
export type Alias = z.infer<typeof aliasSchema>;
export type KitSource = z.infer<typeof kitSourceSchema>;
export type TsconfigInfo = z.infer<typeof tsconfigSchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
