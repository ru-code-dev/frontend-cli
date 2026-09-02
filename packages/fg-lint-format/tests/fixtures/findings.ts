/**
 * ONE hand-built fixture set, shared by all four format suites.
 *
 * Hand-built rather than produced by `analyzeProject`, deliberately: a formatter test that
 * runs the analyser proves the analyser, is slow, and changes its golden every time a rule's
 * wording changes. These six findings are chosen to cover exactly the things a formatter can
 * get wrong —
 *
 *   ≥3 FILES, so grouping, per-file counters and the `json` sort have something to do;
 *   ALL FOUR SEVERITIES, so `compact`'s four glyphs and colours, the ESLint 2/1 mapping and
 *     the SARIF `note` mapping are each exercised;
 *   TWO WITH `expected.value`, so the ` → …` suffix, `fix.text` and `properties.expected`
 *     have a value, and the other four prove the absent case;
 *   ONE `why` CARRYING `</script>` AND A `"`, because this text is embedded in an HTML report
 *     elsewhere in the pipeline and serialised into two JSON documents here — a formatter
 *     that hand-rolls quoting instead of using `JSON.stringify` fails on this row;
 *   ONE `subkind`, because SARIF carries it in `properties` and `a11y.lint`'s sub-rules are
 *     the reason it exists (design D5).
 *
 * The list is ordered the way the engine emits findings — by file, then line, then column —
 * because design §6 forbids the formatters from re-sorting differently, and a fixture in some
 * other order would make the goldens assert an order no real run produces.
 */
import type {
  Finding,
  FindingCategory,
  RuleCatalogEntry,
  RuleLabel,
  Severity,
} from "@smart-tools/fg-analyzer-engine";

/** Everything a `Finding` needs that no formatter reads; overridden per fixture below. */
function finding(
  seed: Pick<
    Finding,
    | "id"
    | "rule"
    | "subkind"
    | "category"
    | "severity"
    | "file"
    | "line"
    | "column"
    | "actual"
    | "why"
    | "impactKey"
  > &
    Partial<Pick<Finding, "expected" | "confidence">>,
): Finding {
  return {
    id: seed.id,
    rule: seed.rule,
    subkind: seed.subkind,
    category: seed.category,
    severity: seed.severity,
    confidence: seed.confidence ?? 0.9,
    file: seed.file,
    line: seed.line,
    column: seed.column,
    snippet: { before: seed.actual, after: null, highlightLine: 1, startLine: seed.line },
    actual: seed.actual,
    expected: seed.expected ?? null,
    why: seed.why,
    note: null,
    rootCause: null,
    appliedTo: null,
    a11y: null,
    autoFixable: false,
    needsAgent: false,
    candidates: [],
    impact: { occurrences: 1, files: 1 },
    impactKey: seed.impactKey,
  };
}

export const PROJECT_ROOT = "/home/dev/projects/shop";

