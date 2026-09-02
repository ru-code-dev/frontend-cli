/**
 * `fg.config.json` — FINDING IT, READING IT, AND REFUSING IT WHEN IT IS WRONG.
 *
 * The file is the user's VIEW over the rules, not a switch inside them: every rule still runs
 * and the result still carries every finding; the config decides what is counted and what is
 * shown (design D3/D11, `WORKFLOW/features/rule-config/plans/rc-design.md:20-22`). This module
 * is the boundary that turns a file on disk into the engine's `RuleConfig`, and it is the ONLY
 * place in this repo that knows the file's on-disk shape.
 *
 * ── DISCOVERY, IN THE ORDER D2 FIXES IT ──────────────────────────────────────────────────────
 *
 *   `--config <path>`  >  `<analysed project root>/fg.config.json`  >  `<cwd>/fg.config.json`
 *   >  built-in defaults
 *
 * The two implicit locations are tried in that order and the FIRST that exists wins — a project
 * that ships its own file is measured by its own rules even when the person running the command
 * has one of their own, which is the reading that makes a repository's config authoritative for
 * that repository. A missing file at either implicit location is not an error; a missing file at
 * the EXPLICIT one is, because the user named it (`--config` is a promise, not a hint).
 *
 * ── WHY THE VALIDATION IS HAND-WRITTEN AND NOT A ZOD SCHEMA ──────────────────────────────────
 *
 * `zod` is a dependency of `@smart-tools/fg-analyzer-engine`, not of this package, and the
 * manifests are frozen for this delivery. What the engine EXPORTS is enough: `RULE_LEVELS` is
 * the six levels and `findingCategorySchema.options` is the eight categories, both derived from
 * the same declarations the rules use, so the accepted vocabulary here still cannot drift from
 * the engine's. What a schema would have added is the error TEXT — and that text has to be
 * localized in two languages anyway (`strings.ts`), which a zod message is not. So each check
 * below names the offending key and the accepted values, in ru and en, and the result is a
 * refusal a user can act on rather than a path expression.
 *
 * ── `inherit`, AND WHY IT NEVER LEAVES THIS MODULE (design D13) ──────────────────────────────
 *
 * A file may write a seventh level, `"inherit"` — "no opinion at this scope" (`./names.ts`). It
 * is dropped HERE, while the resolved {@link RuleConfig} is built: an `inherit` rule row and an
 * `inherit` category simply are not written into it, and `default: "inherit"` resolves to the
 * built-in `"on"` because `default` is the last scope and has nothing to fall through to.
 *
 * Dropping rather than propagating is what keeps the amendment free: "absent" is ALREADY how the
 * resolved shape spells "no opinion", so `resolveLevel` skips that scope by construction
 * (`packages/fg-analyzer-engine/src/config/apply.ts:36-68`), and the engine, `applyRuleConfig`,
 * the payload and the dashboard keep exactly the six levels they were written against. The
 * embedded config a report carries therefore never contains the word `inherit` either, which is
 * why the dashboard needed no change to understand a file that uses it.
 *
 * ── WHAT IS AN ERROR AND WHAT IS A WARNING ───────────────────────────────────────────────────
 *
 * Malformed → usage error, exit 2 (D8): bad JSON, a level nobody defined, a category that does
 * not exist, an unknown key inside `analyzer`. Those are typos in a file the user wrote, and
 * every one of them means the run would have measured something other than what was asked.
 *
 * An unknown RULE ID → a warning, never a refusal (D8). One file has to serve a mixed set of
 * projects and design systems: a key naming an EDS rule is not a mistake in a repository that
 * does not use EDS, it is simply inert there. {@link unknownRuleIds} lists them so the user is
 * told, and the run continues.
 *
 * Top-level keys other than `$schema` and `analyzer` are IGNORED rather than rejected — the file
 * is `fg.config.json`, not `analyzer.config.json`, and the other `fg` commands are expected to
 * grow their own sections in it (design §2, `rc-design.md:57-59`).
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  FindingCategory,
  RuleCatalogEntry,
  RuleConfig,
  RuleLevel,
} from "@smart-tools/fg-analyzer-engine";
import { DEFAULT_RULE_CONFIG, findingCategorySchema } from "@smart-tools/fg-analyzer-engine";
import type { Localized } from "@smart-tools/fg-cli-kit";

import {
  configBadCategory,
  configBadIgnore,
  configBadLevel,
  configBadUiKit,
  configNotAnObject,
  configNotFound,
  configNotJson,
  configUnknownKey,
  configUnreadable,
} from "../strings.ts";
import type { FileLevel } from "./names.ts";
import { CONFIG_FILE, FILE_LEVELS, INHERIT_LEVEL } from "./names.ts";

/** The keys `analyzer` may hold. Anything else in there is a typo the user wants to hear about. */
const ANALYZER_KEYS = ["uiKit", "ignore", "default", "categories", "rules"] as const;

