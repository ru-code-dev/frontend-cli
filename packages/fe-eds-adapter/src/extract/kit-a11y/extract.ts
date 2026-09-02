import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { KitPaths } from "../paths.ts";
import type { ComponentsArtifact } from "../domain/components.ts";
import type { KitA11yArtifact, KitPattern, SpacingStep } from "../domain/kit-a11y.ts";
import { compareStrings, sortStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Reads what `@v-uik` actually does about accessibility and spacing.
 *
 * The kit wraps `@v-uik` for 58 of its 61 components, which means the behaviour worth
 * recommending — the arrow-key navigation, the focus trap, the `aria-controls` wiring —
 * is not in the kit's own sources at all. An analyzer that only read the kit would be
 * recommending components whose accessibility it had never seen.
 *
 * Only compiled `dist/` output ships, so this reads JavaScript rather than TypeScript. That
 * is a coarser instrument than the AST work elsewhere in this project, and it is used
 * accordingly: the extractor gathers *evidence that something is handled*, never a claim
 * that it is handled correctly. A role that appears in the bundle is rendered somewhere; it
 * is not proof that it is rendered on the right element. Rules must phrase findings as
 * "the kit's equivalent handles this and yours does not", which the evidence supports,
 * rather than "the kit is accessible", which it does not.
 */

const ROLE_PATTERN = /role:\s*['"]([a-z]+)['"]/g;
const ARIA_PATTERN = /['"](aria-[a-z]+)['"]/g;

/** Mirrors the collector's list so both sides of a comparison mean the same thing. */
const KEY_PATTERN =
  /['"](ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Enter|Escape|Tab|Delete|Backspace|Spacebar)['"]/g;

/** Names that only appear when a component moves focus deliberately. */
const FOCUS_HINTS = [
  "findFocusableSibling",
  "focusTrap",
  "FocusLock",
  "restoreFocus",
  "useFocus",
  "tabbable",
];

/**
 * Packages that carry no component of their own.
 *
 * Excluding them is not tidiness, it is correctness. `@v-uik/base` is a barrel over the
 * whole library and `@v-uik/utils` holds the shared keyboard helpers, so a component that
 * merely lists them among its dependencies would inherit the union of every role and key in
 * the library. That produced a first draft claiming `Spinner` handles arrow keys and
 * `Escape` — a confident, checkable, wrong statement, and the kind that destroys trust in
 * everything printed next to it.
 */
const INFRASTRUCTURE_PACKAGES: ReadonlySet<string> = new Set([
  "@v-uik/base",
  "@v-uik/common",
  "@v-uik/container",
  "@v-uik/hooks",
  "@v-uik/portal",
  "@v-uik/theme",
  "@v-uik/typography",
  "@v-uik/utils",
]);

/** `BrowserTabs` → `browser-tabs`, matching the upstream's directory naming. */
const toPackageName = (component: string): string =>
  component
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

const SPACING_PATTERN =
  /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Bottom|Left|Right|Inline|Block)?:\s*['"]?(\d{1,3})(?:px)?['"]?/g;

/**
 * A step must carry at least this share of all spacing declarations to count as one.
 *
 * The kit's distribution is strongly bimodal — 0, 8, 4 and 16 account for most of it, then
 * a long tail of one-offs like `11px` and `61px`. Those are the upstream's own accidents,
 * and promoting them into a published scale would mean blessing exactly the values a
 * consumer should be warned about.
 */
const MIN_STEP_SHARE = 0.01;

/** The grid the upstream's spacing sits on; 4px is the base every real step is a multiple of. */
const SPACING_GRID_BASE = 4;

const listFilesRecursively = (directory: string, suffix: string): string[] => {
  const found: string[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries.sort(compareStrings)) {
      const full = join(current, entry);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }

      if (isDirectory) {
        walk(full);
      } else if (entry.endsWith(suffix)) {
        found.push(full);
      }
    }
  };

  walk(directory);

  return found;
};

const matchAll = (content: string, pattern: RegExp): string[] => {
  // The literals are module-scoped, so `lastIndex` has to be reset per use.
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match[1] !== undefined) {
      found.push(match[1]);
    }
  }

  return found;
};

