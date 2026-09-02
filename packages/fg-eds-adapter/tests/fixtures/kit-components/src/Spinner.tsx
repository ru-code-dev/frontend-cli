export interface SpinnerProps {
  size?: "xs" | "sm" | "md";
  view?: "primary" | "secondary";
  classes?: Record<string, string>;
  className?: string;
  color?: string;
}

export const Spinner = ({
  size = "md",
  view = "primary",
  classes,
  className,
  color,
}: SpinnerProps) => (
  <span
    className={`${className ?? ""} spinner spinner-${size} spinner-${view}`}
    role="progressbar"
    aria-live="polite"
    style={{ color }}
  >
    <svg viewBox="0 0 24 24" className={classes?.["circle"]}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  </span>
);
