/**
 * `kit-a11y.json` for EDS 2.x — the same evidence, read off the kit instead of an upstream.
 *
 * The v1 extractor reads `@v-uik`'s compiled `dist/esm` because that is where 58 of 61 EDS 1.x
 * components' behaviour actually lives (`extract/kit-a11y/extract.ts:11-16`). EDS 2.x wraps
 * NOTHING: `@v-uik` appears in exactly three commented-out lines of the whole repository
 * (S1 break V10, `reports/s1-v2-facts.md:391`). So the evidence is the kit's own TypeScript, and
 * the promise the artifact makes is unchanged — it records that something IS handled, never that
 * it is handled correctly.
 *
 * Reading TypeScript rather than a bundle makes the evidence BETTER, not worse: `role="dialog"`
 * as a JSX attribute and `event.key === 'Escape'` in a handler are both visible in the form the
 * author wrote them, so the patterns below are less noisy than the v1 ones rather than more.
 *
 * `upstreamAvailable` stays `true`, and that is deliberate. The flag gates every a11y rule
 * (`kit/a11y-spec.ts:42-44`), and it means "the evidence was built", not "an upstream exists".
 * The fact that there IS no upstream is reported separately and exactly once — as the adapter's
 * `no-upstream` limitation (design E6) — rather than by silently switching off four rules.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { compareStrings, sortStrings } from "@smart-tools/fg-analyzer-engine";

import type { ComponentsArtifact } from "../domain/components.ts";
import {
  kitA11yArtifactSchema,
  type KitA11yArtifact,
  type KitPattern,
  type SpacingStep,
} from "../domain/kit-a11y.ts";

import type { KitPathsV2 } from "./paths.ts";

/** `role='dialog'`, `role="dialog"`, `role: 'dialog'` — JSX and object form in one pattern. */
const ROLE_PATTERN = /\brole\s*[:=]\s*[{]?\s*['"]([a-z]+)['"]/g;
const ARIA_PATTERN = /['"](aria-[a-z]+)['"]/g;

/** Mirrors the engine collector's list so both sides of a comparison mean the same thing. */
const KEY_PATTERN =
  /['"](ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Enter|Escape|Tab|Delete|Backspace|Spacebar)['"]/g;

/** Names that only appear when a component moves focus deliberately. */
const FOCUS_HINTS = [
  "useLastActiveElementFocus",
  "useActiveElementRef",
  "FocusLock",
  "focusTrap",
  "restoreFocus",
  "tabbable",
  ".focus()",
  "autoFocus",
];

const SPACING_PATTERN =
  /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Bottom|Left|Right|Inline|Block)?:\s*['"]?(\d{1,3})(?:px)?['"]?/g;

const MIN_STEP_SHARE = 0.01;
const SPACING_GRID_BASE = 4;

const listFiles = (directory: string): string[] => {
  const found: string[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of [...entries].toSorted(compareStrings)) {
      if (entry === "__tests__" || entry === "__snapshots__") continue;
      const full = join(current, entry);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.(stories|test|spec)\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };

  walk(directory);
  return found;
};

const matchAll = (content: string, pattern: RegExp): string[] => {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
};

const buildSpacingScale = (values: readonly number[]): KitA11yArtifact["spacing"] => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const total = values.length;
  const threshold = total * MIN_STEP_SHARE;

  const steps: SpacingStep[] = [...counts.entries()]
    .filter(([, occurrences]) => occurrences >= threshold)
    .map(([px, occurrences]) => ({ px, occurrences }))
    .toSorted((left, right) => left.px - right.px);

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

export interface ExtractKitA11yV2Input {
  readonly paths: KitPathsV2;
  readonly components: ComponentsArtifact;
}

export const extractKitA11yV2 = (input: ExtractKitA11yV2Input): KitA11yArtifact => {
  const { paths, components } = input;
  const allSpacing: number[] = [];
  const patterns: KitPattern[] = [];

  for (const component of components.components) {
    // Every directory of that name, in both packages: `kit-exp/Modal` assembles what
    // `base-exp/Modal*` implements, and the accessibility evidence is split across the two.
    const directories = [
      join(paths.baseComponentsDir, component.name),
      join(paths.kitComponentsDir, component.name),
    ];

    const roles = new Set<string>();
    const ariaAttributes = new Set<string>();
    const keysHandled = new Set<string>();
    let managesFocus = false;
    let read = 0;

    for (const directory of directories) {
      for (const file of listFiles(directory)) {
        let content: string;
        try {
          content = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        read += 1;

        for (const role of matchAll(content, ROLE_PATTERN)) roles.add(role);
        for (const aria of matchAll(content, ARIA_PATTERN)) ariaAttributes.add(aria);
        for (const key of matchAll(content, KEY_PATTERN)) keysHandled.add(key);
        for (const value of matchAll(content, SPACING_PATTERN)) {
          allSpacing.push(Number.parseInt(value, 10));
        }
        if (FOCUS_HINTS.some((hint) => content.includes(hint))) managesFocus = true;
      }
    }

    if (read === 0) continue;
    if (roles.size === 0 && ariaAttributes.size === 0 && keysHandled.size === 0 && !managesFocus) {
      continue;
    }

    patterns.push({
      component: component.name,
      // The packages the evidence came from, in the same "where did this come from" slot the
      // v1 artifact fills with `@v-uik/*` names.
      packages: sortStrings([component.package ?? "@sds-eng/base-exp"]),
      matchedBy: "own-source",
      roles: sortStrings(roles),
      ariaAttributes: sortStrings(ariaAttributes),
      keysHandled: sortStrings(keysHandled),
      managesFocus,
    });
  }

  patterns.sort((left, right) => compareStrings(left.component, right.component));

  const spacing = buildSpacingScale(allSpacing);

  return kitA11yArtifactSchema.parse({
    $schema: "ds-analyzer/kit-a11y@1",
    meta: {
      // There is no upstream to version. `none` says so in the field whose whole job is to
      // record where the evidence came from, and the adapter's `no-upstream` limitation says
      // it again where a reader of the report will see it.
      upstreamVersion: "none",
      packagesScanned: patterns.length,
      upstreamAvailable: true,
    },
    patterns,
    spacing,
    diagnostics: [
      {
        code: "a11y-evidence-from-kit-sources",
        severity: "info",
        message:
          "EDS 2.x ничего не оборачивает: доступность прочитана из собственных исходников кита " +
          "(packages/base и packages/kit), а не из upstream-библиотеки. Свидетельство означает, что " +
          "поведение реализовано, а не что оно реализовано правильно.",
        samples: patterns.slice(0, 12).map((pattern) => pattern.component),
        count: patterns.length,
      },
      {
        code: "spacing-scale-derived",
        severity: "info",
        message:
          "Шкала отступов выведена из реализаций кита, а не опубликована им: тира spacing в теме нет. " +
          `Шкала описывает ${String(Math.round(spacing.coverage * 100))}% объявлений, ` +
          "поэтому отклонение от неё — повод для заметки, а не для ошибки.",
        samples: spacing.steps
          .slice(0, 12)
          .map((step) => `${String(step.px)}px ×${String(step.occurrences)}`),
        count: spacing.steps.length,
      },
    ],
  } satisfies KitA11yArtifact);
};
