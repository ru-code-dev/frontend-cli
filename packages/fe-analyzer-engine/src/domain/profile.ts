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
]);

export const limitationSchema = z.object({
  /** Project-relative POSIX path. */
  file: z.string(),
  line: z.number().int().positive().nullable(),
  reason: limitationReasonSchema,
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
  $schema: z.literal("fe-analyzer-engine/project-profile@1"),
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
