export interface CardProps {
  accent?: boolean;
  classes?: Record<string, string>;
  draggable?: boolean;
  elevation?: number;
  children?: React.ReactNode;
}

export const Card = ({ accent, classes, draggable, elevation, children }: CardProps) => (
  <div
    className={`card${accent ? " card--accent" : ""}`}
    draggable={draggable}
    data-elevation={elevation}
  >
    <div className={classes?.["body"]}>{children}</div>
  </div>
);
