import type { Severity } from "../../domain/findings.ts";
import { compareStrings } from "../../shared/sort.ts";
import type { RawFinding, Rule, RuleContext, RuleLabel } from "../types.ts";
import { lintSourceFix } from "./source-edit.ts";

/**
 * `a11y.lint` — turns the canonical linter's reports into findings of this engine's shape.
 * Ported verbatim from `hackathon2026/ds-analyzer/src/rules/a11y/lint.ts:1-283`, `RULE_META`
 * table included; h2 §2 row 1 records that this file names neither a kit nor a spec.
 *
 * The plugin decides *whether* something is wrong — it is the reference implementation and
 * better at that than anything written here would be. This file decides what it means for the
 * report: which WCAG criterion is at stake, how loudly to say it, what the reader actually
 * loses, and what to do about it. Those are editorial calls the plugin does not make and
 * should not.
 *
 * Severity is assigned per rule rather than taken from the linter, which reports everything at
 * whatever level the config set. A missing `alt` is a certainty;
 * `click-events-have-key-events` fires on patterns that are sometimes deliberate. Flattening
 * the two into one level is how a report earns the reputation that gets it switched off.
 */

interface RuleMeta {
  readonly severity: Severity;
  /**
   * The SUB-RULE's short name, ru/en — what the compact formatter prints on the row.
   *
   * `a11y.lint`'s own label («Базовое правило доступности») is true of all thirty and tells a
   * reader nothing about the row in front of them, so the label lives per plugin rule, here,
   * beside the severity and the consequence that are already editorial calls this file makes.
   */
  readonly label: RuleLabel;
  readonly wcag: readonly string[];
  readonly impact: string;
  /**
   * What to do, in one sentence.
   *
   * Optional here and `null`-filled below: a rule that arrives with a plugin upgrade must
   * still be reported, and inventing guidance for one nobody has read would be worse than
   * admitting there is none.
   */
  readonly fix?: string;
}

/**
 * The editorial layer: criterion, severity, consequence and remedy per rule.
 *
 * Rules absent from this table still produce findings, at `info` with no criterion — a new
 * rule appearing after a plugin upgrade must not vanish silently just because nobody has
 * classified it yet.
 */
