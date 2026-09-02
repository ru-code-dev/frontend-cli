export interface PolyProps {
  as?: "a" | "button";
  label: string;
}

/** Root tag is a variable — determined only at runtime. */
export function Poly({ as: Tag = "button", label }: PolyProps) {
  return <Tag>{label}</Tag>;
}
