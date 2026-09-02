import * as React from "react";

import { Icon, IconsSet } from "@sds-eng/kit-exp";

import { badge } from "./StatusBadge.css";

/**
 * The correct way to draw a glyph: the kit's own icon set through the kit's
 * wrapper. Nothing here may be reported.
 */
export const IconLegend: React.FC = () => (
  <ul className={badge}>
    <li>
      <IconsSet.Approved size={16} />
      Согласовано
    </li>
    <li>
      <Icon aria-label="Внимание" size={20}>
        <IconsSet.Warning />
      </Icon>
      Требует внимания
    </li>
  </ul>
);
