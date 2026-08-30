import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";

import { ruleLabel, SEVERITY_LABEL, subkindLabel, type Finding } from "../data.js";
import { Badge, Button, Checkbox, CopyButton, cx, Dot } from "./ui.js";

/**
 * One occurrence, in the two states a reader needs.
 *
 * Collapsed it is a line: severity, what, where. Expanded it answers "what exactly, and
 * what instead" without leaving the page — the diff, the explanation, the caveat and the
 * copy buttons all live here rather than behind a further click.
 *
 * The diff uses `react-diff-viewer-continued`: word-level highlighting inside a changed
 * line is what makes a one-character colour difference visible at all, and that is
 * precisely the case this tool exists to surface.
 */

const DIFF_STYLES = {
  variables: {
    dark: {
      diffViewerBackground: "transparent",
      diffViewerColor: "var(--color-fg)",
      addedBackground: "color-mix(in oklch, var(--color-ok) 16%, transparent)",
      addedColor: "var(--color-fg)",
      removedBackground: "color-mix(in oklch, var(--color-error) 16%, transparent)",
      removedColor: "var(--color-fg)",
      wordAddedBackground: "color-mix(in oklch, var(--color-ok) 34%, transparent)",
      wordRemovedBackground: "color-mix(in oklch, var(--color-error) 34%, transparent)",
      gutterBackground: "transparent",
      gutterColor: "var(--color-faint)",
      addedGutterBackground: "transparent",
      removedGutterBackground: "transparent",
      codeFoldBackground: "var(--color-surface-2)",
      emptyLineBackground: "transparent",
      gutterBackgroundDark: "transparent",
    },
  },
  line: { fontFamily: "var(--font-mono)", fontSize: "12.5px", lineHeight: "1.6" },
  gutter: { minWidth: "2.2em", padding: "0 6px" },
  contentText: { fontFamily: "var(--font-mono)" },
} as const;

/** Shiki output, pre-rendered at generation time — nothing is highlighted in the browser. */
export const Highlighted = ({ html }: { html: string }): React.ReactElement => (
  <div className="overflow-x-auto px-3 py-2" dangerouslySetInnerHTML={{ __html: html }} />
);

/**
 * The expanded body of a finding: explanation, caveats, root cause, code, actions.
 * Shared between the file view and the problem view so the two can never diverge.
 */
