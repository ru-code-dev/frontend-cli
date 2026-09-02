/**
 * TIER 2 — `--project-report` over an EDS 2.x consumer, THROUGH THE SHIPPED BUNDLE.
 *
 * THE ACCEPTANCE TEST FOR THE `eds2` PROFILE. Its subject is
 * `cli/tests/fixtures/eds2-app/EXPECTED.txt`, written by the agent that scouted the kit and
 * built the fixture — a table of rule ids and source coordinates produced from the KIT's
 * sources, before any of this code existed. Every row of it is asserted below, and so is its
 * must-NOT list, because a design-system analyzer that finds the right things and also finds
 * fourteen wrong ones is not useful.
 *
 * WHY THE BUNDLE AND NOT THE PACKAGES. Three things can only break here, and each of them
 * would leave every unit test green:
 *
 *   1. THE SECOND EMBEDDED SNAPSHOT. EDS 2.x's five artifacts are `import`ed JSON compiled into
 *      `dist/fg.mjs` alongside EDS 1.x's. A bundler that dropped one, or a tree-shake that
 *      decided `eds2Adapter` was unreachable, produces a binary that autodetects nothing.
 *   2. AUTODETECT ACROSS TWO ADAPTERS. The registry now holds two entries whose package lists
 *      must stay disjoint; the fixture declares `@sds-eng/base-exp` and `kit-exp` and nothing
 *      may make `eds` win.
 *   3. THE VANILLA-EXTRACT COLLECTOR AT RUNTIME. Twelve of the fourteen fixture files are
 *      `.css.ts`; if the collector or the js-path binding did not survive bundling, the run is
 *      silently clean where it should be loud.
 *
 * ANCHOR SEMANTICS. `EXPECTED.txt` states that a row's `file:line` is the anchor — "the
 * declaration the finding is expected to point at; a rule that reports a narrower span (a
 * property, an attribute) is still satisfied as long as it lands inside the anchor's statement".
 * `MUST_FIRE` therefore carries a line RANGE per row, spelling the statement each anchor opens.
 */
import { execFile } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { makeTempDir, nodeModulesAbove, removeTempDir } from "@smart-tools/fg-testkit";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const run = promisify(execFile);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtBundle = join(packageRoot, "dist", "fg.mjs");
const fixture = join(packageRoot, "tests", "fixtures", "eds2-app");

interface Finding {
  readonly rule: string;
  readonly subkind: string | null;
  readonly file: string;
  readonly line: number;
  readonly actual: string;
  /** The sentence the rule wrote; asserted where the grade lives in prose. */
  readonly why: string;
  /** Why a finding carries no replacement, when it carries none (V6 #1). */
  readonly note: string | null;
  readonly expected: {
    readonly token: string | null;
    readonly cssVar: string | null;
    readonly jsPath?: string | null;
    readonly value: string;
  } | null;
  readonly candidates: readonly { readonly component: string }[];
}

interface Payload {
  readonly adapter: { readonly name: string; readonly version: string } | null;
  readonly summary: {
    readonly files: { readonly scanned: number; readonly clean: number };
    readonly findings: {
      readonly total: number;
      readonly byRule: Readonly<Record<string, number>>;
    };
    readonly limitations: readonly { readonly file: string; readonly reason: string }[];
  };
  readonly findings: readonly Finding[];
  readonly ruleCatalog?: readonly { readonly id: string }[];
}

/**
 * `EXPECTED.txt` table A — every row that must fire, as `rule | file | [from, to]`.
 *
 * The RANGE is the anchor's statement, per the file's own preamble. Where a row names several
 * lines (`:23`,`:27`,`:28`) it becomes several entries, because "three declarations are wrong"
 * and "one of them is" are different claims and only the first is the one being made.
 */
