import * as React from "react";

import { badge, badgeIcon } from "./StatusBadge.css";

export interface StatusBadgeProps {
  label: string;
  onDismiss: () => void;
}

/** Status chip with a hand-pasted glyph instead of the kit icon set. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, onDismiss }) => (
  <span className={badge}>
    <svg
      className={badgeIcon}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3 8.5L6.2 12L13 4.5" stroke="#2969e3" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
    {label}
    <button onClick={onDismiss} type="button">
      <svg height="12" viewBox="0 0 12 12" width="12">
        <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" />
      </svg>
    </button>
  </span>
);
