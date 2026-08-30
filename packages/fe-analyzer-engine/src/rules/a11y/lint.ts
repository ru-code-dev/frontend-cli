import type { Severity } from "../../domain/findings.ts";
import type { RawFinding, Rule, RuleContext } from "../types.ts";
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
    wcag: ["1.1.1"],
    impact: "Изображение не будет описано вообще — скринридер прочитает имя файла или промолчит.",
    fix: 'Добавьте alt с описанием смысла картинки; если она чисто декоративная — пустой alt="".',
  },
  "anchor-has-content": {
    severity: "error",
    wcag: ["2.4.4"],
    impact: "Ссылка без текста объявляется как «ссылка» без указания, куда она ведёт.",
    fix: "Положите внутрь текст, а если там только иконка — задайте ссылке aria-label.",
  },
  "anchor-is-valid": {
    severity: "error",
    wcag: ["2.1.1"],
    impact: "Ссылка без href недостижима с клавиатуры.",
    fix: "Поставьте настоящий href; если это действие, а не переход, замените <a> на <button>.",
  },
  "anchor-ambiguous-text": {
    severity: "info",
    wcag: ["2.4.4"],
    impact: "«Здесь» и «подробнее» вне контекста не говорят, куда ведёт ссылка.",
    fix: "Напишите в тексте ссылки её цель — «Условия доставки» вместо «подробнее».",
  },
  "aria-activedescendant-has-tabindex": {
    severity: "error",
    wcag: ["2.1.1"],
    impact: "Составной виджет не получит фокус, и управлять им с клавиатуры не выйдет.",
    fix: "Добавьте контейнеру tabIndex={0} — тому элементу, который несёт aria-activedescendant.",
  },
  "aria-proptypes": {
    severity: "error",
    wcag: ["4.1.2"],
    impact: "Значение ARIA-атрибута недопустимо: состояние объявляется неверно или игнорируется.",
    fix: 'Приведите значение к типу из спецификации: обычно строка "true"/"false", а не число или объект.',
  },
  "autocomplete-valid": {
    severity: "warning",
    wcag: ["1.3.5"],
    impact: "Браузер не подставит сохранённые данные — форму придётся заполнять руками.",
    fix: "Поставьте autocomplete из списка HTML — например email, tel, street-address.",
  },
  "click-events-have-key-events": {
    severity: "warning",
    wcag: ["2.1.1"],
    impact: "Действие доступно только мышью.",
    fix:
      "Замените элемент на <button>: он даёт и фокус, и Enter, и Space бесплатно. " +
      "Если тег менять нельзя — добавьте onKeyDown на Enter и Space.",
  },
  "heading-has-content": {
    severity: "error",
    wcag: ["1.3.1"],
    impact: "Пустой заголовок ломает навигацию по структуре страницы.",
    fix: "Положите в заголовок текст — или уберите тег, если заголовка здесь нет.",
  },
  "html-has-lang": {
    severity: "error",
    wcag: ["3.1.1"],
    impact: "Синтезатор речи прочитает текст с неверным произношением.",
    fix: 'Добавьте <html lang="ru"> — язык основного содержимого страницы.',
  },
  "iframe-has-title": {
    severity: "error",
    wcag: ["4.1.2"],
    impact: "Встроенный фрейм объявляется без названия — непонятно, что внутри.",
    fix: 'Задайте <iframe title="…"> — коротко о том, что во фрейме.',
  },
  "img-redundant-alt": {
    severity: "info",
    wcag: ["1.1.1"],
    impact: "Скринридер произнесёт «изображение» дважды.",
    fix: "Уберите из alt слова «изображение», «картинка», «фото» — роль объявляется сама.",
  },
  "interactive-supports-focus": {
    severity: "error",
    wcag: ["2.1.1"],
    impact: "Интерактивный элемент не получает фокус: с клавиатуры до него не добраться.",
    fix: "Добавьте tabIndex={0} — или замените на нативный интерактивный тег.",
  },
  "label-has-associated-control": {
    severity: "error",
    wcag: ["1.3.1", "4.1.2"],
    impact: "Подпись не связана с полем — скринридер объявит поле безымянным.",
    fix: "Свяжите подпись с полем: htmlFor={id} на <label> и тот же id на поле — либо вложите поле внутрь <label>.",
  },
  "media-has-caption": {
    severity: "warning",
    wcag: ["1.2.2"],
    impact: "Аудиодорожка недоступна тем, кто не слышит.",
    fix: 'Добавьте <track kind="captions"> с субтитрами; для беззвучного видео — muted.',
  },
  "mouse-events-have-key-events": {
    severity: "warning",
    wcag: ["2.1.1"],
    impact: "Поведение при наведении не воспроизводится с клавиатуры.",
    fix: "Продублируйте onMouseOver/onMouseOut парой onFocus/onBlur.",
  },
  "no-access-key": {
    severity: "info",
    wcag: [],
    impact: "Горячая клавиша может конфликтовать с сочетаниями скринридера.",
    fix: "Уберите accessKey — навигация по фокусу и так работает.",
  },
  "no-autofocus": {
    severity: "warning",
    wcag: ["2.4.3"],
    impact: "Фокус уезжает без действия пользователя — контекст теряется.",
    fix: "Уберите autoFocus; если фокус нужен, ставьте его в ответ на действие пользователя.",
  },
  "no-distracting-elements": {
    severity: "error",
    wcag: ["2.2.2"],
    impact: "Мигающее и бегущее содержимое невозможно остановить.",
    fix: "Уберите <marquee> и <blink> — это устаревшие теги без замены.",
  },
  "no-interactive-element-to-noninteractive-role": {
    severity: "error",
    wcag: ["4.1.2"],
    impact: "Роль отменяет интерактивность, которая у элемента есть на самом деле.",
    fix: "Уберите role — либо возьмите неинтерактивный тег, если элемент и правда не кликается.",
  },
  "no-noninteractive-element-interactions": {
    severity: "warning",
    wcag: ["2.1.1"],
    impact: "Обработчик висит на элементе, до которого нельзя добраться с клавиатуры.",
    fix: "Перенесите обработчик на <button> или <a> внутри этого элемента.",
  },
  "no-noninteractive-element-to-interactive-role": {
    severity: "warning",
    wcag: ["4.1.2"],
    impact: "Элемент объявлен интерактивным, но не ведёт себя так.",
    fix: "Либо доведите поведение до роли — фокус и клавиши, — либо уберите role.",
  },
  "no-noninteractive-tabindex": {
    severity: "warning",
    wcag: ["2.4.3"],
    impact: "В порядок обхода попадает элемент, с которым нечего делать.",
    fix: "Уберите tabIndex с неинтерактивного элемента; для программного фокуса используйте tabIndex={-1}.",
  },
  "no-redundant-roles": {
    severity: "info",
    wcag: [],
    impact: "Роль дублирует семантику тега и переживёт его замену при рефакторинге.",
    fix: "Удалите role — тег уже несёт эту роль сам.",
  },
  "no-static-element-interactions": {
    severity: "warning",
    wcag: ["2.1.1"],
    impact: "Кликабельный <div> недоступен ни с клавиатуры, ни для скринридера.",
    fix: "Замените <div> на <button>. Если нельзя — role, tabIndex={0} и обработчик клавиш придётся добавить вручную.",
  },
  scope: {
    severity: "error",
    wcag: ["1.3.1"],
    impact: "Заголовки таблицы не связываются с ячейками.",
    fix: "Оставьте scope только на <th> — на остальных ячейках он игнорируется.",
  },
  "tabindex-no-positive": {
    severity: "warning",
    wcag: ["2.4.3"],
    impact: "Положительный tabindex ломает порядок обхода на всей странице.",
    fix: "Поставьте tabIndex={0} и задайте порядок обхода порядком элементов в разметке.",
  },
  lang: {
    severity: "warning",
    wcag: ["3.1.1"],
    impact: "Код языка недопустим — синтезатор речи выберет неверное произношение.",
    fix: "Поставьте код из BCP 47 — ru, en, en-GB.",
  },
  "no-aria-hidden-on-focusable": {
    severity: "error",
    wcag: ["4.1.2"],
    impact: "Элемент получает фокус, но скрыт от скринридера: фокус «проваливается в пустоту».",
    fix: "Уберите aria-hidden — либо уберите элемент из порядка обхода через tabIndex={-1}.",
  },
  "prefer-tag-over-role": {
    severity: "info",
    wcag: [],
    impact: "Нативный тег дал бы ту же семантику вместе с поведением.",
    fix: "Возьмите нативный тег вместо role: он приносит с собой ещё и клавиатуру.",
  },
};

const UNCLASSIFIED: RuleMeta = {
  severity: "info",
  wcag: [],
  impact: "Нарушение правила доступности; последствие не классифицировано в этой версии.",
};

export const jsxA11yLintRule: Rule = {
  id: "a11y.lint",
  category: "a11y",
  description: "Базовые правила доступности JSX (eslint-plugin-jsx-a11y)",
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
