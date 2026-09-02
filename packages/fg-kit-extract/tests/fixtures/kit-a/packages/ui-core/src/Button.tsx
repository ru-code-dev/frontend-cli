import type * as React from "react";

import type { InnerProps } from "./base-props";

/**
 * Level 1. `size` reaches this interface three levels deep (ButtonProps -> InnerProps ->
 * UtilityProps) THROUGH a utility type, and the raw DOM prop set arrives as a second heritage
 * clause that must collapse instead of being enumerated.
 */
export interface ButtonProps
  extends Omit<InnerProps, "tone">, React.ComponentPropsWithoutRef<"button"> {
  variant: "primary" | "ghost";
}

export function Button(props: ButtonProps) {
  return (
    <button className={props.variant} disabled={props.disabled} id={props.id}>
      {props.label}
    </button>
  );
}
