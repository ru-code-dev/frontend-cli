export interface MaybeProps {
  compact?: boolean;
}

/** Two different literal roots behind a runtime condition. */
export function Maybe(props: MaybeProps) {
  if (props.compact) {
    return <span />;
  }
  return <div />;
}
