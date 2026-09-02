// Fixture: two third-party icon packs and one local icon. `icon.foreign-pack` fires on the
// import specifier alone — no icon artifact is consulted, which is exactly why the rule
// could be ungated.
import { Trash2 } from "lucide-react";
import { FiEdit } from "react-icons/fi";

import { LocalCheckIcon } from "./LocalCheckIcon.tsx";

export function Toolbar() {
  return (
    <div className="toolbar">
      <button type="button" aria-label="Удалить">
        <Trash2 />
      </button>
      <button type="button" aria-label="Изменить">
        <FiEdit />
      </button>
      <button type="button" aria-label="Готово">
        <LocalCheckIcon />
      </button>
    </div>
  );
}
