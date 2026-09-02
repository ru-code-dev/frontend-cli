/**
 * Reading the injected payload, and the display vocabulary for it.
 *
 * The shapes themselves live in `contract.ts` and are re-exported here, so every screen
 * keeps importing from one place. Everything the reader sees is Russian; the analyzer's
 * machine identifiers (rule ids, subkinds, limitation reasons) are translated here rather
 * than in the artifact, so the JSON stays diffable and the UI stays readable.
 */

export type {
  A11yFacet,
  CustomComponent,
  Expected,
  Finding,
  FindingCategory,
  Payload,
  Severity,
  Snippet,
  Summary,
  Usage,
} from "./contract.js";

import type { FindingCategory, Payload, Severity } from "./contract.js";

/**
 * Reads the injected payload.
 *
 * Throws rather than rendering an empty shell: an un-substituted template is a generator
 * bug, and a dashboard that silently shows "0 findings" for it would be the most
 * misleading possible failure.
 */
export const readPayload = (): Payload => {
  const element = document.getElementById("ds-data");

  if (!element?.textContent) {
    throw new Error("No analysis payload found. This file is the unsubstituted template.");
  }

  const parsed: unknown = JSON.parse(element.textContent);

  if (parsed === null || typeof parsed !== "object") {
    throw new Error("The analysis payload is empty. Regenerate the report.");
  }

  return parsed as Payload;
};

export const SEVERITY_ORDER: readonly Severity[] = ["error", "warning", "info", "candidate"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Ошибка",
  warning: "Предупреждение",
  info: "Заметка",
  candidate: "Кандидат",
};

/** What each severity actually means for the reader, shown next to the counters. */
export const SEVERITY_HINT: Record<Severity, string> = {
  error: "уже сломано или сломается при обновлении кита",
  warning: "разойдётся при смене темы или версии",
  info: "сегодня выглядит правильно, но записано мимо системы",
  candidate: "вход для команды дизайн-системы, а не долг продукта",
};

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  token: "Токены",
  typography: "Типографика",
  font: "Шрифты",
  api: "API кита",
  override: "Переопределения",
  component: "Компоненты",
  icon: "Иконки",
  a11y: "Доступность",
};

/**
 * Human names for rule ids.
 *
 * The id stays visible in expanded views — it is what people grep for and put in
 * `ds.config.json` — but a list of dotted identifiers is not a report.
 */
export const RULE_LABEL: Record<string, string> = {
  "token.literal.color": "Цвет литералом вместо токена",
  "token.literal.dimension": "Размер литералом вместо токена",
  "token.typography.partial": "Типографика набрана вручную",
  "token.tier.violation": "ref-переменная вместо sys-роли",
  "font.foreign": "Гарнитура не из кита",
  "import.bypass": "Импорт в обход кита",
  "import.internal": "Импорт внутренним путём",
  "api.dnu": "Импорт запрещённого модуля",
  "prop.invalid": "Несуществующее значение пропа",
  "api.deprecated": "Устаревший API",
  "style.override.repaint": "Перекраска компонента кита",
  "style.override.size": "Изменение внутренних отступов кита",
  "style.override.inner": "Стилизация приватного слота",
  "style.override.important": "!important поверх стилей кита",
  "a11y.focus.suppressed": "Кольцо фокуса убрано без замены",
  "a11y.pattern.keyboard": "Виджет недоступен с клавиатуры",
  "icon.inline-svg": "Инлайновый SVG вместо иконки кита",
  "icon.foreign-file": "SVG-файл мимо набора иконок",
  "icon.foreign-pack": "Сторонний пакет иконок",
  "component.custom": "Компонент, который кит уже умеет",
  "component.ambiguous": "Похож на компонент кита — проверить",
  "component.fork": "Разошедшаяся копия компонента кита",
  "component.novel": "Кандидат в дизайн-систему",
  "component.duplicate": "Скопирован внутри проекта",
  "a11y.pattern.focus": "Диалог не отпускает и не удерживает фокус",
  "a11y.pattern.relations": "ARIA-связь ведёт в никуда",
  "a11y.aria.invalid": "Несуществующая роль или ARIA-атрибут",
  "a11y.aria.required": "Роль без обязательного состояния",
  "a11y.aria.redundant": "Роль дублирует семантику тега",
  "a11y.name.missing": "Контрол без доступного имени",
  "a11y.contrast.text": "Текст не набирает контраст",
  "a11y.lint": "Базовое правило доступности",
};