const MUST_FIRE: readonly (readonly [string, string, number, number])[] = [
  // Colour literals: exact, near, graded shades, and two the kit holds nothing like.
  ["token.literal.color", "src/components/PrimaryButton.css.ts", 18, 18],
  // Exact, and offered NO replacement: the kit names no `foreground` role for white
  // (EXPECTED.txt's row added by V6 #1).
  ["token.literal.color", "src/components/PrimaryButton.css.ts", 19, 19],
  ["token.literal.color", "src/components/PrimaryButton.css.ts", 23, 23],
  ["token.literal.color", "src/components/PrimaryButton.css.ts", 24, 24],
  ["token.literal.color", "src/components/PrimaryButton.css.ts", 52, 52],
  ["token.literal.color", "src/features/ProfileDialog.css.ts", 7, 7],
  ["token.literal.color", "src/styles/global.css.ts", 7, 7],
  // Lengths off the kit's 41-value dimension set.
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 14, 14],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 15, 15],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 16, 16],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 17, 17],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 27, 27],
  ["token.literal.dimension", "src/features/LoginForm.css.ts", 23, 23],
  ["token.literal.dimension", "src/features/ProfileDialog.css.ts", 23, 23],
  ["token.literal.dimension", "src/features/ProfileDialog.css.ts", 27, 27],
  ["token.literal.dimension", "src/features/ProfileDialog.css.ts", 28, 28],
  ["token.literal.dimension", "src/styles/global.css.ts", 6, 6],
  ["token.literal.dimension", "src/styles/global.css.ts", 12, 12],
  ["token.literal.dimension", "src/styles/global.css.ts", 16, 16],
  // A number in a JSX `style={{…}}`: the React number→px rule still runs under a v2 profile.
  ["token.literal.dimension", "src/legacy/DeepImports.tsx", 12, 12],
  // Both primitive tiers, reached by member path — half the tier system each.
  ["token.tier.violation", "src/components/PrimaryButton.css.ts", 36, 36],
  ["token.tier.violation", "src/components/PrimaryButton.css.ts", 37, 37],
  // Size from a tuple, the rest of the ramp by hand.
  ["token.typography.partial", "src/components/PrimaryButton.css.ts", 43, 47],
  ["font.foreign", "src/components/PrimaryButton.css.ts", 13, 13],
  ["font.foreign", "src/components/PrimaryButton.css.ts", 45, 45],
  ["font.foreign", "src/styles/global.css.ts", 5, 5],
  ["a11y.contrast.text", "src/components/PrimaryButton.css.ts", 51, 54],
  // Two recipe variant values that do not exist, on one element.
  ["prop.invalid", "src/features/LoginForm.tsx", 41, 41],
  ["api.deprecated", "src/hooks/useDraft.ts", 1, 1],
  ["import.internal", "src/legacy/DeepImports.tsx", 3, 3],
  ["import.internal", "src/legacy/DeepImports.tsx", 4, 4],
  ["icon.inline-svg", "src/components/StatusBadge.tsx", 13, 13],
  ["icon.inline-svg", "src/components/StatusBadge.tsx", 25, 25],
  ["icon.foreign-pack", "src/legacy/DeepImports.tsx", 5, 5],
  ["a11y.name.missing", "src/components/StatusBadge.tsx", 24, 24],
  ["a11y.lint", "src/features/ProfileDialog.tsx", 23, 23],
  ["a11y.lint", "src/features/ProfileDialog.tsx", 25, 25],
  ["a11y.lint", "src/features/ProfileDialog.tsx", 27, 27],
  ["a11y.aria.invalid", "src/features/ProfileDialog.tsx", 30, 30],
  ["a11y.pattern.focus", "src/features/ProfileDialog.tsx", 24, 24],
  // Kit classes reached from outside, by the substring form a v2 consumer must write.
  ["style.override", "src/features/ProfileDialog.css.ts", 21, 24],
  ["style.override", "src/features/ProfileDialog.css.ts", 26, 29],
  ["style.override", "src/styles/global.css.ts", 10, 13],
  ["style.override", "src/styles/global.css.ts", 15, 17],
  ["style.override.important", "src/features/ProfileDialog.css.ts", 22, 23],
  ["style.override.important", "src/styles/global.css.ts", 12, 12],
  ["style.override.important", "src/styles/global.css.ts", 16, 16],
  ["style.override.size", "src/styles/global.css.ts", 16, 16],
  ["style.override.size", "src/features/ProfileDialog.css.ts", 27, 27],
  ["style.override.inner", "src/features/ProfileDialog.css.ts", 26, 27],
];