const RULE_META: Readonly<Record<string, RuleMeta>> = {
  "alt-text": {
    severity: "error",
    label: { ru: "Изображение без alt", en: "Image without alt" },
    wcag: ["1.1.1"],
    impact: "Изображение не будет описано вообще — скринридер прочитает имя файла или промолчит.",
    fix: 'Добавьте alt с описанием смысла картинки; если она чисто декоративная — пустой alt="".',
  },
  "anchor-has-content": {
    severity: "error",
    label: { ru: "Ссылка без текста", en: "Link without text" },
    wcag: ["2.4.4"],
    impact: "Ссылка без текста объявляется как «ссылка» без указания, куда она ведёт.",
    fix: "Положите внутрь текст, а если там только иконка — задайте ссылке aria-label.",
  },
  "anchor-is-valid": {
    severity: "error",
    label: { ru: "Ссылка без href", en: "Link without href" },
    wcag: ["2.1.1"],
    impact: "Ссылка без href недостижима с клавиатуры.",
    fix: "Поставьте настоящий href; если это действие, а не переход, замените <a> на <button>.",
  },
  "anchor-ambiguous-text": {
    severity: "info",
    label: { ru: "Неясный текст ссылки", en: "Ambiguous link text" },
    wcag: ["2.4.4"],
    impact: "«Здесь» и «подробнее» вне контекста не говорят, куда ведёт ссылка.",
    fix: "Напишите в тексте ссылки её цель — «Условия доставки» вместо «подробнее».",
  },
  "aria-activedescendant-has-tabindex": {
    severity: "error",
    label: { ru: "activedescendant без tabindex", en: "activedescendant without tabindex" },
    wcag: ["2.1.1"],
    impact: "Составной виджет не получит фокус, и управлять им с клавиатуры не выйдет.",
    fix: "Добавьте контейнеру tabIndex={0} — тому элементу, который несёт aria-activedescendant.",
  },
  "aria-proptypes": {
    severity: "error",
    label: { ru: "Недопустимое значение ARIA", en: "Invalid ARIA attribute value" },
    wcag: ["4.1.2"],
    impact: "Значение ARIA-атрибута недопустимо: состояние объявляется неверно или игнорируется.",
    fix: 'Приведите значение к типу из спецификации: обычно строка "true"/"false", а не число или объект.',
  },
  "autocomplete-valid": {
    severity: "warning",
    label: { ru: "Недопустимый autocomplete", en: "Invalid autocomplete value" },
    wcag: ["1.3.5"],
    impact: "Браузер не подставит сохранённые данные — форму придётся заполнять руками.",
    fix: "Поставьте autocomplete из списка HTML — например email, tel, street-address.",
  },
  "click-events-have-key-events": {
    severity: "warning",
    label: { ru: "Клик без обработчика клавиш", en: "Click with no key handler" },
    wcag: ["2.1.1"],
    impact: "Действие доступно только мышью.",
    fix:
      "Замените элемент на <button>: он даёт и фокус, и Enter, и Space бесплатно. " +
      "Если тег менять нельзя — добавьте onKeyDown на Enter и Space.",
  },
  "heading-has-content": {
    severity: "error",
    label: { ru: "Пустой заголовок", en: "Empty heading" },
    wcag: ["1.3.1"],
    impact: "Пустой заголовок ломает навигацию по структуре страницы.",
    fix: "Положите в заголовок текст — или уберите тег, если заголовка здесь нет.",
  },
  "html-has-lang": {
    severity: "error",
    label: { ru: "Страница без языка", en: "Page without a language" },
    wcag: ["3.1.1"],
    impact: "Синтезатор речи прочитает текст с неверным произношением.",
    fix: 'Добавьте <html lang="ru"> — язык основного содержимого страницы.',
  },
  "iframe-has-title": {
    severity: "error",
    label: { ru: "Фрейм без названия", en: "Frame without a title" },
    wcag: ["4.1.2"],
    impact: "Встроенный фрейм объявляется без названия — непонятно, что внутри.",
    fix: 'Задайте <iframe title="…"> — коротко о том, что во фрейме.',
  },
  "img-redundant-alt": {
    severity: "info",
    label: { ru: "Лишнее слово в alt", en: "Redundant word in alt" },
    wcag: ["1.1.1"],
    impact: "Скринридер произнесёт «изображение» дважды.",
    fix: "Уберите из alt слова «изображение», «картинка», «фото» — роль объявляется сама.",
  },
  "interactive-supports-focus": {
    severity: "error",
    label: { ru: "Интерактивный элемент без фокуса", en: "Interactive element without focus" },
    wcag: ["2.1.1"],
    impact: "Интерактивный элемент не получает фокус: с клавиатуры до него не добраться.",
    fix: "Добавьте tabIndex={0} — или замените на нативный интерактивный тег.",
  },
  "label-has-associated-control": {
    severity: "error",
    label: { ru: "Подпись без поля", en: "Label with no control" },
    wcag: ["1.3.1", "4.1.2"],
    impact: "Подпись не связана с полем — скринридер объявит поле безымянным.",
    fix: "Свяжите подпись с полем: htmlFor={id} на <label> и тот же id на поле — либо вложите поле внутрь <label>.",
  },
  "media-has-caption": {
    severity: "warning",
    label: { ru: "Медиа без субтитров", en: "Media without captions" },
    wcag: ["1.2.2"],
    impact: "Аудиодорожка недоступна тем, кто не слышит.",
    fix: 'Добавьте <track kind="captions"> с субтитрами; для беззвучного видео — muted.',
  },
  "mouse-events-have-key-events": {
    severity: "warning",
    label: { ru: "Наведение без пары для клавиатуры", en: "Hover with no keyboard pair" },
    wcag: ["2.1.1"],
    impact: "Поведение при наведении не воспроизводится с клавиатуры.",
    fix: "Продублируйте onMouseOver/onMouseOut парой onFocus/onBlur.",
  },
  "no-access-key": {
    severity: "info",
    label: { ru: "Горячая клавиша accessKey", en: "accessKey shortcut" },
    wcag: [],
    impact: "Горячая клавиша может конфликтовать с сочетаниями скринридера.",
    fix: "Уберите accessKey — навигация по фокусу и так работает.",
  },
  "no-autofocus": {
    severity: "warning",
    label: { ru: "Автофокус при загрузке", en: "Autofocus on load" },
    wcag: ["2.4.3"],
    impact: "Фокус уезжает без действия пользователя — контекст теряется.",
    fix: "Уберите autoFocus; если фокус нужен, ставьте его в ответ на действие пользователя.",
  },
  "no-distracting-elements": {
    severity: "error",
    label: { ru: "Отвлекающий тег", en: "Distracting element" },
    wcag: ["2.2.2"],
    impact: "Мигающее и бегущее содержимое невозможно остановить.",
    fix: "Уберите <marquee> и <blink> — это устаревшие теги без замены.",
  },
  "no-interactive-element-to-noninteractive-role": {
    severity: "error",
    label: { ru: "Роль отменяет интерактивность", en: "Role cancels interactivity" },
    wcag: ["4.1.2"],
    impact: "Роль отменяет интерактивность, которая у элемента есть на самом деле.",
    fix: "Уберите role — либо возьмите неинтерактивный тег, если элемент и правда не кликается.",
  },
  "no-noninteractive-element-interactions": {
    severity: "warning",
    label: { ru: "Обработчик на неинтерактивном", en: "Handler on a non-interactive element" },
    wcag: ["2.1.1"],
    impact: "Обработчик висит на элементе, до которого нельзя добраться с клавиатуры.",
    fix: "Перенесите обработчик на <button> или <a> внутри этого элемента.",
  },
  "no-noninteractive-element-to-interactive-role": {
    severity: "warning",
    label: { ru: "Интерактивная роль без поведения", en: "Interactive role without behaviour" },
    wcag: ["4.1.2"],
    impact: "Элемент объявлен интерактивным, но не ведёт себя так.",
    fix: "Либо доведите поведение до роли — фокус и клавиши, — либо уберите role.",
  },
  "no-noninteractive-tabindex": {
    severity: "warning",
    label: { ru: "tabindex на неинтерактивном", en: "tabindex on a non-interactive element" },
    wcag: ["2.4.3"],
    impact: "В порядок обхода попадает элемент, с которым нечего делать.",
    fix: "Уберите tabIndex с неинтерактивного элемента; для программного фокуса используйте tabIndex={-1}.",
  },
  "no-redundant-roles": {
    severity: "info",
    label: { ru: "Роль дублирует тег", en: "Role duplicating the tag" },
    wcag: [],
    impact: "Роль дублирует семантику тега и переживёт его замену при рефакторинге.",
    fix: "Удалите role — тег уже несёт эту роль сам.",
  },
  "no-static-element-interactions": {
    severity: "warning",
    label: { ru: "Кликабельный div без роли", en: "Clickable div without a role" },
    wcag: ["2.1.1"],
    impact: "Кликабельный <div> недоступен ни с клавиатуры, ни для скринридера.",
    fix: "Замените <div> на <button>. Если нельзя — role, tabIndex={0} и обработчик клавиш придётся добавить вручную.",
  },
  scope: {
    severity: "error",
    label: { ru: "scope не на th", en: "scope outside th" },
    wcag: ["1.3.1"],
    impact: "Заголовки таблицы не связываются с ячейками.",
    fix: "Оставьте scope только на <th> — на остальных ячейках он игнорируется.",
  },
  "tabindex-no-positive": {
    severity: "warning",
    label: { ru: "Положительный tabindex", en: "Positive tabindex" },
    wcag: ["2.4.3"],
    impact: "Положительный tabindex ломает порядок обхода на всей странице.",
    fix: "Поставьте tabIndex={0} и задайте порядок обхода порядком элементов в разметке.",
  },
  lang: {
    severity: "warning",
    label: { ru: "Недопустимый код языка", en: "Invalid language code" },
    wcag: ["3.1.1"],
    impact: "Код языка недопустим — синтезатор речи выберет неверное произношение.",
    fix: "Поставьте код из BCP 47 — ru, en, en-GB.",
  },
  "no-aria-hidden-on-focusable": {
    severity: "error",
    label: { ru: "aria-hidden на фокусируемом", en: "aria-hidden on a focusable element" },
    wcag: ["4.1.2"],
    impact: "Элемент получает фокус, но скрыт от скринридера: фокус «проваливается в пустоту».",
    fix: "Уберите aria-hidden — либо уберите элемент из порядка обхода через tabIndex={-1}.",
  },
  "prefer-tag-over-role": {
    severity: "info",
    label: { ru: "Роль вместо нативного тега", en: "Role instead of a native tag" },
    wcag: [],
    impact: "Нативный тег дал бы ту же семантику вместе с поведением.",
    fix: "Возьмите нативный тег вместо role: он приносит с собой ещё и клавиатуру.",
  },
};

