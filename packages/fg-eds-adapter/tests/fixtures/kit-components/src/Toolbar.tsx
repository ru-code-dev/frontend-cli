export interface ToolbarShellProps {
  children?: React.ReactNode;
}

export const ToolbarShell = ({ children }: ToolbarShellProps) => (
  <div className="toolbar-shell">
    <div className="toolbar-shell__left">{children}</div>
    <div className="toolbar-shell__right">
      <span className="toolbar-shell__dot" />
      <span className="toolbar-shell__dot" />
    </div>
  </div>
);
