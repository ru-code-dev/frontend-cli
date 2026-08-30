/**
 * The wire contract between this package and the dashboard it renders into.
 *
 * Every type here is a transcription of what the ported dashboard actually consumes:
 * `dashboard/src/contract.ts` (itself the port of
 * `hackathon2026/ds-analyzer/dashboard/src/contract.ts:13-166`, minus the fields whose
 * panels this build deletes — see the CHANGE LEDGER in
 * `WORKFLOW/features/hackathon-analys/reports/b3-analyzer-report.md`).
 *
 * It is declared a second time here, structurally, rather than imported across the
 * `dashboard/` boundary: the dashboard is compiled by Vite with its own tsconfig
 * (`jsx: react-jsx`, `moduleResolution: Bundler`, DOM lib) and this library is compiled by
 * `tsgo`/`tsdown` under the repo's NodeNext base. Sharing the file would drag one config's
 * assumptions into the other. The pair is kept honest by a tier-1 test that renders a
 * payload built from these types into the real built template and reads it back.
 */

export type Severity = "error" | "warning" | "info" | "candidate";

export type FindingCategory =
  | "token"
  | "typography"
  | "font"
  | "api"
  | "override"
  | "component"
  | "icon"
  | "a11y";

/** `dashboard/src/contract.ts:23-29` (A11yFacet). */
export interface A11yFacet {
  readonly wcag: readonly string[];
  readonly pattern: string | null;
  readonly impact: string;
  readonly fix: string | null;
}

/** `dashboard/src/contract.ts:31-36` (Expected). */
export interface Expected {
  readonly token: string | null;
  readonly cssVar: string | null;
  readonly component: string | null;
  readonly value: string;
}

/** `dashboard/src/contract.ts:38-46` (Snippet), incl. the two pre-rendered HTML fields. */
export interface Snippet {
  readonly before: string;
  readonly after: string | null;
  readonly highlightLine: number;
  readonly startLine: number;
  readonly beforeHtml: string;
  readonly afterHtml: string | null;
}

/** `dashboard/src/contract.ts:48-72` (Finding). */
export interface Finding {
  readonly id: string;
  readonly rule: string;
  readonly subkind: string | null;
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly confidence: number;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: Snippet;
  readonly actual: string;
  readonly expected: Expected | null;
  readonly why: string;
  readonly note: string | null;
  readonly rootCause: {
    readonly file: string;
    readonly line: number;
    readonly name: string;
  } | null;
  readonly appliedTo: { readonly component: string; readonly slot: string | null } | null;
  readonly a11y: A11yFacet | null;
  readonly autoFixable: boolean;
  readonly needsAgent: boolean;
  readonly candidates: readonly {
    readonly component: string;
    readonly score: number;
    readonly reasons: readonly string[];
  }[];
  readonly impact: { readonly occurrences: number; readonly files: number };
  readonly impactKey: string;
}

/** One check that did not run. `dashboard/src/lib/a11y.ts:191-194` reads `reason`. */
export interface Limitation {
  readonly file: string;
  readonly line: number | null;
  readonly reason: string;
  readonly detail: string;
}

/** `dashboard/src/contract.ts:74-91` (Summary), after the kit-metric excision. */
export interface Summary {
  readonly files: { readonly scanned: number; readonly clean: number };
  readonly findings: {
    readonly total: number;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly byRule: Readonly<Record<string, number>>;
    readonly byCategory: Readonly<Record<FindingCategory, number>>;
    readonly autoFixable: number;
    readonly needsAgent: number;
  };
  readonly positives: readonly { readonly label: string; readonly detail: string }[];
  readonly limitations: readonly Limitation[];
}

/**
 * What lands in the `<script id="ds-data">` slot.
 *
 * `dashboard/src/contract.ts:93-105` (Payload). `diff` and `iconPreviews` survive as the
 * dashboard reads them; this build always emits `null` / `{}` for them (no diff mode and no
 * kit icon geometry are ported), which the dashboard already handles — the diff banner is
 * skipped and the icon tile falls back to its `?` glyph.
 */
export interface ReportPayload {
  readonly project: { readonly name: string | null; readonly root: string };
  readonly generatedAt: string;
  readonly diff: {
    readonly range: string;
    readonly changedFiles: number;
    readonly changedLines: number;
    readonly newFindingIds: readonly string[];
  } | null;
  readonly iconPreviews: Readonly<
    Record<string, { readonly viewBox: string | null; readonly shapes: readonly string[] }>
  >;
  readonly summary: Summary;
  readonly findings: readonly Finding[];
  readonly ruleDescriptions: Readonly<Record<string, string>>;
}