interface UpstreamPackage {
  readonly name: string;
  readonly roles: Set<string>;
  readonly ariaAttributes: Set<string>;
  readonly keysHandled: Set<string>;
  readonly managesFocus: boolean;
  readonly spacing: number[];
}

const readPackage = (upstreamDir: string, name: string): UpstreamPackage | null => {
  const esm = join(upstreamDir, name, "dist", "esm");
  const files = listFilesRecursively(esm, ".js");

  if (files.length === 0) {
    return null;
  }

  const roles = new Set<string>();
  const ariaAttributes = new Set<string>();
  const keysHandled = new Set<string>();
  const spacing: number[] = [];
  let managesFocus = false;

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const role of matchAll(content, ROLE_PATTERN)) {
      roles.add(role);
    }
    for (const aria of matchAll(content, ARIA_PATTERN)) {
      ariaAttributes.add(aria);
    }
    for (const key of matchAll(content, KEY_PATTERN)) {
      keysHandled.add(key);
    }
    for (const value of matchAll(content, SPACING_PATTERN)) {
      spacing.push(Number.parseInt(value, 10));
    }

    if (FOCUS_HINTS.some((hint) => content.includes(hint))) {
      managesFocus = true;
    }
  }

  return { name, roles, ariaAttributes, keysHandled, managesFocus, spacing };
};

const buildSpacingScale = (values: readonly number[]): KitA11yArtifact["spacing"] => {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const total = values.length;
  const threshold = total * MIN_STEP_SHARE;

  const steps: SpacingStep[] = [...counts.entries()]
    .filter(([, occurrences]) => occurrences >= threshold)
    .map(([px, occurrences]) => ({ px, occurrences }))
    .sort((left, right) => left.px - right.px);

  const covered = steps.reduce((sum, step) => sum + step.occurrences, 0);
  const onGrid = values.filter((value) => value % SPACING_GRID_BASE === 0).length;

  return {
    steps: steps.filter((step) => step.px % SPACING_GRID_BASE === 0),
    offGridSteps: steps.filter((step) => step.px % SPACING_GRID_BASE !== 0),
    totalDeclarations: total,
    coverage: total === 0 ? 0 : covered / total,
    gridBase: SPACING_GRID_BASE,
    gridCoverage: total === 0 ? 0 : onGrid / total,
  };
};

/**
 * Maps upstream packages onto kit components through `components.json`.
 *
 * `wraps` is already recorded per component, so the association is read rather than
 * guessed — and a component whose upstream is missing simply produces no record, which is
 * what `upstreamAvailable` and the diagnostics exist to make visible.
 */