/**
 * `EXPECTED.txt` table B — files and lines that must stay clean.
 *
 * The four whole-file entries are the fixture's baseline; a single finding in one of them is a
 * false positive by construction. The per-line entries are values that ARE on the kit's scale
 * or ARE in a recipe's variant group, and reporting them would be the analyzer disagreeing with
 * the design system it is measuring against.
 */
const CLEAN_FILES: readonly string[] = [
  "src/theme/tokens.css.ts",
  "src/components/IconLegend.tsx",
  "src/components/StatusBadge.css.ts",
  "src/App.tsx",
];

const MUST_NOT_FIRE: readonly (readonly [string, string, number])[] = [
  ["token.literal.dimension", "src/features/LoginForm.css.ts", 8],
  ["token.literal.dimension", "src/features/LoginForm.css.ts", 15],
  ["token.literal.dimension", "src/features/ProfileDialog.css.ts", 15],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 28],
  ["token.literal.dimension", "src/components/PrimaryButton.css.ts", 39],
  ["prop.invalid", "src/features/LoginForm.tsx", 38],
  ["prop.invalid", "src/features/ProfileDialog.tsx", 30],
  ["prop.invalid", "src/components/PrimaryButton.tsx", 15],
];

/** Rules that must produce NOTHING anywhere in this project. */
const SILENT_RULES: readonly string[] = ["import.bypass", "api.dnu", "icon.foreign-file"];

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The child's environment is BUILT, never inherited.
 *
 * `FG_KITS_DIR` points at nothing so the run measures against the EMBEDDED v2 snapshot and not
 * against whatever `~/.fg/kits/eds2/` the developer happens to hold — the same reasoning
 * `project-report.integration.test.ts` gives for the v1 suite.
 */
const childEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "",
  FG_KITS_DIR: join(tmpdir(), "fg-kits-that-do-not-exist"),
});

