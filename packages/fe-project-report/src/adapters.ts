/**
 * WHICH DESIGN SYSTEM TO MEASURE AGAINST — the registry, and how one gets picked.
 *
 * The engine knows nothing about design systems; it takes a `KitAdapter` object and reports
 * what that object teaches it (`packages/fe-analyzer-engine/src/adapter.ts:1-27`). Somebody
 * has to decide WHICH object, and this file is that somebody. It is the only module in the
 * repository that names an adapter package.
 *
 * THREE WAYS THE DECISION IS MADE, in this order:
 *
 *  1. `--ui-kit <name>` — the user said so. `none` is a name too, and it means "run the
 *     generic rules only" rather than "guess again". A name nobody registered is a usage
 *     error, answered with the list of accepted spellings (exit 2), never silently ignored.
 *  2. AUTODETECT — the project's own `package.json` is read and its dependencies matched
 *     against each adapter's `kitPackages`, the list that adapter publishes as "the packages
 *     that *are* the kit" (`packages/fe-eds-adapter/src/index.ts:105`). Exact names, not
 *     scope prefixes: `kitPackages` is the adapter's own declaration and inventing a broader
 *     rule here would mean this file, rather than the adapter, deciding what counts as the
 *     kit. All four dependency fields are read, because a design system is a `devDependency`
 *     of a library as often as a `dependency` of an app.
 *  3. NOTHING MATCHED — no adapter, and the run is exactly what it was before this file
 *     existed. That is the law: an unmatched project must get today's behaviour, byte for
 *     byte, and every branch below is written as "an adapter was found" for that reason.
 *
 * THE TIEBREAK exists for a state this repository cannot currently reach — there is one
 * adapter — and is implemented rather than deferred because the alternative is a rule nobody
 * writes down until two adapters collide and one of them wins by array order. When two or
 * more match the manifest, the project's own source is read and the winner is the one whose
 * packages are actually IMPORTED most often: a dependency that sits in `package.json` and is
 * never imported is a leftover, and the imports are the evidence of which kit the code is
 * written against. The walk is paid for only in the tie.
 *
 * NOTHING IS LOADED FROM DISK TO BUILD AN ADAPTER. `edsAdapter` is a static import, so its
 * artifacts are inside this bundle and the crash seam the port exists to remove
 * (`ds-analyzer/src/cli/run-analyze.ts:56`) has no way back in.
 */
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

import type { KitAdapter } from "@smart-tools/fe-analyzer-engine";
import type { CorpusProvenance, CorpusWarning, EdsArtifacts } from "@smart-tools/fe-eds-adapter";
import {
  createEdsAdapter,
  edsAdapter,
  EMBEDDED_VERSION,
  loadCorpus,
} from "@smart-tools/fe-eds-adapter";

/**
 * The adapter package's own version, substituted at BUILD time.
 *
 * Same mechanism and same reasoning as `cli/src/version.ts`: the shipped bundle must never
 * read a `package.json`, because it is one file a user may copy anywhere. The build configs
 * (`tsdown.config.ts` for the artifact, `vite.config.ts` so the suite sees the same literal)
 * read `packages/fe-eds-adapter/package.json` in the BUILD process and define this identifier
 * from it, so the version stamped into a report cannot drift from the package that produced
 * it. `typeof` guards the un-substituted case, which is legal JavaScript rather than a
 * ReferenceError at import time.
 */
declare const __FE_EDS_ADAPTER_VERSION__: string | undefined;

/**
 * WHICH SNAPSHOT AN ADAPTER RAN AGAINST, once the disk has been consulted.
 *
 * `AdapterEntry` below is what the REGISTRY holds — a static description that costs nothing to
 * build. This is what a RUN holds, and the difference between the two is the whole of
 * `--parse-ui-kit`: the registry entry says "the EDS adapter exists", the resolution says
 * "and this run measured against the corpus written on 2026-09-01, not the embedded one".
 */
export interface AdapterResolution {
  /** The adapter to hand the engine — rebuilt over an on-disk corpus when there was one. */
  readonly adapter: KitAdapter;
  readonly provenance: CorpusProvenance;
  /** Why an on-disk corpus was NOT used, when one was there but unusable. Never fatal. */
  readonly warnings: readonly CorpusWarning[];
}

/** One registered design system: what to type after `--ui-kit`, and what to hand the engine. */
export interface AdapterEntry {
  /** The `--ui-kit` spelling, and the `name` stamped into the payload. */
  readonly name: string;
  /** The adapter package's version. Distinct from the DESIGN SYSTEM's version — see below. */
  readonly version: string;
  readonly adapter: KitAdapter;
  /**
   * Consult the disk for a newer corpus of this design system.
   *
   * OPTIONAL, and the optionality is load-bearing twice over. A second adapter without a
   * regeneration command is a legal registry entry, and — more immediately — the tier-1 suites
   * build `AdapterEntry` literals to exercise autodetect and the tiebreak
   * (`tests/adapters.test.ts`); requiring a corpus loader from each of them would make every one
   * of those tests carry a filesystem.
   *
   * {@link resolveAdapter} supplies the answer when this is absent: the embedded snapshot, with
   * no version, which is exactly what an adapter that cannot be regenerated has.
   */
  readonly resolve?: ((env: NodeJS.ProcessEnv) => Promise<AdapterResolution>) | undefined;
}