/**
 * What a successful load hands back: the resolved config the engine consumes, plus the two
 * `analyzer` fields that are NOT part of it.
 *
 * `uiKit` and `ignore` are deliberately outside {@link RuleConfig}: they are inputs to the RUN
 * (which design system, which files) rather than a view over findings, and the payload embeds
 * the config verbatim — a design-system name inside the embedded view would be a fact about the
 * invocation masquerading as a fact about the rules.
 */
export interface LoadedConfig {
  readonly config: RuleConfig;
  /**
   * EVERY `analyzer.rules` key exactly as the file wrote it, `inherit` rows included.
   *
   * `config.rules` cannot answer the unknown-id question: D13 drops every `inherit` row before
   * the resolved config is built, and `--init-config` writes every row `inherit` — so a typo'd
   * id in a generated file would never reach {@link unknownRuleIds} and the user would get no
   * warning about the one line they got wrong (V4 audit finding 6). This is the file's own list,
   * kept for that check and for nothing else.
   */
  readonly ruleKeys: readonly string[];
  /** The `analyzer.uiKit` value, when the file named one. Fallback for `--ui-kit` (D2). */
  readonly uiKit?: string | undefined;
  /** `analyzer.ignore`, forwarded to `analyzeProject` as extra walker patterns. */
  readonly ignore?: readonly string[] | undefined;
  /** The absolute path the config came from, or `null` for the built-in defaults. */
  readonly path: string | null;
}

/** Either a loaded config, or the one localized sentence that says why the file is unusable. */
export type ConfigOutcome =
  | { readonly ok: true; readonly loaded: LoadedConfig }
  | { readonly ok: false; readonly message: Localized };

/** The defaults, as a {@link LoadedConfig} — "no file" is a result, not an absence. */
export const DEFAULTS: LoadedConfig = { config: DEFAULT_RULE_CONFIG, ruleKeys: [], path: null };

export interface DiscoverConfigOptions {
  /** `--config <path>`, resolved against {@link DiscoverConfigOptions.cwd} when relative. */
  readonly explicit?: string | undefined;
  /**
   * The analysed project's root — the second place a file is looked for.
   *
   * `undefined` when the caller has not resolved the project yet, which is exactly the case
   * when `--config` was given: an explicit path is answered BEFORE anything is cloned, so a
   * typo in it does not cost the user a clone and a scan.
   */
  readonly projectRoot?: string | undefined;
  /** Where relative paths resolve — `CommandContext.cwd`, never `process.cwd()`. */
  readonly cwd: string;
}

/** `true` for the "the file simply is not there" error, which is the only one that is not fatal. */
function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Read one candidate. `undefined` means "not there, try the next place"; everything else is
 * either the text or a refusal.
 *
 * A file that EXISTS but cannot be read (a directory, a permission) is a refusal even at an
 * implicit location: silently falling through to the defaults would run the analysis under
 * rules the user believes are in force, and a report is worth less than nothing when its
 * configuration is a guess.
 */
