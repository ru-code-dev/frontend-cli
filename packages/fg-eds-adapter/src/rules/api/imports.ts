import {
  isDeepPackageImport,
  packageNameOf,
  type Limitation,
  type RawFinding,
  type Rule,
  type RuleContext,
} from "@smart-tools/fg-analyzer-engine";

import type { KitSpec } from "../../kit/spec.ts";
import type { KitContext } from "../kit-context.ts";

/**
 * Import-level rules. Three ways to reach around the design system's front door. Ported verbatim
 * from `hackathon2026/ds-analyzer/src/rules/api/imports.ts:1-219`.
 *
 * `import.bypass` — importing the wrapped upstream directly. The kit wraps that package, and the
 * wrapper is where the theme, the variant mapping and the accessibility fixes live. The raw
 * component renders, so nothing looks broken; it simply is not the design system.
 *
 * `import.internal` — reaching into the kit's own `src/…`. Works today, survives bundling, and
 * breaks on any release that moves a file. The public barrel exists precisely so that file
 * layout can change.
 *
 * `api.dnu` — importing from the module the kit named "do not use"; there is no interpretation
 * to make. h5 §1c calls this rule KIT-BOUND with no seam, because the marker below is a bare
 * literal rather than anything derived from an artifact. That verdict is why it lives here and
 * nowhere else: an adapter is the one place a naming convention private to one design system is
 * allowed to be hardcoded.
 *
 * ## Two facts about EDS 2.x that these three rules had to learn
 *
 * **There is no upstream.** `@v-uik` appears in three commented-out lines of the whole v2
 * repository (S1 break V10), so `import.bypass` has nothing to match. It stays REGISTERED —
 * design E6, so one `fg.config.json` addresses both kit versions and the catalog keeps its 32
 * ids — and declares a `no-upstream` LIMITATION instead of quietly reporting zero. Zero findings
 * and "there was nothing to check" look identical in a report otherwise, and only one of them is
 * good news. `api.dnu` is in the same position (`_DNU_ST_` occurs in 0 v2 files) but needs no
 * limitation: its marker is a naming convention, and a kit that never uses it has nothing to
 * declare.
 *
 * **Subpaths can be public.** `@sds-eng/base-exp` declares 33 subpath `exports` — `./Button`,
 * `./theme`, `./hooks` — and the kit's own `kit-exp` imports through them (S1 break V2). Under
 * the rule as it stood, every one of those was an `error`, so a correct v2 project would have
 * read as a wall of them. The declared keys travel in the components artifact, and only paths
 * OUTSIDE them — `/dist/…`, `/src/…` — are findings.
 */

/**
 * `true` when the specifier reaches past what the package declares as public.
 *
 * The exports table is matched the way Node matches it: an exact key, or a `*` pattern's prefix.
 * A package that declares NO subpaths (EDS 1.x, and `@sds-eng/kit-exp`, which publishes only
 * `"."`) leaves the answer at "any subpath is internal", which is the behaviour this rule has
 * always had.
 */
const reachesPastExports = (kit: KitSpec, packageName: string, specifier: string): boolean => {
  const subpath = specifier.slice(packageName.length + 1);
  const declared = kit.declaredExports(packageName);

  return !declared.some((key) =>
    key.endsWith("*") ? subpath.startsWith(key.slice(0, -1)) : subpath === key,
  );
};

const DNU_MARKER = "_DNU_ST_";

const kitPackageNames = (context: RuleContext): string[] =>
  context.profile.kitSources
    .filter((source) => source.kind === "package")
    .map((source) => source.specifier);

/**
 * `{ imported, local }` back to source text, aliases intact. Dropping an alias renames a binding
 * the rest of the file still references — the fix would compile the import and break every use
 * site.
 */
const bindingText = (name: { imported: string; local: string; typeOnly: boolean }): string => {
  const base = name.imported === name.local ? name.imported : `${name.imported} as ${name.local}`;
  return name.typeOnly ? `type ${base}` : base;
};

/**
 * Rebuilds the import against the public barrel, or `null` when that cannot be done
 * mechanically: a default or namespace import has no knowable barrel equivalent — the symbol's
 * public name is not derivable from the deep path.
 */
const barrelImport = (
  record: {
    names: { imported: string; local: string; typeOnly: boolean }[];
    defaultImport: string | null;
    namespaceImport: string | null;
    typeOnly: boolean;
  },
  packageName: string,
): string | null => {
  if (record.defaultImport !== null || record.namespaceImport !== null) {
    return null;
  }
  if (record.names.length === 0) {
    return `import '${packageName}'`;
  }
  const keyword = record.typeOnly ? "import type" : "import";
  return `${keyword} { ${record.names.map(bindingText).join(", ")} } from '${packageName}'`;
};