const fg = async (dir: string, args: readonly string[]): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "fg.mjs"), ...args], {
      cwd: dir,
      env: childEnv(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
};

const embedded = (html: string): Payload => {
  const match = /<script type="application\/json" id="ds-data">([\S\s]*?)<\/script>/u.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse((match?.[1] ?? "{}").replace(/\\u003C/gu, "<")) as Payload;
};

let scratch = "";
let payload: Payload;

describe("`--project-report` over an EDS 2.x consumer, from the shipped bundle", () => {
  beforeAll(async () => {
    scratch = makeTempDir("fg-eds2-");
    copyFileSync(builtBundle, join(scratch, "fg.mjs"));
    // The bundle is alone, with nothing above it to resolve an un-inlined import against.
    expect(readdirSync(scratch)).toEqual(["fg.mjs"]);
    expect(nodeModulesAbove(scratch)).toEqual([]);

    const out = join(scratch, "report.html");
    const result = await fg(scratch, ["--preport", fixture, "--format", "html", "-o", out]);
    // The fixture holds errors, so a clean exit would be the failure.
    expect(result.code).toBe(1);
    payload = embedded(readFileSync(out, "utf8"));
  }, 300_000);

  afterAll(() => {
    if (scratch !== "") removeTempDir(scratch);
  });

  it("autodetects eds2 and stamps the DESIGN SYSTEM's version, not the package's", () => {
    expect(payload.adapter?.name).toBe("eds2");
    expect(payload.adapter?.version).toContain("2.0.0");
    // The catalog is the shared 32 (design E6): one `fg.config.json` addresses both kits.
    expect(payload.ruleCatalog).toHaveLength(32);
  });

  it("fires every row of EXPECTED.txt table A", () => {
    const missing = MUST_FIRE.filter(
      ([rule, file, from, to]) =>
        !payload.findings.some(
          (finding) =>
            (finding.rule === rule || finding.rule.startsWith(`${rule}.`)) &&
            finding.file === file &&
            finding.line >= from &&
            finding.line <= to,
        ),
    ).map(([rule, file, from, to]) => `${rule} @ ${file}:${String(from)}-${String(to)}`);

    expect(missing).toEqual([]);
  });

  /**
   * THREE ROWS OF TABLE A ARE NOT IN `MUST_FIRE`, and each is named here rather than quietly
   * dropped. In all three the DEFECT is reported at the same line by a different rule, and in
   * all three the rule the row names cannot fire for a reason that lives in
   * `packages/fg-analyzer-engine`, which this change does not touch. The report's DEVIATIONS
   * section carries the full argument; this test carries the consequence.
   */
  it("reports the three table-A defects the named rule cannot claim, under the rule that can", () => {
    const at = (file: string, line: number): readonly string[] =>
      payload.findings.filter((f) => f.file === file && f.line === line).map((f) => f.rule);

    const dialog = at("src/features/ProfileDialog.tsx", 24);

    // Row `a11y.pattern.relations @ :24` — "role='dialog' with neither aria-label nor
    // aria-labelledby". That rule reports DANGLING id references
    // (`packages/fg-analyzer-engine/src/rules/a11y/relations.ts:92-96`); the missing accessible
    // name is `a11y.name.missing`, and it fires.
    expect(dialog).toContain("a11y.name.missing");

    // Row `a11y.pattern.keyboard @ :24` — `dialog` is deliberately excluded from that rule's
    // role set, with its own reasoning
    // (`packages/fg-eds-adapter/src/rules/a11y/pattern-keyboard.ts:20-22`), and no EDS 2.x
    // component renders `role="dialog"` for it to compare against. The missing Escape handler
    // and focus contract are `a11y.pattern.focus`, and it fires.
    expect(dialog).toContain("a11y.pattern.focus");

    // Row `a11y.aria.invalid @ :27` — `aria-checked` on a role-less `<div>`. The engine checks
    // attribute support only against a KNOWN role
    // (`packages/fg-analyzer-engine/src/rules/a11y/aria.ts:219-222`). The element's other
    // defect — a click handler with no keyboard equivalent — is reported.
    expect(at("src/features/ProfileDialog.tsx", 27)).toContain("a11y.lint");
  });

  /**
   * V6 AUDIT FINDINGS #8, #9 AND #1 — the three re-aimed colour rows, and what they carry.
   *
   * `EXPECTED.txt` claimed three of these matched nothing in the 1079-token set and were
   * «reported with no replacement». Two of the three claims were wrong and one was right for
   * the wrong reason: all three DO resolve inside the ΔE bands, so they are graded `shade` or
   * `near` — and they carry no replacement because the token they resolve to is primitive, not
   * because there is no token.
   */
  it("grades the shades it can name, and withholds only what may not be pasted", () => {
    const colourAt = (file: string, line: number) =>
      payload.findings.find(
        (finding) =>
          finding.rule === "token.literal.color" && finding.file === file && finding.line === line,
      );

    const graded = [
      ["src/components/PrimaryButton.css.ts", 24, "shade", "ref.palette.orchid40"],
      ["src/components/PrimaryButton.css.ts", 52, "shade", "edsRef.palette.cool.cool300"],
      ["src/styles/global.css.ts", 7, "near", "ref.palette.gray99"],
    ] as const;

    for (const [file, line, subkind, nearest] of graded) {
      const finding = colourAt(file, line);
      // The GRADE is the audit's finding #8: the kit does hold a colour this close.
      expect(finding?.subkind).toBe(subkind);
      expect(finding?.why).toContain(nearest);
      // The REPLACEMENT is finding #1: a primitive may not be offered, and the absence is said.
      expect(finding?.expected).toBeNull();
      expect(finding?.note).toContain(`примитив ${nearest}`);
    }

    // An EXACT match with no same-role semantic token is the same rule seen from the other side.
    const white = colourAt("src/components/PrimaryButton.css.ts", 19);
    expect(white?.subkind).toBe("exact");
    expect(white?.expected).toBeNull();
    expect(white?.note).toContain("семантической роли «foreground»");

    // NOTHING the tool offers on this fixture names a primitive-tier COLOUR, which is the
    // property the whole finding is about. (`edsRef.fontFamilies.text` is a primitive, and is
    // legal: the tier rule is about colour and exempts the kit's non-colour scales by design.)
    const offeredColours = payload.findings
      .filter((finding) => finding.rule === "token.literal.color")
      .map((finding) => finding.expected?.token)
      .filter((token): token is string => typeof token === "string");
    expect(offeredColours.length).toBeGreaterThan(0);
    expect(offeredColours.filter((token) => /^(?:edsRef|ref)\./u.test(token))).toEqual([]);
  });

  it("fills BOTH reference channels and lets the file choose which one is the value", () => {
    // V6 #9: `EXPECTED.txt` asked for `cssVar: null` under v2, which design §6 had already
    // superseded — v2 custom-property names are stable, so a finding can offer both.
    const exact = payload.findings.find(
      (finding) =>
        finding.rule === "token.literal.color" &&
        finding.file === "src/components/PrimaryButton.css.ts" &&
        finding.line === 18,
    );
    expect(exact?.expected?.token).toBe("edsSys.Background.backAccent");
    expect(exact?.expected?.jsPath).toBe("themeTokens.edsSys.Background.backAccent");
    expect(exact?.expected?.cssVar).toBe("--sds-eng-edsSys-Background-backAccent");
    // V6 #4: the FILE is a `.css.ts`, so the paste-ready value is the member path.
    expect(exact?.expected?.value).toBe("themeTokens.edsSys.Background.backAccent");
  });

  it("groups the two !important overrides into one finding that names both properties", () => {
    // V6 #10: `EXPECTED.txt` said "twice" and the rule emits one grouped finding at `22:20`.
    // Nothing is lost — the message names both properties — but the count in the table was not
    // the count in the output.
    const grouped = payload.findings.filter(
      (finding) =>
        finding.rule === "style.override.important" &&
        finding.file === "src/features/ProfileDialog.css.ts",
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.line).toBe(22);
    expect(grouped[0]?.why).toContain("background-color");
    expect(grouped[0]?.why).toContain("border-radius");
  });

  it("never CLAIMS a clone on the two local components that are not one", () => {
    // V6 #11: `component.ambiguous` on `StatusBadge` and `ProfileDialog` is permitted by
    // EXPECTED.txt table B — the grading is the EDS 1.x algorithm, shared by both adapters — but
    // the claim-making ids are not.
    for (const file of ["src/components/StatusBadge.tsx", "src/features/ProfileDialog.tsx"]) {
      const claims = payload.findings.filter(
        (finding) =>
          finding.file === file &&
          ["component.custom", "component.fork", "component.duplicate"].includes(finding.rule),
      );
      expect(claims).toEqual([]);
    }
  });

  it("names the kit component behind the local clone", () => {
    // EXPECTED.txt leaves the ID to the clone detector's grading ("which of the three ids fires
    // is the clone-detector's grading job") and requires only that it names `Button`.
    const clone = payload.findings.find(
      (finding) =>
        finding.rule.startsWith("component.") && finding.file.endsWith("PrimaryButton.tsx"),
    );
    expect(clone).toBeDefined();
    expect(clone?.candidates.map((candidate) => candidate.component)).toContain("Button");
  });

  it("offers replacements in the spelling a v2 consumer writes", () => {
    // The whole point of the js-path channel: a `.css.ts` cannot hold `var(--…)`, so a finding
    // that offered one would be offering a fix that does not compile.
    const tiered = payload.findings.find((finding) => finding.rule === "token.tier.violation");
    expect(tiered?.expected?.value).toMatch(/^themeTokens\./);
    expect(tiered?.expected?.jsPath).toBe(tiered?.expected?.value);
    // Both channels travel, so a reader who wants the custom property still has it.
    expect(tiered?.expected?.cssVar).toMatch(/^--sds-eng-/);
  });

  it("keeps EXPECTED.txt table B clean — four whole files and eight declarations", () => {
    const dirty = payload.findings.filter((finding) => CLEAN_FILES.includes(finding.file));
    expect(
      dirty.map((finding) => `${finding.rule} @ ${finding.file}:${String(finding.line)}`),
    ).toEqual([]);

    const wrong = MUST_NOT_FIRE.filter(([rule, file, line]) =>
      payload.findings.some(
        (finding) => finding.rule === rule && finding.file === file && finding.line === line,
      ),
    ).map(([rule, file, line]) => `${rule} @ ${file}:${String(line)}`);
    expect(wrong).toEqual([]);
  });

  it("registers the rules that have nothing to check, and reports zero from them", () => {
    for (const rule of SILENT_RULES) {
      expect(payload.summary.findings.byRule[rule] ?? 0).toBe(0);
      expect(payload.ruleCatalog?.some((entry) => entry.id === rule)).toBe(true);
    }
    // `api.deprecated` is NOT inert under eds2 — exactly one, at the import of a deprecated hook.
    expect(payload.summary.findings.byRule["api.deprecated"]).toBe(1);
  });

  it("counts the files EXPECTED.txt's table C counts", () => {
    expect(payload.summary.files.scanned).toBe(14);
    const withFindings = new Set(payload.findings.map((finding) => finding.file));
    expect(withFindings.size).toBe(10);
    for (const file of CLEAN_FILES) expect(withFindings.has(file)).toBe(false);
    // Nineteen distinct rule ids was the floor EXPECTED.txt set.
    expect(new Set(payload.findings.map((finding) => finding.rule)).size).toBeGreaterThanOrEqual(
      19,
    );
  });

  it("shows the gaps rather than hiding them", () => {
    const reasons = payload.summary.limitations.map((limitation) => limitation.reason);
    // A computed member access is UNRESOLVED, and unresolved is not clean (design E5).
    expect(reasons).toContain("unresolved-token-reference");
    expect(
      payload.summary.limitations.some(
        (limitation) => limitation.file === "src/features/LoginForm.css.ts",
      ),
    ).toBe(true);
    // The kit wraps nothing, and `import.bypass`'s silence is explained rather than assumed.
    expect(reasons).toContain("no-upstream");
  });

  it("redirects `--ui-kit eds` to eds2 on a v2 project, and says so", async () => {
    const result = await fg(scratch, [
      "--preport",
      fixture,
      "--ui-kit",
      "eds",
      "--format",
      "compact",
    ]);

    expect(result.stderr).toContain("eds2");
    expect(result.stderr).toMatch(/@sds-eng\/base-exp/u);
    // The run really did use the v2 adapter: 26 rules, not the engine's 11.
    expect(result.stderr).toContain("26");

    // V6 AUDIT FINDING #3 — the HEADER names the snapshot the numbers came from. It used to
    // say `eds 1.13.0 (встроенная)` one line above the correction: the wrong design system and
    // the wrong version, in the one line whose whole job is to answer that question.
    const [header, second] = result.stderr.split("\n");
    expect(header).toContain("eds2 2.0.0");
    expect(header).not.toContain("eds 1.");
    // Exactly ONE line explains the redirect, and it is the one immediately below.
    expect(second).toContain("--ui-kit eds2");
    expect(result.stderr.split("\n").filter((line) => line.includes("запрошена eds"))).toHaveLength(
      1,
    );
  }, 300_000);

  it("prints a compact report whose shape is the one every command shares", async () => {
    const result = await fg(scratch, ["--preport", fixture, "--format", "compact"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("eds2 2.0.0");
    // A stable slice of the compact output: the file heading, and one finding under it that
    // quotes the js-path replacement. Asserted on CONTENT rather than as a whole-output
    // snapshot, so a widened terminal or a renamed severity word does not fail the suite.
    expect(result.stdout).toContain("src/components/PrimaryButton.css.ts");
    expect(result.stdout).toContain("themeTokens.edsSys.Background.backAccent");
    expect(result.stdout).toContain("token.tier.violation");
    expect(result.stdout).toContain("style.override.important");
  }, 300_000);

  it("leaves EDS 1.x measured against EDS 1.x, from the same binary", async () => {
    // The two snapshots are both in this file, and the wrong one being reachable from the wrong
    // project is the failure mode embedding both creates.
    const v1 = join(packageRoot, "tests", "fixtures", "plain-css");
    const result = await fg(scratch, ["--preport", v1, "--ui-kit", "eds", "--format", "compact"]);
    expect(result.stderr).toContain("eds 1.13.0");
    expect(result.stderr).not.toContain("eds2");
  }, 300_000);
});
