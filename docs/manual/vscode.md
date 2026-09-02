# VS Code

> **Не проверено.** Ниже — конфигурация для VS Code. На этой машине проверено одно:
> `fg --preport . --format sarif` действительно пишет файл SARIF 2.1.0 со схемой
> `https://json.schemastore.org/sarif-2.1.0.json` и каталогом правил внутри. Сам редактор,
> расширение и задачи здесь не запускались.

## Задача

`.vscode/tasks.json` — запуск анализа прямо из редактора (`Terminal → Run Task`):

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "fg: отчёт (sarif)",
      "type": "shell",
      "command": "node",
      "args": ["${workspaceFolder}/fg.mjs", "--preport", ".", "--format", "sarif", "-o", "${workspaceFolder}/fg-out/report.sarif"],
      "problemMatcher": []
    },
    {
      "label": "fg: находки в консоль",
      "type": "shell",
      "command": "node",
      "args": ["${workspaceFolder}/fg.mjs", "--preport", ".", "--format", "compact"],
      "problemMatcher": []
    }
  ]
}
```

`problemMatcher` пуст намеренно: находки читаются из SARIF, а не разбором консольного текста.
Код возврата `1` на найденных ошибках — ожидаемое поведение задачи, а не сбой (см.
[ci.md](ci.md)).

## Просмотр SARIF

Расширение **SARIF Viewer** (`MS-SarifVSCode.sarif-viewer`) открывает `fg-out/report.sarif` и
складывает находки в панель Problems.

## Схема конфигурации

`fg --iconf` кладёт `fg.config.schema.json` рядом с `fg.config.json`, а `$schema` в конфиге
указывает на неё относительным путём — редактор подхватывает автодополнение имён правил и
уровней без настройки. Подробности — [init-config.md](init-config.md); в VS Code ничем не
отличается.