export const FindingDetail = ({
  finding,
  onOpenFile,
}: {
  finding: Finding;
  onOpenFile?: (file: string) => void;
}): React.ReactElement => {
  const [showDiff, setShowDiff] = useState(true);
  const hasDiff = finding.snippet.after !== null;

  return (
    <div className="ds-enter">
      <p className="px-4 py-3 text-[13.5px] leading-relaxed text-muted">{finding.why}</p>

      {finding.note !== null && (
        <p className="mx-4 mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12.5px] leading-relaxed text-warning">
          {finding.note}
        </p>
      )}

      {finding.a11y !== null && (
        <div className="mx-4 mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12.5px] leading-relaxed">
          <span className="font-medium text-info">Доступность:</span>{" "}
          <span className="text-muted">{finding.a11y.impact}</span>
          {finding.a11y.wcag.length > 0 && (
            <span className="ml-2 font-mono text-[11px] text-faint">
              WCAG {finding.a11y.wcag.join(", ")}
            </span>
          )}
        </div>
      )}

      {finding.candidates.length > 0 && (
        <div className="mx-4 mb-3 rounded-md border border-border bg-bg/40 px-3 py-2.5">
          <div className="mb-1.5 text-[12px] font-medium text-muted">Кандидаты из кита</div>
          <div className="space-y-1.5">
            {finding.candidates.map((candidate) => (
              <div key={candidate.component} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="w-28 shrink-0 truncate font-mono">{candidate.component}</span>
                <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-accent/80"
                    style={{ width: `${String(Math.round(Math.min(1, candidate.score) * 100))}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 tabular-nums text-faint">
                  {candidate.score.toFixed(2)}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-muted"
                  title={candidate.reasons.join("; ")}
                >
                  {candidate.reasons.join("; ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {finding.rootCause !== null && (
        <button
          type="button"
          onClick={() => onOpenFile?.(finding.rootCause?.file ?? "")}
          className="mx-4 mb-3 block w-[calc(100%-2rem)] rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-left text-[12.5px] leading-relaxed text-muted transition-colors hover:border-accent/60"
        >
          Корень — <span className="font-mono text-fg">{finding.rootCause.name}</span> в{" "}
          <span className="font-mono">
            {finding.rootCause.file}:{finding.rootCause.line}
          </span>
          . Одна правка там закрывает все вхождения.
        </button>
      )}

      <div className="border-t border-border">
        {hasDiff && showDiff ? (
          <div className="overflow-x-auto">
            <ReactDiffViewer
              oldValue={finding.snippet.before}
              newValue={finding.snippet.after ?? ""}
              splitView={false}
              useDarkTheme
              compareMethod={DiffMethod.WORDS}
              hideLineNumbers={false}
              linesOffset={finding.snippet.startLine - 1}
              styles={DIFF_STYLES}
            />
          </div>
        ) : (
          <Highlighted html={finding.snippet.beforeHtml} />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
        {finding.expected !== null && (
          <CopyButton value={finding.expected.value} label="Скопировать замену" />
        )}
        {finding.expected?.token != null && (
          <CopyButton value={finding.expected.token} label="Токен" />
        )}
        {hasDiff && (
          <Button
            onClick={() => {
              setShowDiff((previous) => !previous);
            }}
            active={showDiff}
          >
            {showDiff ? "Исходник" : "Дифф"}
          </Button>
        )}
        <CopyButton
          value={`${finding.file}:${String(finding.line)}:${String(finding.column)}`}
          label="Путь к строке"
        />

        <span className="ml-auto font-mono text-[11px] text-faint">
          {SEVERITY_LABEL[finding.severity]}
          {finding.subkind !== null && ` · ${subkindLabel(finding.subkind)}`} · {finding.id}
        </span>
      </footer>
    </div>
  );
};

/**
 * One finding as a row. `context` decides what leads the header: in a file view the line
 * number carries the information, in a flat list the file does.
 */
export const FindingCard = ({
  finding,
  context,
  expanded,
  onToggle,
  onOpenFile,
  selected = false,
  onSelectToggle,
}: {
  finding: Finding;
  context: "file" | "flat";
  expanded: boolean;
  onToggle: () => void;
  onOpenFile?: (file: string) => void;
  /** Per-occurrence selection for the PR flow; offered only on auto-fixable findings. */
  selected?: boolean;
  onSelectToggle?: () => void;
}): React.ReactElement => (
  <article
    className={cx(
      "rounded-[var(--radius-card)] border bg-surface/80 transition-colors",
      expanded ? "border-border-strong" : "border-border hover:border-border-strong",
    )}
  >
    <header className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5" onClick={onToggle}>
      {finding.autoFixable && onSelectToggle !== undefined && (
        <Checkbox checked={selected} onToggle={onSelectToggle} />
      )}
      <Dot severity={finding.severity} />

      {context === "file" ? (
        <span className="w-12 shrink-0 text-right font-mono text-[12px] text-faint">
          :{finding.line}
        </span>
      ) : (
        <span
          className="min-w-0 max-w-[40%] truncate font-mono text-[12px] text-faint"
          title={finding.file}
        >
          {finding.file}:{finding.line}
        </span>
      )}

      <span className="shrink-0 text-[13px] text-muted">{ruleLabel(finding.rule)}</span>

      <code className="min-w-0 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">
        {finding.actual}
      </code>

      {finding.expected !== null && (
        <>
          <span className="shrink-0 text-faint">→</span>
          <code
            className="min-w-0 truncate font-mono text-[12px] text-ok"
            title={finding.expected.value}
          >
            {finding.expected.token ?? finding.expected.value}
          </code>
        </>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {finding.autoFixable && <Badge tone="ok">авто-фикс</Badge>}
        <span
          className={cx("text-[12px] text-faint transition-transform", expanded && "rotate-90")}
        >
          ›
        </span>
      </span>
    </header>

    {expanded && (
      <div className="border-t border-border">
        <FindingDetail finding={finding} onOpenFile={onOpenFile} />
      </div>
    )}
  </article>
);
