import type { ImportRecord, ReExportRecord } from "../../domain/observations.ts";
import type { KitSource } from "../../domain/profile.ts";
import { compareStrings, sortStrings } from "../../shared/sort.ts";
import { packageNameOf } from "../resolve.ts";

/**
 * Working out where a design system's symbols actually come from in *this* project. Ported
 * from `hackathon2026/ds-analyzer/src/scanner/profile/kit-sources.ts:1-196`.
 *
 * **The one behavioural change is that nothing here is hardcoded.** The source pinned both the
 * kit package list (`DEFAULT_KIT_PACKAGES`, line 29) and the wrapped-upstream scope
 * (`WRAPPED_UPSTREAM_SCOPE`, line 37) as module constants holding one vendor's names — h5 §2g
 * calls that second one "a bare hardcoded string constant with no config override at all… that
 * one piece is KIT-BOUND". Both arrive as parameters instead, from the adapter
 * (`KitAdapter.kitPackages` and `KitAdapter.wrappedUpstreamScope`), so this file carries no
 * vendor knowledge. With no adapter
 * the closure is never computed at all and every element's `kitComponent` stays `null`, which
 * is exactly the behaviour every existing test was written against.
 *
 * Why a closure rather than a specifier match: teams routinely wrap the design system.
 *
 *   // src/shared/ui/index.ts
 *   export { Button, Modal } from '<the kit>'
 *
 *   // everywhere else
 *   import { Button } from '@/shared/ui'
 *
 * A scanner that misses this concludes the project does not use the kit and reports a flawless
 * score for a codebase full of misused components — the worst possible failure mode, because it
 * is silent and flattering. So kit sources are computed as a transitive closure: a module that
 * re-exports a kit source is itself a kit source, repeated to a fixed point. Barrels are
 * commonly two or three levels deep, which is why one pass is not enough.
 */

/** Every name a module contributes, or `star` when they cannot be enumerated. */
interface SourceEntry {
  readonly kind: KitSource["kind"];
  readonly names: Set<string>;
  star: boolean;
  readonly via: Set<string>;
}

const isKitPackageSpecifier = (specifier: string, kitPackages: readonly string[]): boolean => {
  const packageName = packageNameOf(specifier);

  return packageName !== null && kitPackages.includes(packageName);
};

/**
 * Key a re-export target is known by.
 *
 * Local modules are keyed by their project path so that two different specifiers for the same
 * file (`./index.js`, `@/shared/ui`) collapse to one entry. Packages are keyed by package name,
 * so a deep import into the kit still counts as the kit.
 */
const targetKeyOf = (record: {
  specifier: string;
  resolution: { file: string | null };
}): string | null => record.resolution.file ?? packageNameOf(record.specifier);

export interface KitClosureInput {
  readonly reExports: readonly ReExportRecord[];
  readonly imports: readonly ImportRecord[];
  /** Packages that *are* the kit, from the adapter. */
  readonly kitPackages: readonly string[];
  /**
   * Scope of the upstream library the kit wraps; `null` when it wraps nothing.
   *
   * Importing it directly is not "using the kit" — it is stepping around it — so these are
   * tracked as a separate kind and drive an adapter's bypass rule rather than adoption.
   */
  readonly wrappedUpstreamScope: string | null;
}

export interface KitClosure {
  readonly sources: KitSource[];
  /** Lookup used to classify a JSX element: module key → kit component names. */
  readonly index: ReadonlyMap<
    string,
    { readonly names: ReadonlySet<string>; readonly star: boolean }
  >;
  readonly usesKit: boolean;
}

/**
 * Computes the closure of modules that yield kit symbols.
 *
 * Iterates until nothing new is added. Convergence is guaranteed because the candidate set is
 * the finite set of modules observed in the project, and entries are only ever added.
 */
