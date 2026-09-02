import * as React from "react";
import { Button as UpstreamButton } from "@v-uik/base";

/** Public value → the value forwarded to @v-uik, exactly as the real kit encodes variants. */
export const views = { primary: "primary", secondary: "secondary", negative: "error" } as const;

export const sizes = { sm: "md", md: "lg" } as const;

export interface ButtonProps {
  /** Visual weight of the button. */
  view?: keyof typeof views;
  size?: keyof typeof sizes;
  disabled?: boolean;
}

/** The kit's button. */
export const Button = (props: ButtonProps): React.ReactElement => (
  <UpstreamButton role="button" aria-disabled={props.disabled} className="btn">
    <span>ok</span>
  </UpstreamButton>
);
