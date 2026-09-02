import * as React from "react";

import { primaryButton } from "./PrimaryButton.css";

export interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "accent" | "exotic";
  size?: "sm" | "md";
}

/**
 * A local re-implementation of what `@sds-eng/kit-exp`'s `Button` already does:
 * same prop shape (`tone`/`size`), same rendered element, same disabled handling.
 */
export const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ tone = "accent", size = "md", className, children, ...rest }, ref) => (
    <button
      {...rest}
      className={[primaryButton({ tone, size }), className].filter(Boolean).join(" ")}
      ref={ref}
      type="button"
    >
      {children}
    </button>
  ),
);

PrimaryButton.displayName = "PrimaryButton";