export const FIXTURE_FINDINGS: readonly Finding[] = [
  finding({
    id: "f1",
    rule: "a11y.name.missing",
    subkind: null,
    category: "a11y",
    severity: "error",
    file: "src/components/Button.tsx",
    line: 12,
    column: 5,
    actual: "<button onClick={onClick} />",
    why: "Кнопка без доступного имени: скринридер прочитает её как «кнопка».",
    impactKey: "a11y.name.missing:button",
  }),
  finding({
    id: "f2",
    rule: "a11y.lint",
    subkind: "alt-text",
    category: "a11y",
    severity: "warning",
    file: "src/components/Button.tsx",
    line: 12,
    column: 40,
    actual: "<img src={icon} />",
    why: "У изображения нет атрибута alt, содержимое недоступно скринридеру.",
    confidence: 1,
    impactKey: "a11y.lint:alt-text",
  }),
  finding({
    id: "f3",
    rule: "style.override.size",
    subkind: "size",
    category: "override",
    severity: "info",
    file: "src/components/Button.tsx",
    line: 48,
    column: 3,
    actual: "width: 42px",
    why: "Размер компонента переопределён снаружи.",
    expected: { token: null, cssVar: null, component: null, value: "var(--eds-size-m)" },
    confidence: 0.75,
    impactKey: "style.override.size:width",
  }),
  finding({
    id: "f4",
    rule: "component.duplicate",
    subkind: null,
    category: "component",
    severity: "candidate",
    file: "src/pages/Home.tsx",
    line: 7,
    column: 1,
    actual: "const Card = () => …",
    // `</script>` + a double quote: the two characters that break naive embedding/quoting.
    why: 'Дубликат компонента: разметка совпадает с Card на 92%, включая литерал "</script>" в шаблоне.',
    confidence: 0.6,
    impactKey: "component.duplicate:Card",
  }),
  finding({
    id: "f5",
    rule: "token.tier.violation",
    subkind: null,
    category: "token",
    severity: "error",
    file: "src/pages/Home.tsx",
    line: 130,
    column: 22,
    actual: "var(--eds-core-blue-500)",
    why: "Токен уровня core использован напрямую в коде продукта.",
    impactKey: "token.tier.violation:--eds-core-blue-500",
  }),
  finding({
    id: "f6",
    rule: "token.literal.color",
    // A NAMED shade (V5 finding #6): the row reads «Цвет литералом вместо токена — почти токен».
    subkind: "near",
    category: "token",
    severity: "warning",
    file: "src/styles/theme.css",
    line: 3,
    column: 9,
    actual: "#1a1a1a",
    why: "Цвет задан литералом вместо токена.",
    expected: {
      token: "color.fg",
      cssVar: "--eds-color-fg",
      component: null,
      value: "var(--eds-color-fg)",
    },
    impactKey: "token.literal.color:#1a1a1a",
  }),
];

/**
 * A finding whose `file` arrived with Windows separators.
 *
 * Kept OUT of the main set so the goldens stay readable, and used by the path tests: SARIF's
 * `artifactLocation.uri` is a URI, so `\` must become `/` there, and the two text formats must
 * not emit a path that mixes both separators.
 */
export const WINDOWS_FINDING: Finding = finding({
  id: "w1",
  rule: "icon.foreign-pack",
  subkind: null,
  category: "icon",
  severity: "warning",
  file: "src\\legacy\\Old.tsx",
  line: 2,
  column: 11,
  actual: "import { Icon } from 'lucide-react'",
  why: "Иконка из чужого пакета.",
  impactKey: "icon.foreign-pack:lucide-react",
});

/** A finding for a rule the catalog does not list — the `ruleIndex` fallback case. */
export const UNCATALOGUED_FINDING: Finding = finding({
  id: "u1",
  rule: "future.rule.nobody.declared",
  subkind: null,
  category: "component",
  severity: "info",
  file: "src/pages/Home.tsx",
  line: 200,
  column: 1,
  actual: "<Whatever />",
  why: "Правило из адаптера, которого нет в каталоге этого запуска.",
  impactKey: "future.rule.nobody.declared:1",
});

function entry(
  id: string,
  category: FindingCategory,
  description: string,
  label: RuleLabel,
  builtinSeverity: Severity | "mixed",
  origin: string,
  subkindLabels: Readonly<Record<string, RuleLabel>> = {},
): RuleCatalogEntry {
  return { id, category, description, label, builtinSeverity, subkindLabels, subrules: [], origin };
}

/**
 * A catalog shaped like a real one: it lists rules that DID fire and rules that did not, in
 * the engine's order (category order, then id). `ruleIndex` is only a meaningful assertion
 * when the table has rows the findings never touch — otherwise index 0 would be right by
 * accident.
 */
