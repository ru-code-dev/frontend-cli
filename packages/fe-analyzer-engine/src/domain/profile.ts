import { z } from "zod";

/**
 * What the engine knows about the *shape* of the scanned project. Ported from
 * `hackathon2026/ds-analyzer/src/domain/profile.ts:1-156`.
 *
 * Two fields of that contract are dropped here, and both for the same reason: they describe
 * a UI kit this engine deliberately knows nothing about — `kitSources` (with its
 * `kitSourceSchema`, source lines 99-114) and `kitVersion`/`usesKit` (lines 130-137). The
 * `wrapped-upstream` member of that enum is where the hackathon's hardcoded vendor scope
 * lived (`ds-analyzer/src/scanner/profile/kit-sources.ts:37`), which this package may not
 * carry. Everything else is verbatim.
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
export type TsconfigInfo = z.infer<typeof tsconfigSchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