export const computeKitClosure = (input: KitClosureInput): KitClosure => {
  const kitPackages = [...input.kitPackages];
  const upstreamScope = input.wrappedUpstreamScope;
  const sources = new Map<string, SourceEntry>();

  const isWrappedUpstream = (specifier: string): boolean =>
    upstreamScope === null
      ? false
      : (packageNameOf(specifier)?.startsWith(`${upstreamScope}/`) ?? false);

  const seed = (key: string, kind: KitSource["kind"], via: string): SourceEntry => {
    const existing = sources.get(key);
    if (existing) {
      existing.via.add(via);
      return existing;
    }

    const entry: SourceEntry = { kind, names: new Set(), star: true, via: new Set([via]) };
    sources.set(key, entry);
    return entry;
  };

  // Seed with the configured packages. A package's export list cannot be enumerated without
  // installing it, so every kit package is a star source.
  for (const specifier of [...input.reExports, ...input.imports].map(
    (record) => record.specifier,
  )) {
    if (isKitPackageSpecifier(specifier, kitPackages)) {
      seed(packageNameOf(specifier) ?? specifier, "package", "declared kit package");
    } else if (isWrappedUpstream(specifier)) {
      seed(packageNameOf(specifier) ?? specifier, "wrapped-upstream", "wrapped by the kit");
    }
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const reExport of input.reExports) {
      const targetKey = targetKeyOf(reExport);
      const target = targetKey === null ? undefined : sources.get(targetKey);

      if (!target || target.kind === "wrapped-upstream") {
        // Re-exporting the upstream directly does not make a module a kit source; it makes it
        // a bypass, which a different rule reports.
        continue;
      }

      const existing = sources.get(reExport.file);
      const contributed = reExport.star
        ? { star: true, names: [] as string[] }
        : {
            star: false,
            names: reExport.names.filter((name) => !name.typeOnly).map((name) => name.exported),
          };

      if (!existing) {
        sources.set(reExport.file, {
          kind: "project-barrel",
          names: new Set(contributed.names),
          star: contributed.star,
          via: new Set([targetKey ?? reExport.specifier]),
        });
        changed = true;
        continue;
      }

      const before = existing.names.size;
      for (const name of contributed.names) {
        existing.names.add(name);
      }
      if (contributed.star && !existing.star) {
        // The source replaced the entry object here (`kit-sources.ts:147`); mutating the field
        // is the same state, and keeps the `via` set the loop below reads from one object.
        existing.star = true;
        changed = true;
      }
      if (existing.names.size !== before) {
        changed = true;
      }
      existing.via.add(targetKey ?? reExport.specifier);
    }
  }

  const index = new Map<string, { names: ReadonlySet<string>; star: boolean }>();
  for (const [key, entry] of sources) {
    index.set(key, { names: entry.names, star: entry.star });
  }

  const list: KitSource[] = [...sources.entries()]
    .map(([specifier, entry]) => ({
      specifier,
      kind: entry.kind,
      via: sortStrings(entry.via),
      names: sortStrings(entry.names),
    }))
    .sort((left, right) => compareStrings(left.specifier, right.specifier));

  return {
    sources: list,
    index,
    usesKit: list.some((source) => source.kind !== "wrapped-upstream"),
  };
};

/**
 * Resolves a JSX element name to the kit component it is, if any.
 *
 * @param moduleKey Project path of the resolved module, or its package name.
 * @param exportedName Name as exported by the module.
 */
export const kitComponentFor = (
  closure: KitClosure,
  moduleKey: string | null,
  exportedName: string,
): string | null => {
  if (moduleKey === null) {
    return null;
  }

  const entry = closure.index.get(moduleKey);
  if (!entry) {
    return null;
  }

  return entry.star || entry.names.has(exportedName) ? exportedName : null;
};

/** The closure a run with no adapter gets: empty, so `kitComponentFor` always answers `null`. */
export const EMPTY_KIT_CLOSURE: KitClosure = { sources: [], index: new Map(), usesKit: false };
