export interface GlyphProps {
  name: string;
  weight?: "regular" | "bold";
}

/**
 * Deliberately arbitrary factory name. Nothing in the extractor may key off it — the component
 * it produces has to be recognised through the type checker alone.
 */
export function zzqFabricate(fallback: string) {
  return function fabricated(props: GlyphProps) {
    return <span id={props.name || fallback} />;
  };
}