export const bypassImportRule = ({ kit }: KitContext): Rule => ({
  id: "import.bypass",
  category: "api",
  description: "Прямой импорт пакета, который кит оборачивает",
  label: { ru: "Импорт в обход кита", en: "Import bypassing the kit" },
  severity: "error",
  /**
   * The kit wraps nothing, so this rule checked nothing. Said once, at the project level.
   *
   * Not once per file and not once per import: the gap is a property of the DESIGN SYSTEM, and
   * repeating it per file would drown the limitations list in one fact.
   */
  limitations: (): Limitation[] =>
    kit.profile.upstreamScope === null
      ? [
          {
            file: ".",
            line: null,
            reason: "no-upstream",
            detail:
              `${kit.profile.displayName} ничего не оборачивает: правило import.bypass ` +
              "зарегистрировано, но проверять ему нечего — совпадений не будет ни в одном проекте.",
          },
        ]
      : [],
  run: (context: RuleContext): RawFinding[] => {
    const findings: RawFinding[] = [];

    for (const record of context.observations.imports) {
      const upstream = context.profile.kitSources.find(
        (source) =>
          source.kind === "wrapped-upstream" &&
          source.specifier === packageNameOf(record.specifier),
      );

      if (!upstream) {
        continue;
      }

      const wrapper = kit.componentWrapping(upstream.specifier);
      const kitPackage = kitPackageNames(context)[0] ?? "@sds-eng/base";

      // Mechanically safe only when the import is exactly the wrapped component under its own
      // name (alias allowed — it is preserved): then every use site keeps working. Extra names,
      // default or namespace imports need a human or the AI stage.
      const soleName = record.names.length === 1 ? record.names[0] : undefined;
      const fixable =
        wrapper !== null &&
        soleName?.imported === wrapper &&
        record.defaultImport === null &&
        record.namespaceImport === null;
      const replacement =
        !fixable || soleName === undefined
          ? null
          : `${record.typeOnly || soleName.typeOnly ? "import type" : "import"} { ${wrapper}${soleName.local === wrapper ? "" : ` as ${soleName.local}`} } from '${kitPackage}'`;

      findings.push({
        rule: "import.bypass",
        subkind: null,
        category: "api",
        severity: "error",
        confidence: 1,
        file: record.file,
        line: record.line,
        column: record.column,
        actual: record.specifier,
        expected:
          wrapper === null
            ? null
            : {
                token: null,
                cssVar: null,
                component: wrapper,
                value: replacement ?? `import { ${wrapper} } from '${kitPackage}'`,
              },
        why:
          wrapper === null
            ? `${record.specifier} — это библиотека, поверх которой построен кит. Импорт мимо кита теряет темизацию и правки доступности.`
            : `${record.specifier} обёрнут в ките как ${wrapper}. Прямой импорт отдаёт компонент без темы кита, без маппинга вариантов и без его правок доступности.`,
        note:
          wrapper !== null && !fixable
            ? "Автозамена не предлагается: импортируется не только обёрнутый компонент — замену имён должен проверить человек."
            : null,
        rootCause: null,
        appliedTo: null,
        autoFixable: fixable,
        needsAgent: wrapper !== null && !fixable,
        candidates: [],
        impactKey: `import.bypass:${record.specifier}`,
        replaceWith: replacement,
        replaceScope: "line",
      });
    }

    return findings;
  },
});

export const internalImportRule = ({ kit }: KitContext): Rule => ({
  id: "import.internal",
  category: "api",
  description: "Импорт внутренним путём в обход публичной бочки",
  label: { ru: "Импорт внутренним путём", en: "Import through an internal path" },
  severity: "error",
  run: (context: RuleContext): RawFinding[] => {
    const packages = kitPackageNames(context);
    const findings: RawFinding[] = [];

    for (const record of context.observations.imports) {
      const packageName = packageNameOf(record.specifier);

      if (
        packageName === null ||
        !packages.includes(packageName) ||
        !isDeepPackageImport(record.specifier) ||
        record.specifier.includes(DNU_MARKER) ||
        !reachesPastExports(kit, packageName, record.specifier)
      ) {
        continue;
      }

      const replacement = barrelImport(record, packageName);

      findings.push({
        rule: "import.internal",
        subkind: null,
        category: "api",
        severity: "error",
        confidence: 1,
        file: record.file,
        line: record.line,
        column: record.column,
        actual: record.specifier,
        expected: {
          token: null,
          cssVar: null,
          component: null,
          value: replacement ?? `import { … } from '${packageName}'`,
        },
        why: `${record.specifier} лезет во внутренности пакета. Публичная бочка ${packageName} существует ровно затем, чтобы раскладка файлов могла меняться между релизами.`,
        note:
          replacement === null
            ? "Автозамена не предлагается: default- или namespace-импорт из внутреннего пути — публичное имя символа отсюда не выводится."
            : null,
        rootCause: null,
        appliedTo: null,
        autoFixable: replacement !== null,
        needsAgent: replacement === null,
        candidates: [],
        impactKey: `import.internal:${packageName}`,
        replaceWith: replacement,
        replaceScope: "line",
      });
    }

    return findings;
  },
});

export const doNotUseImportRule = (_kit: KitContext): Rule => ({
  id: "api.dnu",
  category: "api",
  description: "Импорт из модуля, помеченного китом как «не использовать»",
  label: { ru: "Импорт запрещённого модуля", en: "Import of a forbidden module" },
  severity: "error",
  run: (context: RuleContext): RawFinding[] =>
    context.observations.imports
      .filter((record) => record.specifier.includes(DNU_MARKER))
      .map((record) => ({
        rule: "api.dnu",
        subkind: null,
        category: "api" as const,
        severity: "error" as const,
        confidence: 1,
        file: record.file,
        line: record.line,
        column: record.column,
        actual: record.specifier,
        expected: null,
        why: `${DNU_MARKER} — собственная пометка кита «do not use». Содержимое модуля может исчезнуть в любом релизе без депрекации.`,
        note: "Замены нет: нужно обсуждать с командой дизайн-системы, что именно отсюда используется и чем это заменить.",
        rootCause: null,
        appliedTo: null,
        autoFixable: false,
        needsAgent: true,
        candidates: [],
        impactKey: `api.dnu:${record.specifier}`,
        replaceWith: null,
      })),
});