async function readCandidate(
  path: string,
): Promise<{ readonly text: string } | { readonly message: Localized } | undefined> {
  try {
    return { text: await readFile(path, "utf8") };
  } catch (error) {
    if (isMissing(error)) return undefined;
    return {
      message: configUnreadable(path, error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * D2, executed. Never throws; every failure is a localized sentence the caller reports at exit 2.
 */
export async function discoverConfig(options: DiscoverConfigOptions): Promise<ConfigOutcome> {
  const explicit = options.explicit;
  if (explicit !== undefined && explicit !== "") {
    const path = isAbsolute(explicit) ? explicit : resolve(options.cwd, explicit);
    const read = await readCandidate(path);
    // The one place a missing file IS an error: the user named it.
    if (read === undefined) return { ok: false, message: configNotFound(path) };
    if ("message" in read) return { ok: false, message: read.message };
    return parseConfig(read.text, path);
  }

  const candidates = [
    ...(options.projectRoot === undefined ? [] : [resolve(options.projectRoot, CONFIG_FILE)]),
    resolve(options.cwd, CONFIG_FILE),
  ];
  for (const path of candidates) {
    const read = await readCandidate(path);
    if (read === undefined) continue;
    if ("message" in read) return { ok: false, message: read.message };
    return parseConfig(read.text, path);
  }
  return { ok: true, loaded: DEFAULTS };
}

/** A plain object, and not an array or a `null` — the three things `typeof x === "object"` mixes up. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every level a FILE may name — the engine's six plus `inherit` (D13). */
function isFileLevel(value: unknown): value is FileLevel {
  return typeof value === "string" && (FILE_LEVELS as readonly string[]).includes(value);
}

/**
 * `true` for the one level that is a statement about the FILE rather than about a finding.
 *
 * A type PREDICATE rather than a boolean, so `!isInherit(level)` narrows `FileLevel` to the
 * engine's `RuleLevel` at the two assignment sites below — the compiler, not a cast, is what
 * guarantees `inherit` cannot reach the resolved config.
 */
const isInherit = (level: FileLevel): level is typeof INHERIT_LEVEL => level === INHERIT_LEVEL;

function isCategory(value: string): value is FindingCategory {
  return (findingCategorySchema.options as readonly string[]).includes(value);
}

/**
 * The file's text → a {@link LoadedConfig}. Exported for the tier-1 suite, which drives every
 * refusal without a filesystem.
 *
 * `path` is carried into `config.source` verbatim and absolutely: the dashboard prints it in the
 * rules panel's header, and a relative path there would be relative to a directory the reader of
 * the HTML no longer has.
 */
export function parseConfig(text: string, path: string): ConfigOutcome {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      message: configNotJson(path, error instanceof Error ? error.message : String(error)),
    };
  }
  if (!isRecord(document)) return { ok: false, message: configNotAnObject(path, "") };

  const analyzerValue = document["analyzer"];
  // A file with no `analyzer` section is legal and means "defaults" — it is how the other `fg`
  // commands' sections will arrive without this one having to be written out.
  if (analyzerValue === undefined) {
    return {
      ok: true,
      loaded: {
        config: { ...DEFAULT_RULE_CONFIG, source: { kind: "file", path } },
        ruleKeys: [],
        path,
      },
    };
  }
  if (!isRecord(analyzerValue)) return { ok: false, message: configNotAnObject(path, "analyzer") };

  for (const key of Object.keys(analyzerValue)) {
    if (!(ANALYZER_KEYS as readonly string[]).includes(key)) {
      return { ok: false, message: configUnknownKey(path, key, ANALYZER_KEYS) };
    }
  }

  const defaultValue = analyzerValue["default"];
  if (defaultValue !== undefined && !isFileLevel(defaultValue)) {
    return { ok: false, message: configBadLevel(path, "analyzer.default", defaultValue) };
  }
  // `default` is the LAST scope: there is nothing below it to inherit from, so `inherit` there
  // means the built-in `"on"` (D13). Written as a fall-through to `DEFAULT_RULE_CONFIG.default`
  // rather than to a literal, so the built-in stays the engine's to decide.
  const resolvedDefault: RuleLevel =
    defaultValue === undefined || isInherit(defaultValue)
      ? DEFAULT_RULE_CONFIG.default
      : defaultValue;

  const categories: Partial<Record<FindingCategory, RuleLevel>> = {};
  const categoriesValue = analyzerValue["categories"];
  if (categoriesValue !== undefined) {
    if (!isRecord(categoriesValue)) {
      return { ok: false, message: configNotAnObject(path, "analyzer.categories") };
    }
    for (const [name, level] of Object.entries(categoriesValue)) {
      if (!isCategory(name)) {
        return { ok: false, message: configBadCategory(path, name, findingCategorySchema.options) };
      }
      if (!isFileLevel(level)) {
        return { ok: false, message: configBadLevel(path, `analyzer.categories.${name}`, level) };
      }
      // DROPPED, not recorded: an absent category is exactly what "resolve from `default`" means
      // in the resolved shape (D13).
      if (!isInherit(level)) categories[name] = level;
    }
  }

  const rules: Record<string, RuleLevel> = {};
  const ruleKeys: string[] = [];
  const rulesValue = analyzerValue["rules"];
  if (rulesValue !== undefined) {
    if (!isRecord(rulesValue))
      return { ok: false, message: configNotAnObject(path, "analyzer.rules") };
    for (const [id, level] of Object.entries(rulesValue)) {
      if (!isFileLevel(level)) {
        return { ok: false, message: configBadLevel(path, `analyzer.rules["${id}"]`, level) };
      }
      // The key is remembered whatever its level; only the LEVEL is dropped. Dropping the level
      // is the whole of D13 — the rule scope stays silent, so the category the user DID set is
      // the one that decides (D7) — but the KEY is what the unknown-id warning reads, and it has
      // to see the rows `--init-config` wrote too, or a typo in a generated file is silent
      // (V4 audit finding 6).
      ruleKeys.push(id);
      if (!isInherit(level)) rules[id] = level;
    }
  }

  const uiKitValue = analyzerValue["uiKit"];
  if (uiKitValue !== undefined && (typeof uiKitValue !== "string" || uiKitValue === "")) {
    return { ok: false, message: configBadUiKit(path) };
  }

  const ignoreValue = analyzerValue["ignore"];
  if (
    ignoreValue !== undefined &&
    (!Array.isArray(ignoreValue) || ignoreValue.some((entry) => typeof entry !== "string"))
  ) {
    return { ok: false, message: configBadIgnore(path) };
  }

  return {
    ok: true,
    loaded: {
      config: {
        default: resolvedDefault,
        categories,
        rules,
        source: { kind: "file", path },
      },
      ruleKeys,
      ...(uiKitValue === undefined ? {} : { uiKit: uiKitValue }),
      ...(ignoreValue === undefined ? {} : { ignore: ignoreValue as readonly string[] }),
      path,
    },
  };
}

/**
 * Every `rules` key this run cannot act on — D8's warning list.
 *
 * A key is KNOWN when it is a catalog id, a dot-prefix of one (`style.override` covers
 * `style.override.repaint`, design D4), or `<id>/<subrule>` where the subrule is one the rule
 * declares (design D5). Anything else names a rule this run has never heard of: a kit rule in a
 * project without that kit, or a typo. The two are indistinguishable from here, which is exactly
 * why this is a warning and not a refusal — and why the message lists the keys, so a typo is
 * visible on sight.
 *
 * The catalog is the one the RUN was built with (`ruleCatalog(adapter)`), so the same file
 * warns about `token.literal.color` in a project with no design system and stays quiet in one
 * that has EDS. That is the intended behaviour, not an inconsistency.
 *
 * THE LEVEL IS IRRELEVANT HERE. A row left at `inherit` is checked exactly like a row set to
 * `off`: `inherit` says "no opinion about this rule", not "no such rule", and a misspelled id is
 * a misspelled id whatever level follows it. It matters because `--init-config` writes every one
 * of its 41/62 rows `inherit` — checking only the rows that survived D13's drop left a typo in a
 * generated file completely silent (V4 audit finding 6).
 */
export function unknownRuleIds(
  /**
   * The FILE's `analyzer.rules` keys — {@link LoadedConfig.ruleKeys}, not `config.rules`.
   *
   * The resolved config has already lost every `inherit` row (D13), which is the level
   * `--init-config` writes for all of them, so checking it would have let a typo'd id in a
   * generated file pass unmentioned.
   */
  ruleKeys: readonly string[],
  catalog: readonly RuleCatalogEntry[],
): readonly string[] {
  const ids = new Set(catalog.map((entry) => entry.id));
  const subruleKeys = new Set(
    catalog.flatMap((entry) => entry.subrules.map((sub) => `${entry.id}/${sub.id}`)),
  );
  const unknown: string[] = [];
  for (const key of ruleKeys) {
    if (ids.has(key) || subruleKeys.has(key)) continue;
    // A dot-prefix of any catalog id addresses that id (D4), so it is known even though no
    // finding will ever carry it as its own `rule`.
    if ([...ids].some((id) => id.startsWith(`${key}.`))) continue;
    unknown.push(key);
  }
  return unknown;
}
