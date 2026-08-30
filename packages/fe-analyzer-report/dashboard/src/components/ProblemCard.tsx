import { useState } from "react";

import type { Problem } from "../lib/model.js";
import { ruleLabel, SEVERITY_LABEL, subkindLabel, type Finding } from "../data.js";
import { FindingDetail } from "./FindingCard.js";
import { Badge, Checkbox, CopyButton, cx, Dot } from "./ui.js";

/**
 * One decision, however many times it repeats.
 *
 * This card is the unit of the report. Collapsed it reads as a work item — what to change,
 * into what, how much it closes. Expanded it shows the occurrences grouped by file, each
 * file opening to its lines, each line to the full diff. Three levels, so eight hundred
 * repetitions of one colour stay one card and every single occurrence is still reachable.
 */

const FileGroup = ({
  file,
  findings,
  onOpenFile,
}: {
  file: string;
  findings: readonly Finding[];
  onOpenFile?: (file: string) => void;
}): React.ReactElement => {
  const [openLine, setOpenLine] = useState<string | null>(null);

  return (
    <details className="group/file border-t border-border first:border-t-0">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-[12.5px] transition-colors hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-faint transition-transform group-open/file:rotate-90">
          ›
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">{file}</span>
        <span className="shrink-0 tabular-nums text-faint">
          {findings.length} {findings.length === 1 ? "вхождение" : "вхождений"}
        </span>
      </summary>

      <div className="space-y-1 px-4 pb-2">
        {findings.map((finding) => (
          <div key={finding.id} className="rounded-md border border-border bg-bg/40">
            <button
              type="button"
              onClick={() => {
                setOpenLine((previous) => (previous === finding.id ? null : finding.id));
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted transition-colors hover:text-fg"
            >
              <span className="w-12 shrink-0 text-right font-mono text-faint">:{finding.line}</span>
              <code className="min-w-0 flex-1 truncate font-mono">{finding.actual}</code>
              <span
                className={cx(
                  "shrink-0 text-faint transition-transform",
                  openLine === finding.id && "rotate-90",
                )}
              >
                ›
              </span>
            </button>
            {openLine === finding.id && (
              <div className="border-t border-border">
                <FindingDetail finding={finding} onOpenFile={onOpenFile} />
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
};

export const ProblemCard = ({
  problem,
  rank,
  expanded,
  onToggle,
  onOpenFile,
  selected = false,
  onSelectToggle,
}: {
  problem: Problem;
  /** 1-based position in the current ordering — the "start here" number. */
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenFile?: (file: string) => void;
  /** Whole-problem selection for the PR flow; offered only when every occurrence is auto-fixable. */
  selected?: boolean;
  onSelectToggle?: () => void;
}): React.ReactElement => {
  const byFile = new Map<string, Finding[]>();
  for (const finding of problem.findings) {
    const bucket = byFile.get(finding.file);
    if (bucket === undefined) {
      byFile.set(finding.file, [finding]);
    } else {
      bucket.push(finding);
    }
  }

  return (
    <article
      className={cx(
        "rounded-[var(--radius-card)] border bg-surface/80 transition-colors",
        expanded ? "border-border-strong" : "border-border hover:border-border-strong",
      )}
    >
      <header className="flex cursor-pointer items-center gap-3 px-4 py-3" onClick={onToggle}>
        {problem.autoFixable && onSelectToggle !== undefined && (
          <Checkbox checked={selected} onToggle={onSelectToggle} title="Все вхождения — в PR" />
        )}
        <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-faint">
          {rank}
        </span>
        <Dot severity={problem.severity} />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[14px] font-medium">{ruleLabel(problem.rule)}</span>
            {problem.subkind !== null && (
              <span className="hidden shrink-0 text-[12px] text-faint sm:inline">
                · {subkindLabel(problem.subkind)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
            <code className="min-w-0 truncate rounded bg-surface-2 px-1.5 py-0.5 text-fg">
              {problem.actual}
            </code>
            {problem.expected !== null && (
              <>
                <span className="shrink-0 text-faint">→</span>
                <code className="min-w-0 truncate text-ok" title={problem.expected.value}>
                  {problem.expected.token ?? problem.expected.value}
                </code>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {problem.autoFixable && <Badge tone="ok">авто-фикс</Badge>}
          <Badge
            title={`${SEVERITY_LABEL[problem.severity]} · суммарный вес ${String(problem.weight)}`}
          >
            {problem.occurrences}× · {problem.files} файл
            {problem.files === 1 ? "" : problem.files < 5 ? "а" : "ов"}
          </Badge>
          <span
            className={cx("text-[12px] text-faint transition-transform", expanded && "rotate-90")}
          >
            ›
          </span>
        </div>
      </header>

      {expanded && (
        <div className="ds-enter border-t border-border">
          <p className="px-4 py-3 text-[13.5px] leading-relaxed text-muted">{problem.why}</p>

          {problem.note !== null && (
            <p className="mx-4 mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12.5px] leading-relaxed text-warning">
              {problem.note}
            </p>
          )}

          {problem.rootCause !== null && (
            <button
              type="button"
              onClick={() => onOpenFile?.(problem.rootCause?.file ?? "")}
              className="mx-4 mb-3 block w-[calc(100%-2rem)] rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-left text-[12.5px] leading-relaxed text-muted transition-colors hover:border-accent/60"
            >
              Корень — <span className="font-mono text-fg">{problem.rootCause.name}</span> в{" "}
              <span className="font-mono">
                {problem.rootCause.file}:{problem.rootCause.line}
              </span>
              . Почините там — закроются все {problem.occurrences} вхождений.
            </button>
          )}

          {problem.expected !== null && (
            <div className="mx-4 mb-3 flex flex-wrap items-center gap-1.5">
              <CopyButton value={problem.expected.value} label="Скопировать замену" />
              {problem.expected.token !== null && (
                <CopyButton value={problem.expected.token} label="Токен" />
              )}
            </div>
          )}

          <div className="border-t border-border">
            {[...byFile.entries()].map(([file, findings]) => (
              <FileGroup key={file} file={file} findings={findings} onOpenFile={onOpenFile} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
};
