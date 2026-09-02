import type * as React from "react";

import { Box } from "./Box";

export interface PanelProps {
  children?: React.ReactNode;
}

/** Root is another kit component — the element must be resolved transitively through `Box`. */
export function Panel(props: PanelProps) {
  return <Box>{props.children}</Box>;
}