export const extractKitA11y = (input: {
  readonly paths: KitPaths;
  readonly components: ComponentsArtifact;
}): KitA11yArtifact => {
  const { paths, components } = input;
  const upstreamDir = paths.upstreamDir;

  if (upstreamDir === null) {
    return {
      $schema: "ds-analyzer/kit-a11y@1",
      meta: { upstreamVersion: "unknown", packagesScanned: 0, upstreamAvailable: false },
      patterns: [],
      spacing: {
        steps: [],
        offGridSteps: [],
        totalDeclarations: 0,
        coverage: 0,
        gridBase: SPACING_GRID_BASE,
        gridCoverage: 0,
      },
      diagnostics: [
        {
          code: "upstream-not-installed",
          severity: "warning",
          message:
            "@v-uik не установлен, поэтому доступность компонентов кита и его фактическая шкала отступов " +
            "не проверены. Правила, зависящие от этого артефакта, должны сообщать об ограничении, а не молчать.",
          samples: [],
          count: 0,
        },
      ],
    };
  }

  const packageNames = readdirSync(upstreamDir)
    .filter((entry) => !entry.startsWith("."))
    .sort(compareStrings);

  const packages = new Map<string, UpstreamPackage>();
  const allSpacing: number[] = [];

  for (const name of packageNames) {
    const read = readPackage(upstreamDir, name);
    if (read === null) {
      continue;
    }
    packages.set(`@v-uik/${name}`, read);
    allSpacing.push(...read.spacing);
  }

  const patterns: KitPattern[] = [];

  const byName = new Set<string>();

  for (const component of components.components) {
    const declared = component.wraps
      .filter((specifier) => !INFRASTRUCTURE_PACKAGES.has(specifier))
      .map((specifier) => packages.get(specifier))
      .filter((entry): entry is UpstreamPackage => entry !== undefined);

    // Thirty-four components declare `@v-uik/base` and nothing else, because that is how
    // they import. Dropping the barrel would lose `Modal`, `Tooltip` and `Accordion`
    // entirely, so the upstream package is recovered by name — the naming is one-to-one,
    // and a wrong guess is visible as a component whose evidence contradicts its role.
    const owned =
      declared.length > 0
        ? declared
        : [packages.get(`@v-uik/${toPackageName(component.name)}`)].filter(
            (entry): entry is UpstreamPackage => entry !== undefined,
          );

    if (owned.length === 0) {
      continue;
    }

    if (declared.length === 0) {
      byName.add(component.name);
    }

    const roles = new Set<string>();
    const ariaAttributes = new Set<string>();
    const keysHandled = new Set<string>();
    let managesFocus = false;

    for (const entry of owned) {
      for (const role of entry.roles) {
        roles.add(role);
      }
      for (const aria of entry.ariaAttributes) {
        ariaAttributes.add(aria);
      }
      for (const key of entry.keysHandled) {
        keysHandled.add(key);
      }
      managesFocus ||= entry.managesFocus;
    }

    if (roles.size === 0 && ariaAttributes.size === 0 && keysHandled.size === 0 && !managesFocus) {
      continue;
    }

    patterns.push({
      component: component.name,
      packages: sortStrings(owned.map((entry) => `@v-uik/${entry.name}`)),
      matchedBy: byName.has(component.name) ? "name" : "wraps",
      roles: sortStrings(roles),
      ariaAttributes: sortStrings(ariaAttributes),
      keysHandled: sortStrings(keysHandled),
      managesFocus,
    });
  }

  patterns.sort((left, right) => compareStrings(left.component, right.component));

  const spacing = buildSpacingScale(allSpacing);

  const withoutKeyboard = patterns.filter(
    (pattern) =>
      pattern.roles.length > 0 && pattern.keysHandled.length === 0 && !pattern.managesFocus,
  );

  return {
    $schema: "ds-analyzer/kit-a11y@1",
    meta: {
      upstreamVersion: readUpstreamVersion(upstreamDir),
      packagesScanned: packages.size,
      upstreamAvailable: true,
    },
    patterns,
    spacing,
    diagnostics: [
      {
        code: "spacing-scale-derived",
        severity: "info",
        message:
          "Шкала отступов выведена из реализаций @v-uik, а не опубликована китом: тира spacing в теме нет. " +
          `Шкала описывает ${String(Math.round(spacing.coverage * 100))}% объявлений, ` +
          "поэтому отклонение от неё — повод для заметки, а не для ошибки.",
        samples: spacing.steps
          .slice(0, 12)
          .map((step) => `${String(step.px)}px ×${String(step.occurrences)}`),
        count: spacing.steps.length,
      },
      ...(withoutKeyboard.length > 0
        ? [
            {
              code: "kit-widget-without-keyboard-evidence",
              severity: "info" as const,
              message:
                "Компоненты кита, у которых найдены ARIA-роли, но не найдено ни обработки клавиш, ни работы " +
                "с фокусом. Это не доказательство дефекта — сборка могла спрятать признаки, — но рекомендовать " +
                "их как готовое решение клавиатурной доступности без ручной проверки нельзя.",
              samples: withoutKeyboard.slice(0, 15).map((pattern) => pattern.component),
              count: withoutKeyboard.length,
            },
          ]
        : []),
    ],
  };
};

const readUpstreamVersion = (upstreamDir: string): string => {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(upstreamDir, "base", "package.json"), "utf8"),
    );

    if (manifest !== null && typeof manifest === "object" && "version" in manifest) {
      const { version } = manifest;
      if (typeof version === "string") {
        return version;
      }
    }
  } catch {
    // An unreadable manifest costs the version string, not the extraction.
  }

  return "unknown";
};
