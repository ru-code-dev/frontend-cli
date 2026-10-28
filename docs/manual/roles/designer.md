# Роль: дизайнер

Две задачи: достать кадр из макета и держать корпус дизайн-системы свежим.

## Кадр из Pixso

```bash
fguard --passets <pixso-link>   # svg + html + md + json за один запрос к макету
fguard --psvg <pixso-link>      # только SVG
fguard --phtml <pixso-link>     # только HTML
fguard --pprompt <pixso-link>   # Markdown-промпт: спецификация экрана для LLM
```

```
$ fguard --passets <pixso-link>
fguard v1.2.0 · passets · удалённый маршрут · item 11-10
✔ готово
  svg    /home/u/app/fg-out/pixso/11-10/card.svg
  html   /home/u/app/fg-out/pixso/11-10/card.html
  md     /home/u/app/fg-out/pixso/11-10/card.md
  json   /home/u/app/fg-out/pixso/11-10/card.json
```

Аргумент — ссылка на кадр из Pixso («Поделиться → Копировать ссылку»). Токен удалённого MCP
кладут в `./.env` рядом с местом запуска:

```
PIXSO_REMOTE_MCP_TOKEN=<ваш токен>
```

Имя файла — `item-id` из ссылки, приведённый к безопасному виду: на снимке выше это каталог
`./fg-out/pixso/11-10/`, а у `--psvg` был бы файл `./fg-out/pixso/11-10.svg`.

Подробно — [pixso.md](../pixso.md), [env.md](../env.md).

## Корпус дизайн-системы

`fguard` носит вшитый снимок каждой дизайн-системы — токены, компоненты, иконки, публичные сигнатуры
и правила доступности. Снимок замирает в момент сборки `fguard`; когда дизайн-система ушла вперёд,
корпус пересобирают локально:

```bash
fguard --pkit eds                              # → ~/.fg/kits/eds/
fguard --pkit eds2                             # 2.x, ветка develop-2.0
fguard --pkit eds --source ../ui-kit-eds-ce    # из локального клона
```

Пять файлов на каждую: `tokens`, `components`, `kit-a11y`, `kit-icons`, `kit-signatures`. После
пересборки `--preport` подхватит их сам и назовёт в заголовке, по какому снимку считал.

Испорченный корпус ничего не ломает: команда предупредит и вернётся к встроенному снимку.

Подробно — [parse-ui-kit.md](../parse-ui-kit.md).

## Что смотреть в отчёте

Экран «Дизайн-система» в `report.html` — кастомные компоненты, палитра и покрытие токенами; там
же видно, где проект обходит дизайн-систему вместо того, чтобы ею пользоваться. Общий вид
дашборда — [roles/lead.md](lead.md).