/**
 * The resolution for an entry that has no corpus mechanism: its own adapter, embedded, silent.
 *
 * Written as a function rather than inlined at the two call sites so "no loader" has ONE meaning.
 */
export const resolveAdapter = async (
  entry: AdapterEntry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterResolution> =>
  entry.resolve === undefined
    ? { adapter: entry.adapter, provenance: { kind: "embedded", version: null }, warnings: [] }
    : await entry.resolve(env);

/**
 * THE REGISTRY. One entry today; adding a second is one line plus its static import.
 *
 * `name` is deliberately the adapter's own `id` rather than a second spelling to keep in
 * step — asserted in the tier-1 suite.
 */
export const ADAPTERS: readonly AdapterEntry[] = [
  {
    name: edsAdapter.id,
    version:
      typeof __FE_EDS_ADAPTER_VERSION__ === "string" ? __FE_EDS_ADAPTER_VERSION__ : "0.0.0-dev",
    adapter: edsAdapter,
    /**
     * THE ON-DISK OVERRIDE, and the one place the two snapshots meet.
     *
     * `loadCorpus` is total: it returns a corpus, or `null` plus warnings, and never throws
     * (`packages/fe-eds-adapter/src/corpus.ts` header). So this function has no failure branch
     * either — the worst case is the embedded snapshot and a sentence, which is what a run with
     * no `~/.fe/kits/eds/` has always done.
     *
     * `createEdsAdapter` is called ONLY when a corpus was found. Building it unconditionally
     * would re-run four `new …Spec()` constructors over four megabytes for every run that has no
     * corpus, which is nearly all of them; `edsAdapter` is that same work, done once at module
     * load and shared.
     */
    async resolve(env) {
      const loaded = await loadCorpus({ kit: edsAdapter.id, env });
      if (loaded.corpus === null || loaded.provenance === null) {
        return {
          adapter: edsAdapter,
          provenance: { kind: "embedded", version: EMBEDDED_VERSION },
          warnings: loaded.warnings,
        };
      }
      return {
        // The cast is the seam between the extractor's Zod-inferred shapes and the interfaces the
        // specs read. Both describe the same five files; `corpus.ts` has already parsed each one
        // against the schema its extractor validated it with, so this is the narrowing of a
        // checked value rather than an assertion about an unchecked one.
        adapter: createEdsAdapter(loaded.corpus as unknown as EdsArtifacts),
        provenance: loaded.provenance,
        warnings: loaded.warnings,
      };
    },
  },
];

/** `--ui-kit none`: run the generic rules and nothing else. A choice, not an absence. */
export const NO_ADAPTER = "none";

/** Every accepted `--ui-kit` value, for the help text and for the refusal message. */
export const adapterNames = (adapters: readonly AdapterEntry[] = ADAPTERS): readonly string[] => [
  ...adapters.map((entry) => entry.name),
  NO_ADAPTER,
];

/** What the selection decided, and — because the user is told — how it decided it. */
export type AdapterChoice =
  | { readonly kind: "adapter"; readonly entry: AdapterEntry; readonly how: "flag" | "autodetect" }
  | { readonly kind: "none"; readonly why: "disabled" | "no-match" }
  | { readonly kind: "unknown"; readonly value: string };

/** Dependency fields a design system can legitimately appear in. All four are read. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Every package the project declares a dependency on, from all four fields.
 *
 * Total: a missing, unreadable or malformed `package.json` yields an empty set rather than a
 * throw. Autodetection is a convenience — a project without a manifest is a project this tool
 * still has to analyse — so its failure mode is "no adapter matched", which is a state the
 * product already supports and reports.
 */
export const declaredDependencies = async (dir: string): Promise<ReadonlySet<string>> => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch {
    return new Set();
  }
  if (typeof manifest !== "object" || manifest === null) return new Set();

  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const value = (manifest as Record<string, unknown>)[field];
    if (typeof value === "object" && value !== null) {
      for (const name of Object.keys(value)) names.add(name);
    }
  }
  return names;
};

/** Directories never worth walking for import evidence; the engine's walker skips them too. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
]);

/** Extensions that can carry an import of a package: code, and stylesheets with `@import`. */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
  ".scss",
]);

