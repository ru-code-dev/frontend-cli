// Fixture: emotion. The CSS sits in `styled`/`css` tagged templates, which the collector
// recognises by the tag's root identifier rather than by the package it was imported from —
// that is why one collector covers both emotion and styled-components.
import styled from "@emotion/styled";
import { css } from "@emotion/react";

/* a11y.contrast.text / normalText: 2.66:1 — under 3:1, so an error. */
const Label = styled.span`
  color: #949494;
  background: #f0f0f0;
  font-size: 12px;
`;

/* a11y.focus.suppressed / blanket. */
const closeButton = css`
  border: 0;
  outline: none;
`;

export function Banner() {
  return (
    <div>
      <Label>Бета</Label>
      <button type="button" css={closeButton} aria-label="Закрыть баннер">
        ×
      </button>
    </div>
  );
}
