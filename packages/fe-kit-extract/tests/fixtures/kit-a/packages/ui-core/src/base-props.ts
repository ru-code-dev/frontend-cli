import type { Size, Tone } from "./tokens";

/** Level 3 of the inheritance chain — `size` is declared here and nowhere else. */
export interface UtilityProps {
  size?: Size;
  testId?: string;
}

/** Level 2. */
export interface InnerProps extends UtilityProps {
  tone: Tone;
  label: string;
}