/**
 * How many files are read before the tiebreak stops looking.
 *
 * A tiebreak is a heuristic over a ranking, not an audit: reading a whole monorepo to separate
 * two adapters that are already both plausible would cost more than the answer is worth. The
 * cap is stated rather than hidden because it means the count is a sample on a very large
 * project — and a sample is enough to rank two candidates.
 */
const TIEBREAK_FILE_LIMIT = 2000;

/** Every quoted string in a file — a superset of its import sources, which is what we want. */
const QUOTED = /["'`]([^"'`\n]{1,200})["'`]/g;

/**
 * How many times this project's source names one of `packages` as an import source.
 *
 * Deliberately syntax-free: every quoted string is compared against the package names, rather
 * than a set of import-statement patterns being maintained here. `import x from "p"`,
 * `require("p")`, `await import("p")`, `@import "p"` and a `vite` alias entry all count, and
 * none of them needs its own regex. The cost of the looseness is that a package name written
 * in a comment or a string literal counts too — acceptable for ranking two candidates, and
 * not acceptable for anything else, which is why this is used for nothing else.
 */
export const countKitImports = async (
  dir: string,
  packages: readonly string[],
): Promise<number> => {
  if (packages.length === 0) return 0;
  const wanted = new Set(packages);
  let seen = 0;
  let count = 0;

  const walk = async (current: string): Promise<void> => {
    if (seen >= TIEBREAK_FILE_LIMIT) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= TIEBREAK_FILE_LIMIT) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      seen += 1;
      let text: string;
      try {
        text = await readFile(join(current, entry.name), "utf8");
      } catch {
        continue;
      }
      for (const match of text.matchAll(QUOTED)) {
        const source = match[1];
        if (source === undefined) continue;
        // `@scope/pkg` and every subpath of it — `@scope/pkg/button` is still that package.
        if (wanted.has(source)) {
          count += 1;
          continue;
        }
        for (const name of wanted) {
          if (source.startsWith(`${name}/`)) {
            count += 1;
            break;
          }
        }
      }
    }
  };

  await walk(dir);
  return count;
};

/**
 * The `--ui-kit <name>` half of the decision, on its own.
 *
 * Exported because the command has to answer it BEFORE it clones anything: a misspelled
 * `--ui-kit` is a usage error, and a user who mistyped a name should not wait through a clone
 * and a full scan to be told. {@link selectAdapter} calls this same function, so there is one
 * statement of what the accepted values mean rather than two that can disagree.
 */
export function requestedAdapter(
  requested: string,
  adapters: readonly AdapterEntry[] = ADAPTERS,
): AdapterChoice {
  if (requested === NO_ADAPTER) return { kind: "none", why: "disabled" };
  const entry = adapters.find((candidate) => candidate.name === requested);
  return entry === undefined
    ? { kind: "unknown", value: requested }
    : { kind: "adapter", entry, how: "flag" };
}

export interface SelectAdapterOptions {
  /** The `--ui-kit` value, when the user gave one. */
  readonly requested?: string | undefined;
  /** The resolved project directory — where the manifest and the source are. */
  readonly dir: string;
  /** Injected by the tier-1 suite to drive autodetect and the tiebreak over a real registry. */
  readonly adapters?: readonly AdapterEntry[] | undefined;
}

/**
 * The decision. Never throws; an unusable project is "nothing matched", not a failure.
 *
 * @see the file header for the order and the reasoning behind each step.
 */
export async function selectAdapter(options: SelectAdapterOptions): Promise<AdapterChoice> {
  const adapters = options.adapters ?? ADAPTERS;
  const requested = options.requested;

  if (requested !== undefined && requested !== "") return requestedAdapter(requested, adapters);

  const dependencies = await declaredDependencies(options.dir);
  const matched = adapters
    .map((entry) => ({
      entry,
      declared: entry.adapter.kitPackages.filter((name) => dependencies.has(name)).length,
    }))
    .filter((candidate) => candidate.declared > 0);

  const first = matched[0];
  if (first === undefined) return { kind: "none", why: "no-match" };
  if (matched.length === 1) return { kind: "adapter", entry: first.entry, how: "autodetect" };

  // THE TIEBREAK. Ranked by imports actually written in this project, then by how much of the
  // adapter's package list the manifest declares, then by name — three keys so the result is
  // total and deterministic rather than "whichever the array happened to hold first".
  const ranked = await Promise.all(
    matched.map(async (candidate) => ({
      ...candidate,
      imports: await countKitImports(options.dir, candidate.entry.adapter.kitPackages),
    })),
  );
  ranked.sort(
    (left, right) =>
      right.imports - left.imports ||
      right.declared - left.declared ||
      left.entry.name.localeCompare(right.entry.name),
  );

  const winner = ranked[0];
  return winner === undefined
    ? { kind: "none", why: "no-match" }
    : { kind: "adapter", entry: winner.entry, how: "autodetect" };
}
