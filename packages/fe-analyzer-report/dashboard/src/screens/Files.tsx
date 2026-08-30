import { useMemo, useState } from "react";

import { FindingCard } from "../components/FindingCard.js";
import { Badge, Button, CopyButton, Dot, EmptyState, cx } from "../components/ui.js";
import type { Payload } from "../data.js";
import { buildFileGroups } from "../lib/model.js";
import type { ViewState } from "../lib/url-state.js";

/**
 * Master–detail over files.
 *
 * The reader here is somebody with the file already open in an editor: the right pane is
 * that file's findings in line order, top to bottom — an edit plan, not a feed. The left
 * pane ranks files by total weight so "where do I even start" answers itself.
 */

export const FilesScreen = ({
  payload,
  state,
  go,
  selection,
  onSelectToggle,
}: {
  payload: Payload;
  state: ViewState;
  go: (patch: Partial<ViewState>) => void;
  /** Finding ids picked for the PR flow. */
  selection: ReadonlySet<string>;
  onSelectToggle: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const [fileQuery, setFileQuery] = useState("");
  const [expandedFinding, setExpandedFinding] = useState<string | null>(state.finding);

  const groups = useMemo(() => buildFileGroups(payload.findings), [payload.findings]);

  const visibleGroups = useMemo(() => {
    if (fileQuery.length === 0) {
      return groups;
    }
    const needle = fileQuery.toLowerCase();
    return groups.filter((group) => group.file.toLowerCase().includes(needle));
  }, [groups, fileQuery]);

  const selected = groups.find((group) => group.file === state.file) ?? null;

  if (groups.length === 0) {
    return <EmptyState>Ни одного файла с отклонениями.</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface/40">
        <div className="shrink-0 border-b border-border p-3">
          <input
            value={fileQuery}
            onChange={(event) => {
              setFileQuery(event.target.value);
            }}
            placeholder={`Файл… (${String(groups.length)} с отклонениями)`}
            className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-accent/60"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <EmptyState
              action="Показать все"
              onAction={() => {
                setFileQuery("");
              }}
            >
              Нет файлов с «{fileQuery}».
            </EmptyState>
          ) : (
            <ul>
              {visibleGroups.map((group) => {
                const parts = group.file.split("/");
                const name = parts.at(-1) ?? group.file;
                const dir = parts.slice(0, -1).join("/");

                return (
                  <li key={group.file} className="border-b border-border/60">
                    <button
                      type="button"
                      onClick={() => {
                        go({ file: state.file === group.file ? null : group.file, finding: null });
                        setExpandedFinding(null);
                      }}
                      className={cx(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                        state.file === group.file ? "bg-surface-2" : "hover:bg-surface-2/50",
                      )}
                    >
                      <Dot severity={group.worst} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12.5px] text-fg">
                          {name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-faint">
                          {dir}
                        </span>
                      </span>
                      {group.counts.error > 0 && <Badge tone="error">{group.counts.error}</Badge>}
                      {group.counts.warning > 0 && (
                        <Badge tone="warning">{group.counts.warning}</Badge>
                      )}
                      <span className="w-8 shrink-0 text-right tabular-nums text-[12px] text-muted">
                        {group.findings.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected === null ? (
          <EmptyState>
            Выберите файл слева — его отклонения откроются здесь в порядке строк, как план правок.
          </EmptyState>
        ) : (
          <div className="ds-enter mx-auto max-w-5xl space-y-3 p-5">
            <header className="flex flex-wrap items-center gap-2.5">
              <h2 className="min-w-0 flex-1 truncate font-mono text-[14px] font-medium">
                {selected.file}
              </h2>
              {selected.autoFixable > 0 && (
                <Button
                  onClick={() => {
                    onSelectToggle(
                      selected.findings
                        .filter((finding) => finding.autoFixable)
                        .map((finding) => finding.id),
                    );
                  }}
                >
                  Все авто-фиксы файла в PR ({selected.autoFixable})
                </Button>
              )}
              <CopyButton value={selected.file} label="Путь" />
            </header>

            <p className="text-[12.5px] text-muted">
              {selected.findings.length} правок:{" "}
              {selected.counts.error > 0 && <>{selected.counts.error} ошибок · </>}
              {selected.counts.warning > 0 && <>{selected.counts.warning} предупреждений · </>}
              {selected.counts.info > 0 && <>{selected.counts.info} заметок · </>}
              {selected.autoFixable} правятся заменой строки. Идите сверху вниз — номера строк не
              поплывут.
            </p>

            <div className="space-y-1.5">
              {selected.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  context="file"
                  expanded={expandedFinding === finding.id}
                  onToggle={() => {
                    const next = expandedFinding === finding.id ? null : finding.id;
                    setExpandedFinding(next);
                    go({ finding: next });
                  }}
                  onOpenFile={(file) => {
                    go({ file, finding: null });
                    setExpandedFinding(null);
                  }}
                  selected={selection.has(finding.id)}
                  onSelectToggle={() => {
                    onSelectToggle([finding.id]);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
