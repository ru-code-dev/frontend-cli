# Работа над репозиторием

Устройство пакетов и инварианты — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Инструменты

| Инструмент            | Версия                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| pnpm                  | 10.18.1 (`packageManager` в корневом `package.json`)                   |
| Node                  | `engines` в `cli/package.json`: `>=22.16`; проверки проходили на официальном v22.16.0 и на v24.22.1 |
| tsdown                | 0.20.3                                                                 |
| vite-plus (`vp`)      | 0.2.2                                                                  |
| tsgo (`@effect/tsgo`) | 0.13.2                                                                 |
| TypeScript            | ~6.0.3 (нужен шагу dts в tsdown)                                       |
| oxlint / oxfmt        | 1.72.0 / 0.57.0                                                        |

Версии живут в `catalog:` внутри `pnpm-workspace.yaml`; в манифестах пакетов версионных
литералов нет.

## Проверки

Из корня репозитория, 0 ошибок и 0 предупреждений:

```bash
pnpm build      # сначала: typecheck требует собранных dist/
pnpm typecheck
pnpm test       # юнит-тесты, без сети и без браузера
pnpm lint       # vp lint -c .oxlintrc.json --deny-warnings --report-unused-disable-directives
```

По требованию:

```bash
pnpm test:integration   # интеграционные, работают против собранного бандла
pnpm test:e2e           # Playwright; перегенерирует docs/screenshots/*.png и gallery.html
```

`pnpm fmt` / `fmt:check` — форматтер, его владелец запускает отдельно; в проверки он не входит.

## Релиз

```bash
pnpm release    # pnpm -r run build && node scripts/release.mjs
```

`scripts/release.mjs` пишет в корень репозитория три файла релиза:

| Файл              | Откуда                                                     |
| ----------------- | ---------------------------------------------------------- |
| `fg.mjs`          | `cli/dist/fg.mjs`; размер — в коридоре 18–25 MiB (сейчас ~22 MiB) |
| `install`         | `packages/fg-install/install.sh`                           |
| `ru-code-install` | `vendor/ru-code/install` дословно (без запрещённых строк)  |

Чего-то нет или бандл вне коридора — скрипт падает громко. `--out <каталог>` / `FG_RELEASE_OUT`
пишут в другой каталог (так делают тесты).

`.gitignore` содержит все три, так что обычная сборка их не коммитит: **мейнтейнер кладёт их в
репозиторий релиза**. Пользователь делает `git clone <репозиторий релиза> && bash
<репозиторий релиза>/install` ([docs/manual/setup.md](manual/setup.md)).

## Сборка ru-code для `fguard install` и `bash install`

`vendor/ru-code/` — три вещи из **свежей сборки HEAD** ru-code и ru-code-packages: preflight и
плагин pixso вшиваются в `fg.mjs`, установщик ru-code уходит в релиз как `ru-code-install`.
Каталог в `.gitignore`; без него `pnpm build` (и `pnpm release`) падает с сообщением, какого
файла не хватает. Код при обновлении не меняется — только файлы и пересборка. Сборка идёт
**на месте** в корнях ru-code; ни один отслеживаемый файл там не меняется (проверьте
`git status --porcelain` — пусто). Чтобы pnpm не трогал ваш HOME и `node_modules` ru-code,
запускайте скрипты напрямую и с отдельным HOME:

```bash
# ru-code-packages: все пакеты, затем плагин
(cd <ru-code-packages> && pnpm build && pnpm --filter @smart-tools/t3-code-pixso-mcp-assistant-plugin build)
# ru-code: установщик (`install` в корне, он в .gitignore) и preflight (apps/server/dist/preflight.mjs)
(cd <ru-code> && node scripts/build-installer.ts)
(cd <ru-code>/apps/server && ./node_modules/.bin/vp pack src/ru-code/preflight/preflight.ts --out-dir dist --no-clean --minify --no-sourcemap)

rm -rf vendor/ru-code && mkdir -p vendor/ru-code/plugins
cp <ru-code>/install vendor/ru-code/install
cp <ru-code>/apps/server/dist/preflight.mjs vendor/ru-code/preflight.mjs
cp -R <ru-code-packages>/packages/t3-code-pixso-mcp-assistant-plugin/dist vendor/ru-code/plugins/pixso
git -C <ru-code> status --porcelain; git -C <ru-code-packages> status --porcelain   # оба пусто
```

`node scripts/build-installer.ts` и `vp pack …` — это ровно скрипты `pnpm build:installer` и
`build:preflight` ru-code; `pnpm` 11 перед запуском скрипта проверяет зависимости и пытается
переустановить `node_modules`, поэтому они вызываются напрямую. Тот же `install` и тот же
`preflight.mjs` кладёт в релизный архив и `pnpm prepare-release` ru-code — байт в байт (проверено).

Имя папки в `vendor/ru-code/plugins/` должно совпадать с `id` в её `plugin.json`, и папка там
должна быть ровно одна. Затем `pnpm build` (или `pnpm release`) и `pnpm test:integration`:
`cli/tests/install.integration.test.ts` ставит плагин из бандла в чистый HOME и сверяет файлы с
`vendor/ru-code/plugins/pixso`; `packages/fg-install/tests/rc.integration.test.ts` проверяет, что
строки и `env.sh` fguard байт в байт совпадают с тем, что дают функции нового `install`.

Что должно быть в `vendor/ru-code` и как оно попадает в бандл — в
[ARCHITECTURE.md](ARCHITECTURE.md#вшитая-сборка-ru-code-vendorru-code).

## Новое правило

1. Файл в `packages/fg-analyzer-engine/src/rules/<категория>/` (общее правило) либо в
   `packages/fg-eds-adapter/src/rules/<категория>/` (правило дизайн-системы).
2. Регистрация в `packages/fg-analyzer-engine/src/rules/index.ts` (`RULES`) или в наборе правил
   адаптера.
3. Правило объявляет `label {ru, en}` и подвиды — их печатает `compact` и показывает дашборд;
   каталог для `fg.config.json`, схемы и SARIF строится из тех же данных
   (`packages/fg-analyzer-engine/src/config/catalog.ts`).
4. Правила никогда не «выключаются» конфигом: они всегда выполняются, а конфигурация ложится
   слоем поверх результата (`src/config/apply.ts`).

## Новая команда

Пакет в `packages/`, реализующий `CliCommand` из `cli-kit`, плюс один `import` и один спред в
`COMMANDS` в `cli/src/registry.ts`. Справка, разбор флагов, выход с кодом 2 на необъявленный флаг
и итоговый блок достаются из реестра даром. Команда-слово (`install`) — это `CliCommand`, у
которого `flag` без дефисов: разбор узнаёт её по первому позиционному аргументу
(`isVerb` в `cli/src/parse.ts`).

## Новая дизайн-система

Один литерал `KitProfile` в `packages/fg-eds-adapter/src/profile.ts`, конвейер извлечения
`src/extract/<name>/`, запись в `EDS_PROFILES`, каталог вшитых артефактов и строка в реестре
автоопределения. Подробнее — раздел «Адаптеры дизайн-систем» в [ARCHITECTURE.md](ARCHITECTURE.md).
