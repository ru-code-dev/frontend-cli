export interface BadgeProps {
  text: string;
}

export function Badge(props: BadgeProps) {
  return <div>{props.text}</div>;
}
