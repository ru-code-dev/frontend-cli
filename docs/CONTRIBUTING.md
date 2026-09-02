# Работа над репозиторием

Устройство пакетов и инварианты — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Инструменты

| Инструмент | Версия |
| --- | --- |
| pnpm | 10.18.1 (`packageManager` в корневом `package.json`) |
| Node | `engines` в `cli/package.json`: `>=24`; проверки проходили на v24.14.1 |
| tsdown | 0.20.3 |
| vite-plus (`vp`) | 0.2.2 |
| tsgo (`@effect/tsgo`) | 0.13.2 |
| TypeScript | ~6.0.3 (нужен шагу dts в tsdown) |
| oxlint / oxfmt | 1.72.0 / 0.57.0 |

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
проверяется по коридору 18–25 MiB (сейчас ~21 MiB), и если файла нет или он вне коридора —
скрипт падает громко. Дистрибутив — именно этот файл в корне.

`.gitignore` содержит `/fg.mjs`, так что обычная сборка его не коммитит: **коммитит мейнтейнер и
только на релизе**, иначе двадцатимегабайтный файл переписывался бы в каждом коммите. Поэтому
`git clone` + `node <repo>/fg.mjs` сработает только на релизном коммите или теге, где файл
закоммичен вручную; на обычном чекауте нужен `pnpm install && pnpm release` (см.
[README.md](../README.md)).

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
и итоговый блок достаются из реестра даром.

## Новая дизайн-система

Один литерал `KitProfile` в `packages/fg-eds-adapter/src/profile.ts`, конвейер извлечения
`src/extract/<name>/`, запись в `EDS_PROFILES`, каталог вшитых артефактов и строка в реестре
автоопределения. Подробнее — раздел «Адаптеры дизайн-систем» в [ARCHITECTURE.md](ARCHITECTURE.md).
