export interface ChipProps {
  text: string;
  tone?: "info" | "warn";
}

export function Chip(props: ChipProps) {
  return <span>{props.text}</span>;
}
