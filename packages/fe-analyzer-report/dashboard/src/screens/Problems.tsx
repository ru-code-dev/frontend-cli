import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { FindingCard } from "../components/FindingCard.js";
import { ProblemCard } from "../components/ProblemCard.js";
import { Button, Dot, EmptyState, cx } from "../components/ui.js";
import {
  CATEGORY_LABEL,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  type Payload,
  type Severity,
} from "../data.js";
import { SEVERITY_RANK, buildProblems, matchesFilters } from "../lib/model.js";
import type { ViewState } from "../lib/url-state.js";

/**
 * The work plan.
 *
 * Default view folds occurrences into decisions and sorts them by consequence — an error
 * repeated forty times is the first card, however the file order falls. The flat mode is
 * the same data unfolded, for the reader who wants the feed; it is virtualised because a
 * real product yields four figures of rows.
 *
 * Filter counts are faceted: each chip shows how many results *it* would leave given every
 * other active filter. A chip that would strand the reader on an empty list says `0`
 * before they click it.
 */

const FilterChip = ({
  label,
  count,
  active,
  dot,
  title,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  dot?: Severity;
  title?: string;
  onClick: () => void;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cx(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors",
      active
        ? "border-accent/60 bg-accent/15 text-fg"
        : count === 0
          ? "border-border text-faint"
          : "border-border text-muted hover:border-border-strong hover:text-fg",
    )}
  >
    {dot !== undefined && <Dot severity={dot} className="size-1.5" />}
    {label}
    <span className="tabular-nums text-faint">{count}</span>
  </button>
);

export const ProblemsScreen = ({
  payload,
  state,
  go,
  reset,
  selection,
  onSelectToggle,
}: {
  payload: Payload;
  state: ViewState;
  go: (patch: Partial<ViewState>) => void;
  reset: (screen: "problems") => void;
  /** Finding ids picked for the PR flow. */
  selection: ReadonlySet<string>;
  onSelectToggle: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const visibleFindings = useMemo(
    () => payload.findings.filter((finding) => matchesFilters(finding, state)),
    [payload.findings, state],
  );

  const problems = useMemo(() => buildProblems(visibleFindings), [visibleFindings]);

  const facetCount = (
    except: keyof ViewState,
    predicate: (severityOrCategory: string) => boolean,
  ): number =>
    payload.findings.filter(
      (finding) =>
        matchesFilters(finding, state, except) &&
        predicate(except === "severity" ? finding.severity : finding.category),
    ).length;

  const [expandedKey, setExpandedKey] = useState<string | null>(state.group);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(state.finding);

  // A group arriving through the URL (from the overview, from a pasted link) opens and
  // scrolls to itself; after that the reader owns the expansion state.
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setExpandedKey(state.group);
    if (state.group !== null) {
      window.setTimeout(() => {
        targetRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }, 0);
    }
  }, [state.group]);

  const flat = state.mode === "flat";

  const flatFindings = useMemo(
    () =>
      [...visibleFindings].sort(
        (left, right) =>
          SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
          right.impact.occurrences - left.impact.occurrences ||
          (left.file < right.file ? -1 : left.file > right.file ? 1 : left.line - right.line),
      ),
    [visibleFindings],
  );

  const virtualizer = useVirtualizer({
    count: flat ? flatFindings.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    overscan: 8,
    getItemKey: (index) => flatFindings[index]?.id ?? index,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border bg-bg/70 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={state.query}
            onChange={(event) => {
              go({ query: event.target.value });
            }}
            placeholder="Поиск: файл, значение, токен, текст…"
            className="w-72 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-accent/60"
          />
          <FilterChip
            label="Только авто-фикс"
            count={
              payload.findings.filter(
                (finding) =>
                  matchesFilters(finding, state, "autoFixableOnly") && finding.autoFixable,
              ).length
            }
            active={state.autoFixableOnly}
            onClick={() => {
              go({ autoFixableOnly: !state.autoFixableOnly });
            }}
          />

          <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              className={cx("border-0", !flat && "bg-surface-2 text-fg")}
              onClick={() => {
                go({ mode: null });
              }}
            >
              Решения
            </Button>
            <Button
              className={cx("border-0", flat && "bg-surface-2 text-fg")}
              onClick={() => {
                go({ mode: "flat" });
              }}
            >
              Подряд
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITY_ORDER.map((severity) => (
            <FilterChip
              key={severity}
              label={SEVERITY_LABEL[severity]}
              dot={severity}
              title={SEVERITY_HINT[severity]}
              count={facetCount("severity", (value) => value === severity)}
              active={state.severity === severity}
              onClick={() => {
                go({ severity: state.severity === severity ? null : severity });
              }}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {Object.entries(CATEGORY_LABEL)
            .filter(([category]) =>
              payload.findings.some((finding) => finding.category === category),
            )
            .map(([category, label]) => (
              <FilterChip
                key={category}
                label={label}
                count={facetCount("category", (value) => value === category)}
                active={state.category === category}
                onClick={() => {
                  go({ category: state.category === category ? null : category });
                }}
              />
            ))}
        </div>

        <p className="text-[12.5px] text-muted">
          {flat ? (
            <>
              <span className="font-semibold text-fg tabular-nums">{flatFindings.length}</span>{" "}
              вхождений подряд, по серьёзности и частоте
            </>
          ) : (
            <>
              <span className="font-semibold text-fg tabular-nums">{problems.length}</span> решений
              · <span className="tabular-nums">{visibleFindings.length}</span> вхождений · по
              эффекту: серьёзность × повторы
            </>
          )}
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {visibleFindings.length === 0 ? (
          <EmptyState
            action="Сбросить фильтры"
            onAction={() => {
              reset("problems");
            }}
          >
            Под текущие фильтры ничего не попало.
          </EmptyState>
        ) : flat ? (
          <div
            className="relative mx-auto max-w-6xl px-5 py-4"
            style={{ height: `${String(virtualizer.getTotalSize())}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const finding = flatFindings[item.index];
              if (finding === undefined) {
                return null;
              }

              return (
                <div
                  key={finding.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-5 right-5 pb-1.5"
                  style={{ transform: `translateY(${String(item.start)}px)` }}
                >
                  <FindingCard
                    finding={finding}
                    context="flat"
                    expanded={expandedFinding === finding.id}
                    onToggle={() => {
                      setExpandedFinding((previous) =>
                        previous === finding.id ? null : finding.id,
                      );
                    }}
                    onOpenFile={(file) => {
                      go({ screen: "files", file, finding: null });
                    }}
                    selected={selection.has(finding.id)}
                    onSelectToggle={() => {
                      onSelectToggle([finding.id]);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-2 px-5 py-4">
            {problems.map((problem, index) => (
              <div key={problem.key} ref={problem.key === state.group ? targetRef : undefined}>
                <ProblemCard
                  problem={problem}
                  rank={index + 1}
                  expanded={expandedKey === problem.key}
                  onToggle={() => {
                    setExpandedKey((previous) => (previous === problem.key ? null : problem.key));
                  }}
                  onOpenFile={(file) => {
                    go({ screen: "files", file, group: null });
                  }}
                  selected={problem.findings.every((finding) => selection.has(finding.id))}
                  onSelectToggle={() => {
                    onSelectToggle(problem.findings.map((finding) => finding.id));
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