export const ruleLabel = (rule: string): string => RULE_LABEL[rule] ?? rule;

export const SUBKIND_LABEL: Record<string, string> = {
  exact: "точно токен",
  near: "почти токен",
  shade: "оттенок токена",
  foreign: "чужой цвет",
  onScale: "значение есть на шкале",
  offScale: "мимо шкалы",
  noScale: "шкалы нет — магическое число",
  blanket: "сброс без замены",
  onFocus: "убрано прямо на :focus",
  noHandler: "обработчика клавиш нет",
  handlerUnreadable: "обработчик объявлен отдельно",
  noEscape: "не закрывается по Escape",
  noFocusTrap: "не удерживает фокус",
  danglingId: "ссылка на несуществующий id",
  unmatchedExpression: "выражения не совпали",
  unknownRole: "роли нет в спецификации",
  abstractRole: "абстрактная роль",
  unknownAttribute: "атрибута нет в спецификации",
  unsupportedAttribute: "роль не поддерживает атрибут",
  prohibitedAttribute: "атрибут запрещён для роли",
  iconOnly: "только иконка, без имени",
  unlabelled: "имя должно приходить из aria-labelledby",
  empty: "ни текста, ни метки",
  normalText: "обычный текст, порог 4.5:1",
  largeText: "крупный текст, порог 3:1",
  "kit-icon": "ровно эта иконка есть в ките",
  "no-match": "нет в ките — кандидат в набор",
};

export const subkindLabel = (subkind: string): string => SUBKIND_LABEL[subkind] ?? subkind;

/**
 * WCAG 2.1 success criteria, by the number the rules cite.
 *
 * Only the ones some rule can actually produce. A criterion the analyzer never references
 * would be a promise the report does not keep, and a full copy of the standard here would
 * turn a working vocabulary into a document to maintain.
 */
export const WCAG_LABEL: Record<string, string> = {
  "1.1.1": "Нетекстовый контент",
  "1.2.2": "Субтитры к записанному",
  "1.3.1": "Информация и связи",
  "1.3.5": "Назначение поля ввода",
  "1.4.3": "Контраст (минимум)",
  "1.4.11": "Контраст нетекстовых элементов",
  "2.1.1": "Клавиатура",
  "2.1.2": "Фокус не запирается",
  "2.2.2": "Пауза, остановка, скрытие",
  "2.4.3": "Порядок обхода фокусом",
  "2.4.4": "Назначение ссылки",
  "2.4.7": "Видимый фокус",
  "3.1.1": "Язык страницы",
  "4.1.2": "Имя, роль, значение",
};

export const wcagLabel = (criterion: string): string => WCAG_LABEL[criterion] ?? criterion;

export const LIMITATION_LABEL: Record<string, string> = {
  "dynamic-styles": "динамические стили",
  "parse-error": "ошибка разбора",
  "unreadable-config": "нечитаемый конфиг",
  "spec-unavailable": "спецификация кита не собрана",
  "unresolved-import": "неразрешённый импорт",
};

export const limitationLabel = (reason: string): string => LIMITATION_LABEL[reason] ?? reason;

/** Defined in `lib/severity.ts` so the analyzer's tests can reach it; re-exported here, where callers expect it. */
export { SEVERITY_WEIGHT } from "./lib/severity.js";

export const VERDICT_LABEL: Record<"kit-like" | "kit-candidate" | "local", string> = {
  "kit-like": "похож на компонент кита",
  "kit-candidate": "кандидат в дизайн-систему",
  local: "локальный",
};

export const TOKEN_VERDICT_LABEL: Record<"tokens" | "mixed" | "hardcode" | "no-styles", string> = {
  tokens: "на токенах ДС",
  mixed: "токены + хардкод",
  hardcode: "хардкод",
  "no-styles": "без стилей",
};

export const NAME_MATCH_LABEL: Record<"exact" | "contains" | "similar", string> = {
  exact: "имя совпадает с китом",
  contains: "имя содержит имя компонента кита",
  similar: "имя почти совпадает с китом",
};
