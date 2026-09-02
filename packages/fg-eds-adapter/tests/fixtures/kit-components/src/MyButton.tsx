export interface MyButtonProps {
  view?: "primary" | "secondary";
  size?: "sm" | "md";
  disabled?: boolean;
  fullWidth?: boolean;
  classes?: Record<string, string>;
  onClick?: () => void;
  children?: React.ReactNode;
}

export const MyButton = ({
  view = "primary",
  size = "md",
  disabled,
  fullWidth,
  classes,
  onClick,
  children,
}: MyButtonProps) => (
  <button
    type="button"
    className={`btn btn-${view} btn-${size}${fullWidth ? " btn-block" : ""}`}
    disabled={disabled}
    onClick={onClick}
    aria-disabled={disabled}
  >
    <span className={classes?.["content"]}>{children}</span>
  </button>
);
