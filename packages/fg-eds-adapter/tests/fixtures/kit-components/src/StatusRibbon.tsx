export interface StatusRibbonProps {
  tone: "ok" | "warn";
  label: string;
}

export const StatusRibbon = ({ tone, label }: StatusRibbonProps) => (
  <p className={`ribbon ribbon--${tone}`}>
    <b className="ribbon__mark">•</b>
    {label}
  </p>
);
