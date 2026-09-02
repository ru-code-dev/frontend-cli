# Архитектура

Монорепозиторий на pnpm-воркспейсах. Публикуется **один** пакет — `cli`; остальные приватны и
нужны только затем, чтобы попасть в его бандл `fg.mjs`.

## Поток данных

```
fg --preport <src>            fg --psvg|--phtml|--pprompt|--passets <link|guid>
  └ fg-source                   └ fg-pixso ── pixso-core ── MCP (удалённый / локальный)
    └ fg-analyzer-engine ── KitAdapter ← fg-eds-adapter (профили eds / eds2)
      └ fg-analyzer-report (дашборд, html) · fg-lint-format (compact / json / sarif)
```

`cli/src/registry.ts` — единственное место, где пакеты команд названы поимённо; общий контракт
команды, локализацию и терминальный UI им даёт `cli-kit`.

## Пакеты

| Пакет | Имя | Роль |
| --- | --- | --- |
| `cli/` | `@smart-tools/frontend-guard` | **публикуемый**; bin `fg` → `dist/fg.mjs`; реестр команд, разбор argv, справка, `.env`, константы |
| `packages/cli-kit` | `@smart-tools/fg-cli-kit` | контракт: `CliCommand`, `Localized`, `CommandContext`; `ui.ts` — терминальный UI; `out.ts` — каталоги по умолчанию и `emitPaths` |
| `packages/fg-pixso` | `@smart-tools/fg-pixso` | `--psvg/--phtml/--pprompt/--passets` поверх pixso-core; ссылка → удалённый маршрут, guid → локальный |
| `packages/fg-source` | `@smart-tools/fg-source` | `resolveSource(<путь\|git-url>)`: локальный каталог либо неглубокий клон с уборкой |
| `packages/fg-analyzer-engine` | `@smart-tools/fg-analyzer-engine` | сканер и 11 общих правил, `analyzeProject`, шов `KitAdapter`, конфигурация как слой поверх результата |
| `packages/fg-eds-adapter` | `@smart-tools/fg-eds-adapter` | EDS 1.x и 2.x: два `KitProfile`, вшитые артефакты, правила дизайн-системы, корпус на диске |
| `packages/fg-analyzer-report` | `@smart-tools/fg-analyzer-report` | дашборд (React + Vite), `renderReport`, шаблон вшит как строка |
| `packages/fg-project-report` | `@smart-tools/fg-project-report` | команды `--preport`, `--iconf`, `--pkit`; автоопределение дизайн-системы, загрузка конфига |
| `packages/fg-kit-extract` | `@smart-tools/fg-kit-extract` | bin `fg-kit-extract`: компоненты и типы React-пакета дизайн-системы через ts-morph |
| `packages/fg-lint-format` | `@smart-tools/fg-lint-format` | чистые форматтеры `compact` / `json` / `sarif` поверх видимых находок |
| `packages/testkit` | `@smart-tools/fg-testkit` | фейковый MCP-сервер, общие фикстуры, прогон `test:e2e` |

## Инварианты

- Публикуемый артефакт — **один самодостаточный файл без зависимостей**; у `cli/package.json`
  нет ключа `dependencies`.
- Никаких новых рантайм-зависимостей для обвязки CLI.
- `catalog:` для каждой общей версии; версионных литералов в манифестах нет.
- Все строки, которые видит пользователь, — `Localized {ru, en}`, по умолчанию `ru`.
- `-o` не обязателен ни у одной команды, а у `--pkit` его нет вовсе. Там, где он есть, без него
  результат ложится под каталог по умолчанию.
- Необъявленный флаг — выход с кодом 2 и локализованным сообщением.
- Имена `PIXSO_REMOTE_MCP_URL`, `PIXSO_LOCAL_MCP_URL`, `PIXSO_REMOTE_MCP_TOKEN` зафиксированы и
  не переименовываются.

## Адаптеры дизайн-систем

Адаптер один, профилей несколько: всё, что зависит от версии, — **данные** в
`packages/fg-eds-adapter/src/profile.ts`; правила в `src/rules/**` при этом не меняются.

Третья дизайн-система — это один литерал `KitProfile`, один конвейер извлечения
(`src/extract/<name>/`), одна запись в `EDS_PROFILES`, один каталог вшитых артефактов и одна
строка в реестре автоопределения. `tests/profile.test.ts` обходит `EDS_PROFILES`, не называя
поимённо ни одну из них, — этим и проверяется, что сказанное выше остаётся правдой.