export const FIXTURE_CATALOG: readonly RuleCatalogEntry[] = [
  // THE RULE V5 FINDING #6 IS ABOUT: one label, four shades. Its `subkindLabels` are what turns
  // seven identical rows into seven rows that say which way the colour is wrong.
  entry(
    "token.literal.color",
    "token",
    "Цвет задан литералом вместо токена",
    { ru: "Цвет литералом вместо токена", en: "Colour literal instead of a token" },
    "mixed",
    "eds",
    {
      exact: { ru: "точно токен", en: "exactly a token" },
      near: { ru: "почти токен", en: "nearly a token" },
      shade: { ru: "оттенок токена", en: "a shade of a token" },
      foreign: { ru: "чужой цвет", en: "a colour from outside the palette" },
    },
  ),
  entry(
    "token.tier.violation",
    "token",
    "Прямое использование core-токена",
    { ru: "ref-переменная вместо sys-роли", en: "Ref variable instead of a sys role" },
    "error",
    "eds",
  ),
  entry(
    "style.override.size",
    "override",
    "Внешнее переопределение размера",
    { ru: "Изменение внутренних отступов кита", en: "Kit component's inner padding overridden" },
    "info",
    "eds",
  ),
  entry(
    "component.duplicate",
    "component",
    "Дубликат компонента",
    { ru: "Скопирован внутри проекта", en: "Copy-pasted inside the project" },
    "candidate",
    "engine",
  ),
  entry(
    "icon.foreign-pack",
    "icon",
    "Иконка из чужого пакета",
    { ru: "Сторонний пакет иконок", en: "Third-party icon package" },
    "warning",
    "engine",
  ),
  {
    id: "a11y.lint",
    category: "a11y",
    description: "Проверки eslint-plugin-jsx-a11y",
    label: { ru: "Базовое правило доступности", en: "Basic accessibility rule" },
    builtinSeverity: "mixed",
    // A SUB-RULE names the shade already — it IS the subkind — so `a11y.lint` declares no
    // subkind labels and its rows are never suffixed twice.
    subkindLabels: {},
    subrules: [
      {
        id: "alt-text",
        severity: "error",
        description: "Изображение без alt",
        label: { ru: "Изображение без alt", en: "Image without alt" },
      },
      {
        id: "no-autofocus",
        severity: "warning",
        description: "Автофокус уводит пользователя",
        label: { ru: "Автофокус при загрузке", en: "Autofocus on load" },
      },
    ],
    origin: "engine",
  },
  entry(
    "a11y.name.missing",
    "a11y",
    "Элемент без доступного имени",
    { ru: "Контрол без доступного имени", en: "Control with no accessible name" },
    "error",
    "engine",
  ),
];

/**
 * `actual` longer than the 60 columns design §2.4 truncates at, and a `why` long enough to
 * wrap under `--verbose`. Kept out of the main set so the goldens stay readable.
 */
export const LONG_FINDING: Finding = finding({
  id: "l1",
  rule: "token.literal.color",
  subkind: "foreign",
  category: "token",
  severity: "warning",
  file: "src/styles/theme.css",
  line: 9,
  column: 19,
  actual: "linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0%, rgba(255, 255, 255, 0.42) 100%)",
  why: "Цвет задан литералом вместо токена палитры, поэтому тема его не переопределит и в тёмной теме элемент останется светлым.",
  impactKey: "token.literal.color:gradient",
});

/**
 * A finding whose `actual` and `why` carry a newline and an ANSI escape.
 *
 * Not a hypothetical: `actual` is a fragment of the analysed project's source, so it contains
 * whatever that project's author typed. A row that let either through would forge a second row
 * or repaint the reader's terminal.
 */
export const NASTY_FINDING: Finding = finding({
  id: "n1",
  rule: "icon.foreign-pack",
  subkind: null,
  category: "icon",
  severity: "warning",
  file: "src/legacy/Old.tsx",
  line: 2,
  column: 11,
  actual: "import '\u001b[31mlucide\u001b[0m'\n   999:1  \u2716 error    подделка",
  why: "Первая строка.\n  Вторая строка.",
  impactKey: "icon.foreign-pack:nasty",
});
