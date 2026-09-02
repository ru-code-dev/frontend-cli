import {
  compareStrings,
  extractValueLiterals,
  type Finding,
  type KitMetricsInput,
  type Observations,
  type Severity,
  type Usage,
} from "@smart-tools/fe-analyzer-engine";

/**
 * The adoption half of the summary. Ported from
 * `hackathon2026/ds-analyzer/src/metrics/health.ts:1-227` minus its counting half, which the
 * engine already owns (`summary.ts`).
 *
 * This lives in the adapter rather than the engine because every number below is a claim about
 * *this* design system. `computeAdoption` counts elements whose `kitComponent` is set, and h5
 * §2d records what happens when nothing sets it: 0% adoption and a score thirty points lower on
 * every project, for a reason the reader cannot act on. The health score also names rule ids —
 * `import.bypass`, `font.foreign`, `token.literal.color` — that only this adapter's rules emit.
 *
 * The formula is published in the payload next to the number. A score whose derivation is hidden
 * gets argued with instead of acted on, and the first question anyone asks about a 72 is what
 * the missing 28 were.
 *
 * Weights follow consequence rather than count. An error is something that is already wrong; a
 * warning is something that will go wrong at the next theme change or kit upgrade; an info is a
 * literal that renders correctly today. Candidates — components the kit has no equivalent for —
 * carry no weight at all: they are input for the design-system team, not debt for the product
 * team.
 */

const WEIGHT_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  error: 3,
  warning: 1,
  info: 0.25,
  candidate: 0,
};

/**
 * Weighted deviations per file at which the score reaches zero.
 *
 * Normalising per file rather than per finding is what makes the score comparable between a
 * twenty-file feature and a thousand-file product.
 */
const ZERO_AT_WEIGHT_PER_FILE = 12;

export const HEALTH_FORMULA =
  "health = round(100 × (0.5 × (1 − min(1, Σ(вес severity) / файлы / 12)) + 0.3 × adoption + 0.2 × tokenCoverage)); " +
  "веса: error 3 · warning 1 · info 0.25 · candidate 0";

/** Share of component elements that come from the kit rather than from elsewhere. */
const computeAdoption = (observations: Observations): number => {
  let kit = 0;
  let total = 0;

  for (const element of observations.jsxElements) {
    // Host elements are not a choice between the kit and something else.
    if (!/^[A-Z]/.test(element.name)) {
      continue;
    }
    total += 1;
    if (element.kitComponent !== null) {
      kit += 1;
    }
  }

  return total === 0 ? 1 : kit / total;
};

/** Share of style values expressed through a token rather than a literal. */
const computeTokenCoverage = (observations: Observations): number => {
  let tokens = 0;
  let literals = 0;

  for (const styleValue of observations.styleValues) {
    for (const literal of extractValueLiterals(styleValue.value)) {
      if (literal.kind === "var") {
        tokens += 1;
      } else {
        literals += 1;
      }
    }
  }

  const total = tokens + literals;

  return total === 0 ? 1 : tokens / total;
};

const buildPositives = (
  observations: Observations,
  findings: readonly Finding[],
  usage: Usage,
  cleanFiles: number,
): { label: string; detail: string }[] => {
  const positives: { label: string; detail: string }[] = [];

  if (cleanFiles > 0) {
    positives.push({
      label: "Чистые файлы",
      detail: `${String(cleanFiles)} из ${String(observations.files.length)} файлов без единого отклонения.`,
    });
  }

  const flawless = usage.components.filter(
    (component) => component.usages > 0 && component.findings === 0,
  );
  if (flawless.length > 0) {
    const top = [...flawless].sort((left, right) => right.usages - left.usages).slice(0, 5);
    positives.push({
      label: "Компоненты без замечаний",
      detail: `${top.map((component) => `${component.name} (${String(component.usages)}×)`).join(", ")} используются строго по документации.`,
    });
  }

  if (!findings.some((finding) => finding.rule === "import.bypass")) {
    positives.push({
      label: "Нет импортов в обход кита",
      detail: "Ни одного прямого обращения к обёрнутой библиотеке.",
    });
  }

  if (!findings.some((finding) => finding.rule === "font.foreign")) {
    positives.push({ label: "Типографика на месте", detail: "Чужих гарнитур не найдено." });
  }

  const tokenReferences = Object.values(usage.tokenUsage).reduce((sum, count) => sum + count, 0);
  if (tokenReferences > 0) {
    positives.push({
      label: "Токены используются",
      detail: `${String(tokenReferences)} обращений к ${String(Object.keys(usage.tokenUsage).length)} токенам через CSS-переменные.`,
    });
  }

  return positives;
};

/** Colours that exist in the kit but not as a role for the property they were used on. */
const buildKitGaps = (
  findings: readonly Finding[],
): { value: string; token: string; role: string; occurrences: number }[] => {
  const gaps = new Map<
    string,
    { value: string; token: string; role: string; occurrences: number }
  >();

  for (const finding of findings) {
    if (
      finding.rule !== "token.literal.color" ||
      finding.subkind !== "exact" ||
      finding.note === null
    ) {
      continue;
    }
    const role = /sys-роли «([^»]+)»/.exec(finding.note)?.[1];
    const token = finding.expected?.token ?? null;
    if (role === undefined || token === null) {
      continue;
    }

    const key = `${finding.actual}:${role}`;
    const existing = gaps.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      gaps.set(key, { value: finding.actual, token, role, occurrences: 1 });
    }
  }

  return [...gaps.values()].sort(
    (left, right) =>
      right.occurrences - left.occurrences || compareStrings(left.value, right.value),
  );
};

export const summaryExtras = (input: KitMetricsInput) => {
  const { observations, findings, usage, cleanFiles } = input;

  const adoption = computeAdoption(observations);
  const tokenCoverage = computeTokenCoverage(observations);

  const weight = findings.reduce((sum, finding) => sum + WEIGHT_BY_SEVERITY[finding.severity], 0);
  const perFile = observations.files.length === 0 ? 0 : weight / observations.files.length;
  const cleanliness = 1 - Math.min(1, perFile / ZERO_AT_WEIGHT_PER_FILE);

  const healthScore = Math.round(100 * (0.5 * cleanliness + 0.3 * adoption + 0.2 * tokenCoverage));

  return {
    healthScore,
    healthFormula: HEALTH_FORMULA,
    adoption,
    tokenCoverage,
    positives: buildPositives(observations, findings, usage, cleanFiles),
    kitGaps: buildKitGaps(findings),
  };
};
