# Работа над репозиторием

Устройство пакетов и инварианты — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Инструменты

| Инструмент            | Версия                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| pnpm                  | 10.18.1 (`packageManager` в корневом `package.json`)                   |
| Node                  | `engines` в `cli/package.json`: `>=24`; проверки проходили на v24.14.1 |
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

`scripts/release.mjs` копирует `cli/dist/fg.mjs` в корень репозитория как `fg.mjs`: размер
проверяется по коридору 18–25 MiB (сейчас ~22 MiB), и если файла нет или он вне коридора —
скрипт падает громко. Дистрибутив — именно этот файл в корне.

`.gitignore` содержит `/fg.mjs`, так что обычная сборка его не коммитит: **коммитит мейнтейнер и
только на релизе**, иначе двадцатимегабайтный файл переписывался бы в каждом коммите. Поэтому
`git clone` + `node <repo>/fg.mjs` сработает только на релизном коммите или теге, где файл
закоммичен вручную; на обычном чекауте нужен `pnpm install && pnpm release` (см.
[README.md](../README.md)).

## Сборка ru-code для `fg install`

`fg install` вшивает в `fg.mjs` preflight-скрипт ru-code и сборку плагина pixso из каталога
`vendor/ru-code/`. Каталог в `.gitignore`; без него `pnpm build` падает с сообщением, какого
файла не хватает. Чтобы обновить вшитую сборку, код менять не нужно — достаточно заменить файлы
и пересобрать:

1. Соберите ru-code (`pnpm build`, затем `pnpm prepare-release` в репозитории ru-code — он кладёт
   `preflight.mjs` в `dist-bundle/staging/package/`) и плагин
   (`pnpm --filter @smart-tools/t3-code-pixso-mcp-assistant-plugin build` в ru-code-packages).
2. Скопируйте:

   ```bash
   rm -rf vendor/ru-code && mkdir -p vendor/ru-code/plugins
   cp <ru-code>/dist-bundle/staging/package/preflight.mjs vendor/ru-code/preflight.mjs
   cp -R <ru-code-packages>/packages/t3-code-pixso-mcp-assistant-plugin/dist vendor/ru-code/plugins/pixso
   ```

   Имя папки в `vendor/ru-code/plugins/` должно совпадать с `id` в её `plugin.json`, и папка там
   должна быть ровно одна.

3. `pnpm build` (или `pnpm release`), затем `pnpm test:integration`:
   `cli/tests/install.integration.test.ts` ставит плагин из собранного бандла в чистый HOME и
   сверяет файлы побайтно с `vendor/ru-code/plugins/pixso`.

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
