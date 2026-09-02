// Fixture: styled-components. The CSS lives in tagged template literals, so the collector
// has to parse the template rather than a stylesheet — same rules, different dialect.
import styled from "styled-components";

/* a11y.focus.suppressed / blanket: nothing in this file addresses the focused state. */
const Trigger = styled.button`
  padding: 8px 12px;
  border: none;
  outline: none;
`;

/* a11y.contrast.text / normalText: 2.09:1 — under 3:1, so an error. */
const Hint = styled.span`
  color: #b3b3b3;
  background-color: #ffffff;
  font-size: 13px;
`;

export function Card() {
  return (
    <div>
      <Trigger type="button">Открыть</Trigger>
      <Hint>Черновик</Hint>
    </div>
  );
}
