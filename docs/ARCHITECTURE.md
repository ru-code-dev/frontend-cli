# Архитектура

Монорепозиторий на pnpm-воркспейсах. Публикуется **один** пакет — `cli`; остальные приватны и
нужны только затем, чтобы попасть в его бандл `fg.mjs`.

## Поток данных

```
fg --preport <src>            fg --psvg|--phtml|--pprompt|--passets <link|guid>
  └ fg-source                   └ fg-pixso ── pixso-core ── MCP (удалённый / локальный)
    └ fg-analyzer-engine ── KitAdapter ← fg-eds-adapter (профили eds / eds2)
      └ fg-analyzer-report (дашборд, html) · fg-lint-format (compact / json / sarif)

fg install [--check] | fg uninstall
  └ fg-install ── preflight ru-code (вшит) → OUR_ROOT → <OUR_ROOT>/plugins/<id>
```

`cli/src/registry.ts` — единственное место, где пакеты команд названы поимённо; общий контракт
команды, локализацию и терминальный UI им даёт `cli-kit`.

## Пакеты

| Пакет                         | Имя                               | Роль                                                                                                                                                                                   |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/`                        | `@smart-tools/frontend-guard`     | **публикуемый**; bin `fg` → `dist/fg.mjs`; реестр команд, разбор argv, справка, `.env`, константы                                                                                      |
| `packages/cli-kit`            | `@smart-tools/fg-cli-kit`         | контракт: `CliCommand`, `Localized`, `CommandContext`; `ui.ts` — терминальный UI; `out.ts` — каталоги по умолчанию и `emitPaths`                                                       |
| `packages/fg-pixso`           | `@smart-tools/fg-pixso`           | `--psvg/--phtml/--pprompt/--passets` поверх pixso-core; ссылка → удалённый маршрут, guid → локальный                                                                                   |
| `packages/fg-source`          | `@smart-tools/fg-source`          | `resolveSource(<путь\|git-url>)`: локальный каталог либо неглубокий клон с уборкой                                                                                                     |
| `packages/fg-analyzer-engine` | `@smart-tools/fg-analyzer-engine` | сканер и 11 общих правил, `analyzeProject`, шов `KitAdapter`, конфигурация как слой поверх результата                                                                                  |
| `packages/fg-eds-adapter`     | `@smart-tools/fg-eds-adapter`     | EDS 1.x и 2.x: два `KitProfile`, вшитые артефакты, правила дизайн-системы, корпус на диске                                                                                             |
| `packages/fg-analyzer-report` | `@smart-tools/fg-analyzer-report` | дашборд (React + Vite), `renderReport`, шаблон вшит как строка                                                                                                                         |
| `packages/fg-project-report`  | `@smart-tools/fg-project-report`  | команды `--preport`, `--iconf`, `--pkit`; автоопределение дизайн-системы, загрузка конфига                                                                                             |
| `packages/fg-kit-extract`     | `@smart-tools/fg-kit-extract`     | bin `fg-kit-extract`: компоненты и типы React-пакета дизайн-системы через ts-morph                                                                                                     |
| `packages/fg-install`         | `@smart-tools/fg-install`         | `install` / `install --check` / `uninstall`: запуск вшитого preflight ru-code, атомарная замена `<OUR_ROOT>/plugins/<id>`, перезапуск; `./pack` — упаковка `vendor/ru-code` при сборке |
| `packages/fg-lint-format`     | `@smart-tools/fg-lint-format`     | чистые форматтеры `compact` / `json` / `sarif` поверх видимых находок                                                                                                                  |
| `packages/testkit`            | `@smart-tools/fg-testkit`         | фейковый MCP-сервер, общие фикстуры, прогон `test:e2e`                                                                                                                                 |

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

## Вшитая сборка ru-code (`vendor/ru-code`)

`fg install` несёт в себе две вещи из сборок ru-code: preflight-скрипт установщика и одну папку
плагина. Они лежат в `vendor/ru-code/` (каталог в `.gitignore`, в репозиторий не попадает):

```
vendor/ru-code/preflight.mjs           ← dist-bundle/staging/package/preflight.mjs из ru-code
vendor/ru-code/plugins/pixso/…         ← packages/t3-code-pixso-mcp-assistant-plugin/dist из ru-code-packages
```

Путь при сборке: `cli/tsdown.config.ts` вызывает `packVendor` (`packages/fg-install/src/pack.ts`,
экспорт `@smart-tools/fg-install/pack`). Каждый файл сжимается brotli (`node:zlib`) и кодируется в
base64; рядом записываются sha256 и размер исходных байтов. Результат одной строкой попадает в
бандл через `define` (`__FG_INSTALL_PAYLOAD__`) — так же, как версия (`__FG_VERSION__`). При
запуске `packages/fg-install/src/embedded.ts` распаковывает его и сверяет sha256 каждого файла;
после записи на диск установщик сверяет их ещё раз.

**Сборка падает**, если нет `vendor/ru-code/preflight.mjs`, нет папки плагина с `plugin.json`,
папок плагинов больше одной, внутри есть не обычный файл (например, симлинк) или в файлах найдена
запрещённая строка — список общий с проверкой репозитория (`packages/fg-install/src/forbidden.ts`). Юнит-тесты от
`vendor/` не зависят: команды получают полезную нагрузку как параметр, тесты подставляют
маленький плагин и поддельный preflight.

Константы ru-code, которые fg повторяет (имена `plugins`, `userdata`, `bin`, `current.json`,
`server-runtime.json`, `ru-code`, флаги node, `apiVersion` 2, шаблон `id`), собраны в одном файле —
`packages/fg-install/src/constants.ts`, у каждой в комментарии путь и строка в ru-code. Как
вычисляется корень ru-code, fg не повторяет: это ответ preflight.

Минимальная версия ru-code — там же, `MINIMUM_APP_VERSION` (сейчас `"0.0.34"`: встроенной сборке
pixso нужен `ctx.publish`, которого нет в 0.0.33). Установленная версия — поле `version` в
`<OUR_ROOT>/bin/current.json`; этот файл читает одна функция, `pointerOf`
(`packages/fg-install/src/layout.ts`), ею же пользуется проверка перекрытия. Сравнение —
`packages/fg-install/src/version.ts`, перенос `isAtLeast` ru-code с разбором версии как у его
лаунчера (`X.Y.Z` с начала строки, суффикс после патча не учитывается). Проверка стоит в
`fg install` до любой записи и в `--check`; в `fg uninstall` её нет. Поднимать константу, когда
новая сборка плагина в `vendor/` требует более нового ru-code.

Служебные папки fg — `<OUR_ROOT>/.fg-install/{lock,new,old}`, вне `plugins/`: ru-code читает как
плагин каждую подпапку `plugins/`, включая скрытые. Замена: блокировка → копия в `new/` → сверка
sha256 → `rename` цели в `old/` и `new/` в цель → удаление `old/`. Перезапуск повторяет установщик
ru-code: node напрямую с `bin/cli.js`, без sh-обёртки; preflight и перезапуск получают окружение,
снятое при загрузке модуля, — без `.env` проекта и настроек Pixso.

## Адаптеры дизайн-систем

Адаптер один, профилей несколько: всё, что зависит от версии, — **данные** в
`packages/fg-eds-adapter/src/profile.ts`; правила в `src/rules/**` при этом не меняются.

Третья дизайн-система — это один литерал `KitProfile`, один конвейер извлечения
(`src/extract/<name>/`), одна запись в `EDS_PROFILES`, один каталог вшитых артефактов и одна
строка в реестре автоопределения. `tests/profile.test.ts` обходит `EDS_PROFILES`, не называя
поимённо ни одну из них, — этим и проверяется, что сказанное выше остаётся правдой.
