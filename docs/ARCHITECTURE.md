# Архитектура

Монорепозиторий на pnpm-воркспейсах. Публикуется **один** пакет — `cli`; остальные приватны и
нужны только затем, чтобы попасть в его бандл `fg.mjs`.

## Поток данных

```
fguard --preport <src>            fguard --psvg|--phtml|--pprompt|--passets <link|guid>
  └ fg-source                   └ fg-pixso ── pixso-core ── MCP (удалённый / локальный)
    └ fg-analyzer-engine ── KitAdapter ← fg-eds-adapter (профили eds / eds2)
      └ fg-analyzer-report (дашборд, html) · fg-lint-format (compact / json / sarif)

fguard install [--check] | fguard uninstall
  └ fg-install ── preflight ru-code (вшит) → OUR_ROOT → <OUR_ROOT>/plugins/<id>

bash install [--uninstall]                     (релиз: fg.mjs + install + ru-code-install)
  └ install (bash) ── ru-code-install: detect_os, check_node_floor → <NODE>
    └ <NODE> fg.mjs setup <NODE> | teardown    (скрытые команды fg-install)
      ├ preflight ru-code → OUR_ROOT, CONFIG_DIR, CLI_JS
      ├ <OUR_ROOT>/fg/bin ← fg.mjs (в PATH); <OUR_ROOT>/fg ← install, ru-code-install (вне PATH)
      ├ bash: ru-code-install → create_wrapper, clean_rc, add_path   (env.sh / rc-строка fguard)
      ├ <CONFIG_DIR>/skills/fg-* ← три SKILL.md
      └ плагин pixso — правилом fguard install

fguard token [<токен>] → <папка fg.mjs>/.env (600) ← cli/src/dotenv.ts читает его после ./.env
```

`cli/src/registry.ts` — единственное место, где пакеты команд названы поимённо; общий контракт
команды, локализацию и терминальный UI им даёт `cli-kit`.

## Пакеты

