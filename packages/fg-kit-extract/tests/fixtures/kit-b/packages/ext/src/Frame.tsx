import { Chip } from "@kitb/core";

export interface FrameProps {
  caption: string;
}

/** Delegates across packages through the `paths` alias declared in the kit's own tsconfig. */
export function Frame(props: FrameProps) {
  return <Chip text={props.caption} />;
}
