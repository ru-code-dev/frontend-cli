import type * as React from "react";

export interface BoxProps {
  children?: React.ReactNode;
}

export function Box(props: BoxProps) {
  return <div>{props.children}</div>;
}
