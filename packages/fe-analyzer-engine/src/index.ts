import { analyzerResultSchema, type AnalyzerResult, type Domain } from "./domain/findings.ts";
import { buildRuleContext } from "./rules/context.ts";
import { collectRuleLimitations, domainOf, RULES, runRules } from "./rules/index.ts";
import { scanProject } from "./scanner/scan.ts";
import { buildSummary } from "./summary.ts";

/**
 * `@smart-tools/fe-analyzer-engine` — the public surface.
 *
 * A port of the analysis half of `hackathon2026/ds-analyzer`, cut at the seam h2 §7 named:
 * that CLI loads a design system's extracted artifacts unconditionally before any rule runs
 * (`ds-analyzer/src/cli/run-analyze.ts:56`, an unguarded `readFileSync` — see
 * `ds-analyzer/src/kit/spec.ts:200-208`), so it cannot run on a project that does not ship
 * them. Nothing here loads an artifact, and the eleven rules carried over are the eleven that
 * never needed one.
 *
 * Three stages, none of which builds or executes the analysed project:
 *
 *  1. **Scan** — walk by file extension, parse each code file once with ts-morph and run
 *     `eslint-plugin-jsx-a11y` in memory over the same text; parse stylesheets with postcss.
 *  2. **Rules** — eleven pure functions from those facts to findings. No rule opens a file.
 *  3. **Summarise** — identity, snippets and occurrence counts attached in one place.
 */

export type {
  A11yFacet,
  AnalyzerResult,
  AnalyzerSummary,
  Candidate,
  Domain,
  Expected,
  Finding,
  FindingCategory,
  Severity,
  Snippet,
} from "./domain/findings.ts";
export {
  a11ySchema,
  analyzerResultSchema,
  analyzerSummarySchema,
  candidateSchema,
  domainSchema,
  expectedSchema,
  findingCategorySchema,
  findingSchema,
  severitySchema,
  snippetSchema,
} from "./domain/findings.ts";
export type { Limitation, LimitationReason, ProjectProfile } from "./domain/profile.ts";
export { limitationSchema } from "./domain/profile.ts";

/** Every domain, in the order the report shows them. Also the default for {@link analyzeProject}. */
export const ALL_DOMAINS: readonly Domain[] = ["a11y", "components", "icons"];

export interface AnalyzeOptions {
  /** File, directory or repository root to analyse. */
  readonly dir: string;
  /** Domains to run. Defaults to all three. */
  readonly domains?: readonly Domain[];
  /**
   * Extra ignore patterns in gitignore syntax, on top of the walker's hard list
   * (`node_modules/`, `dist/`, build output — `scanner/profile/ignore.ts`) and every
   * `.gitignore` in the tree.
   */
  readonly ignore?: readonly string[];
}

/** The rules that will run for a given domain selection, for a caller that wants to say so. */
export const rulesFor = (
  domains: readonly Domain[] = ALL_DOMAINS,
): readonly { id: string; description: string }[] =>
  RULES.filter((rule) => domains.includes(domainOf(rule))).map((rule) => ({
    id: rule.id,
    description: rule.description,
  }));

/**
 * Analyses a project on disk.
 *
 * `async` although every stage is synchronous: the whole run is CPU-bound file reading and
 * parsing, and the signature is the one the CLI and the report package build against —
 * widening it later would be a breaking change for a gain of nothing.
 */
export const analyzeProject = async (options: AnalyzeOptions): Promise<AnalyzerResult> => {
  const domains = options.domains ?? ALL_DOMAINS;

  const { profile, observations } = scanProject({
    path: options.dir,
    ...(options.ignore === undefined ? {} : { ignore: options.ignore }),
  });

  const context = buildRuleContext({ profile, observations });
  const findings = runRules(context, { domains });

  // Rule limitations join the scanner's, because to the reader they are the same fact:
  // something was not checked. Where the gap came from is an implementation detail.
  const limitations = [...profile.limitations, ...collectRuleLimitations(context, { domains })];

  const result: AnalyzerResult = {
    $schema: "fe-analyzer-engine/analysis@1",
    domains: [...domains],
    findings,
    summary: buildSummary({ observations, findings, limitations }),
  };

  // The shape is a contract with the report package, and a contract nobody checks is a
  // comment. Parsing costs microseconds against a run that reads the whole project.
  return analyzerResultSchema.parse(result);
};