const UNCLASSIFIED: RuleMeta = {
  severity: "info",
  label: { ru: "Правило доступности вне таблицы", en: "Unclassified accessibility rule" },
  wcag: [],
  impact: "Нарушение правила доступности; последствие не классифицировано в этой версии.",
};

/**
 * The catalog line for one sub-rule: what the reader loses, not what the linter checks.
 *
 * `impact` is written as one or two sentences; the catalog shows one line, so the first
 * sentence is taken. A rule that ever arrives without an `impact` falls back to its own name,
 * which is at least the string its documentation is filed under.
 */
const firstSentence = (text: string): string => {
  const end = text.indexOf(". ");

  return end === -1 ? text : text.slice(0, end + 1);
};

/**
 * The sub-rules a config may address as `"a11y.lint/<name>"` (design D5), READ OFF
 * {@link RULE_META} rather than restated.
 *
 * This rule is the only one in the engine with a fixed, enumerable `subkind` set — the plugin
 * has a finite list of rules and this table classifies them. Deriving means a rule added to
 * the table above appears in `--init-config` and in the dashboard's panel on the same commit,
 * with the severity the table actually assigns.
 *
 * Sorted by id: {@link RULE_META}'s order is editorial (rules were classified in batches) and
 * a catalog the user reads has to be alphabetical.
 */
