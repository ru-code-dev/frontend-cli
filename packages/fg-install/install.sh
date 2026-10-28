#!/usr/bin/env bash
# Frontend Guard — установка, обновление и удаление команды fguard, навыков CLI и плагина pixso.
#
#   bash <папка релиза>/install                 установить или обновить (повторный запуск = обновление)
#   bash <папка релиза>/install --uninstall     удалить
#   bash <корень ru-code>/fg/install --uninstall       удалить, когда папки релиза уже нет
#
# Node здесь ищет НЕ fg: этот файл подключает установщик ru-code (`ru-code-install` рядом — его
# сгенерированный `install`, дословная копия) через его собственный шов RU_CODE_INSTALL_NO_MAIN=1
# и вызывает ЕГО функции detect_os и check_node_floor — тот же NODE_PATH, который получил бы
# установщик ru-code на этой машине (сначала node, поставляемый с CLI, затем node из PATH).
# Всё остальное делает `fg.mjs` на этом node: preflight ru-code, файлы, rc-строку (снова
# функциями ru-code), навыки, плагин.
set -euo pipefail

FG_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Папка релиза: fg.mjs рядом; установленная копия <корень>/fg: fg.mjs в bin/ (только bin/ в PATH).
FG_MJS="$FG_HERE/fg.mjs"
[ -f "$FG_MJS" ] || FG_MJS="$FG_HERE/bin/fg.mjs"
if [ ! -f "$FG_HERE/ru-code-install" ] || [ ! -f "$FG_MJS" ]; then
  printf '\n  ✖ Рядом с install нет ru-code-install или fg.mjs: %s\n' "$FG_HERE" >&2
  exit 1
fi

RU_CODE_INSTALL_NO_MAIN=1 . "$FG_HERE/ru-code-install"
# Журнал установщика ru-code — его файл; fg туда не пишет.
LOGFILE=/dev/null

# Отказ — тот же, что у установщика ru-code (его заголовок и текст, код 1), но без его карточки
# с брендом: переопределяется только отрисовка, логика check_node_floor остаётся дословной.
fail_recommendation() {
  printf '\n  ✖ %s\n    %s\n\n' "$(title_for "$1")" "$(body_for "$1")" >&2
  exit 1
}

detect_os
# Как в main установщика ru-code (40-main.sh): на Windows — только Git Bash.
if [ "$OS" = "windows" ] && [ -z "${MSYSTEM:-}" ]; then fail_recommendation gitbash; fi
check_node_floor

case "${1:-}" in
  "")
    [ $# -le 1 ] || fail_recommendation usage
    exec "$NODE_PATH" "$(to_node_path "$FG_MJS")" setup "$NODE_PATH"
    ;;
  --uninstall)
    [ $# -le 1 ] || fail_recommendation usage
    exec "$NODE_PATH" "$(to_node_path "$FG_MJS")" teardown
    ;;
  --help | -h)
    printf '%s\n' \
      "Frontend Guard — установка / обновление / удаление fguard." \
      "" \
      "  bash install               установить или обновить" \
      "  bash install --uninstall   удалить"
    ;;
  *)
    fail_recommendation usage
    ;;
esac