| Пакет                         | Имя                               | Роль                                                                                                                                                                                   |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/`                        | `@smart-tools/frontend-guard`     | **публикуемый**; bin `fguard` → `dist/fg.mjs`; реестр команд, разбор argv, справка, `.env`, константы                                                                                      |
| `packages/cli-kit`            | `@smart-tools/fg-cli-kit`         | контракт: `CliCommand`, `Localized`, `CommandContext`; `ui.ts` — терминальный UI; `out.ts` — каталоги по умолчанию и `emitPaths`                                                       |
| `packages/fg-pixso`           | `@smart-tools/fg-pixso`           | `--psvg/--phtml/--pprompt/--passets` поверх pixso-core; ссылка → удалённый маршрут, guid → локальный                                                                                   |
| `packages/fg-source`          | `@smart-tools/fg-source`          | `resolveSource(<путь\|git-url>)`: локальный каталог либо неглубокий клон с уборкой                                                                                                     |
| `packages/fg-analyzer-engine` | `@smart-tools/fg-analyzer-engine` | сканер и 11 общих правил, `analyzeProject`, шов `KitAdapter`, конфигурация как слой поверх результата                                                                                  |
| `packages/fg-eds-adapter`     | `@smart-tools/fg-eds-adapter`     | EDS 1.x и 2.x: два `KitProfile`, вшитые артефакты, правила дизайн-системы, корпус на диске                                                                                             |
| `packages/fg-analyzer-report` | `@smart-tools/fg-analyzer-report` | дашборд (React + Vite), `renderReport`, шаблон вшит как строка                                                                                                                         |
| `packages/fg-project-report`  | `@smart-tools/fg-project-report`  | команды `--preport`, `--iconf`, `--pkit`; автоопределение дизайн-системы, загрузка конфига                                                                                             |
| `packages/fg-kit-extract`     | `@smart-tools/fg-kit-extract`     | bin `fg-kit-extract`: компоненты и типы React-пакета дизайн-системы через ts-morph                                                                                                     |
| `packages/fg-install`         | `@smart-tools/fg-install`         | `install` / `install --check` / `uninstall`: запуск вшитого preflight ru-code, атомарная замена `<OUR_ROOT>/plugins/<id>`, перезапуск; скрытые `setup` / `teardown` для `bash install` (`rc.ts`, `skills.ts`, `install.sh`); `./pack` — упаковка `vendor/ru-code` при сборке |
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

`fguard install` несёт в себе две вещи из сборок ru-code: preflight-скрипт установщика и одну папку
плагина; `bash install` — ещё и сам установщик ru-code. Они лежат в `vendor/ru-code/` (каталог в
`.gitignore`, в репозиторий не попадает):

```
vendor/ru-code/preflight.mjs           ← apps/server/dist/preflight.mjs из ru-code (build:preflight)
vendor/ru-code/install                 ← install из ru-code (build:installer) — в релиз как ru-code-install
vendor/ru-code/plugins/pixso/…         ← packages/t3-code-pixso-mcp-assistant-plugin/dist из ru-code-packages
```

`install` в бандл не вшивается: его копирует `scripts/release.mjs` (`vendorInstaller` в
`pack.ts` проверяет, что файл есть и в нём нет запрещённых строк).

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

Константы ru-code, которые fguard повторяет (имена `plugins`, `userdata`, `bin`, `current.json`,
`server-runtime.json`, `ru-code`, флаги node, `apiVersion` 2, шаблон `id`), собраны в одном файле —
`packages/fg-install/src/constants.ts`, у каждой в комментарии путь и строка в ru-code. Как
вычисляется корень ru-code, fguard не повторяет: это ответ preflight.

Минимальная версия ru-code — там же, `MINIMUM_APP_VERSION` (сейчас `"0.0.34"`: встроенной сборке
pixso нужен `ctx.publish`, которого нет в 0.0.33). Установленная версия — поле `version` в
`<OUR_ROOT>/bin/current.json`; этот файл читает одна функция, `pointerOf`
(`packages/fg-install/src/layout.ts`), ею же пользуется проверка перекрытия. Сравнение —
`packages/fg-install/src/version.ts`, перенос `isAtLeast` ru-code с разбором версии как у его
лаунчера (`X.Y.Z` с начала строки, суффикс после патча не учитывается). Проверка стоит в
`fguard install` до любой записи и в `--check`; в `fguard uninstall` её нет. Поднимать константу, когда
новая сборка плагина в `vendor/` требует более нового ru-code.

Служебные папки fguard — `<OUR_ROOT>/.fg-install/{lock,new,old}`, вне `plugins/`: ru-code читает как
плагин каждую подпапку `plugins/`, включая скрытые. Замена: блокировка → копия в `new/` → сверка
sha256 → `rename` цели в `old/` и `new/` в цель → удаление `old/`. Перезапуск повторяет установщик
ru-code: node напрямую с `bin/cli.js`, без sh-обёртки; preflight и перезапуск получают окружение,
снятое при загрузке модуля, — без `.env` проекта и настроек Pixso.

## `bash install`: команда `fguard`, навыки, токен

Ничего про node и rc-файлы fguard не вычисляет сам — это код установщика ru-code из
`vendor/ru-code/install` (свежая сборка HEAD), в релизе он лежит дословно как `ru-code-install`.
`install` (`packages/fg-install/install.sh`) подключает его через шов `RU_CODE_INSTALL_NO_MAIN=1`
и зовёт `detect_os` + `check_node_floor` — так node выбирается ровно как у установщика ru-code
(сначала поставляемый с CLI, затем `PATH`). Переопределяется только отрисовка отказа
(`fail_recommendation`): тот же заголовок и текст из таблицы ru-code, без его карточки.

Дальше `<NODE> fg.mjs setup <NODE>` (`createInstallCommands`, `packages/fg-install/src/commands.ts`):
preflight → `OUR_ROOT`, `CONFIG_DIR`, `CLI_JS`; `fg.mjs` → `<OUR_ROOT>/fg/bin` (каталог в `PATH`, в
нём только `fg.mjs`, `fguard`, `env.sh`, `.env`), `install` и `ru-code-install` → `<OUR_ROOT>/fg`;
rc — `applyRc` (`src/rc.ts`) запускает bash, который подключает скопированный `ru-code-install` и
вызывает `create_wrapper`, `clean_rc`, `add_path` с глобалами fguard (`APP_BIN=fguard`,
`BIN_DIR=<OUR_ROOT>/fg/bin`, `ENTRY_JS=fg.mjs`, `NODE_PATH=<NODE>`, `APP_DIR_NAME=<имя корня>/fg`);
все значения передаются через окружение, не подстановкой в текст скрипта. Метки строк
`/<имя корня>/bin` (ru-code) и `/<имя корня>/fg/bin` (fguard) не пересекаются; корень, который
сам содержит одну из них, `setup` отвергает до любой записи (`markerClash`). Навыки —
`src/skills.ts`: три `SKILL.md` с запечёнными абсолютными `<NODE>` и `fg.mjs`, фронтматтер —
JSON-строки (валидный YAML для парсера qwen). Плагин — то же правило, что `fguard install`.

`teardown`: `clean_rc` с меткой fguard, три папки навыков, плагин (как `fguard uninstall`), затем
`<OUR_ROOT>/fg/` целиком — вместе с токеном.

Токен: `fguard token` (`packages/fg-pixso/src/token.ts`) пишет `<binDir>/.env`, где `binDir` —
каталог работающего `fg.mjs` (`CommandContext.binDir`, его даёт `cli/src/main.ts`).
`loadDotEnv` грузит `./.env`, затем этот файл; `process.loadEnvFile` не перезаписывает уже
заданное, поэтому порядок загрузки и есть приоритет: окружение > `./.env` > `.env` fguard.
Отказ по токену — код 3: нет токена (`routing.ts`) или сервер ответил 401/403 — статус берётся из
поля `httpStatus` клиента pixso-core, который `commands.ts` оборачивает для удалённого маршрута.

`--format summary` (`packages/fg-analyzer-report/src/summary.ts`) считает цифры функциями самого
дашборда из `dashboard/src/lib/` (`buildProblems`, `breakdownShares`, `kitDataOf`,
`applyRuleConfig`/`recountFindings`) по тому же `payloadOf`, что вшит в `report.html`.

## Адаптеры дизайн-систем

Адаптер один, профилей несколько: всё, что зависит от версии, — **данные** в
`packages/fg-eds-adapter/src/profile.ts`; правила в `src/rules/**` при этом не меняются.

Третья дизайн-система — это один литерал `KitProfile`, один конвейер извлечения
(`src/extract/<name>/`), одна запись в `EDS_PROFILES`, один каталог вшитых артефактов и одна
строка в реестре автоопределения. `tests/profile.test.ts` обходит `EDS_PROFILES`, не называя
поимённо ни одну из них, — этим и проверяется, что сказанное выше остаётся правдой.