const LINT_SUBRULES: readonly {
  id: string;
  severity: Severity;
  description: string;
  label: RuleLabel;
}[] = Object.entries(RULE_META)
  .map(([id, meta]) => ({
    id,
    severity: meta.severity,
    description: meta.impact.length === 0 ? id : firstSentence(meta.impact),
    label: meta.label,
  }))
  .toSorted((left, right) => compareStrings(left.id, right.id));

export const jsxA11yLintRule: Rule = {
  id: "a11y.lint",
  category: "a11y",
  description: "Базовые правила доступности JSX (eslint-plugin-jsx-a11y)",
  label: { ru: "Базовое правило доступности", en: "Basic accessibility rule" },
  // Per sub-rule, from the table above — `alt-text` is a certainty, `no-access-key` is a
  // preference. A single declared severity here would be a lie the catalog would repeat.
  severity: "mixed",
  subrules: LINT_SUBRULES,
  run: (context: RuleContext): RawFinding[] =>
    context.observations.lintMessages.map((message) => {
      const meta = RULE_META[message.rule] ?? UNCLASSIFIED;

      // Two of the plugin's rules have a single unambiguous edit as their remedy. For those
      // the finding carries a real patch instead of a sentence; for the rest `actual` stays
      // the linter's message, which is prose and deliberately never matches the source.
      const patch = lintSourceFix(
        message.rule,
        context.sources.get(message.file)?.[message.line - 1],
        message.column,
      );

      return {
        rule: "a11y.lint",
        // The plugin's rule name is the subkind, so the report can group by it and a reader
        // can look the rule up by the name its documentation uses.
        subkind: message.rule,
        category: "a11y",
        severity: meta.severity,
        // The plugin is a static checker over one element: where it fires, it is right about
        // what it saw. What it cannot see is context, which is what the softer severities
        // above account for.
        confidence: meta.severity === "error" ? 0.95 : 0.75,
        file: message.file,
        line: message.line,
        column: message.column,
        actual: patch?.actual ?? message.message,
        expected:
          patch === null || patch.replaceWith.length === 0
            ? null
            : { token: null, cssVar: null, component: null, value: patch.replaceWith },
        why: message.message,
        note: null,
        rootCause: null,
        appliedTo: null,
        autoFixable: patch !== null,
        needsAgent: false,
        candidates: [],
        a11y: { wcag: [...meta.wcag], pattern: null, impact: meta.impact, fix: meta.fix ?? null },
        impactKey: `a11y.lint:${message.rule}`,
        replaceWith: patch?.replaceWith ?? null,
      };
    }),
};
