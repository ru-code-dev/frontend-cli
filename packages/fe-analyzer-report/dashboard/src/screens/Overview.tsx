import { useMemo } from "react";

import { Donut, RankedBars, type Slice } from "../components/charts.js";
import {
  Badge,
  Card,
  CardHeader,
  Disclosure,
  Dot,
  EmptyState,
  MetricCard,
  cx,
} from "../components/ui.js";
import {
  CATEGORY_LABEL,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  limitationLabel,
  ruleLabel,
  type Payload,
  type Severity,
} from "../data.js";
import { buildFileGroups, buildProblems } from "../lib/model.js";
import type { ViewState } from "../lib/url-state.js";

/**
 * The summary screen.
 *
 * Answers, in the order somebody actually asks: how bad is it, what do I fix first, what
 * kind of bad, and what is already right. The last one is not politeness — a report
 * consisting only of complaints gets read once, and this one has to survive being opened
 * every sprint.
 *
 * Everything here is a way into a working screen. Nothing on this screen is terminal.
 */

const SEVERITY_COLOR: Record<Severity, string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  candidate: "var(--color-candidate)",
};

const TOP_PROBLEMS = 7;
const TOP_FILES = 8;
const LIMITATIONS_SHOWN = 30;

export const OverviewScreen = ({
  payload,
  navigate,
}: {
  payload: Payload;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const { summary } = payload;

  const problems = useMemo(() => buildProblems(payload.findings), [payload.findings]);
  const worstFiles = useMemo(
    () => buildFileGroups(payload.findings).slice(0, TOP_FILES),
    [payload.findings],
  );

  const severitySlices: Slice[] = SEVERITY_ORDER.filter(
    (severity) => summary.findings.bySeverity[severity] > 0,
  ).map((severity) => ({
    key: severity,
    label: SEVERITY_LABEL[severity],
    value: summary.findings.bySeverity[severity],
    color: SEVERITY_COLOR[severity],
  }));

  const categorySlices: Slice[] = Object.entries(summary.findings.byCategory)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([category, value]) => ({
      key: category,
      label: CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category,
      value,
      color: "var(--color-info)",
    }));

  const cleanShare = summary.files.clean / Math.max(1, summary.files.scanned);

  return (
    <div className="ds-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        {/* Verdict strip: the metric cards whose rules this build ports. */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="Отклонения"
            value={summary.findings.total}
            detail={`${String(summary.findings.bySeverity.error)} ошибок · ${String(summary.findings.bySeverity.warning)} предупреждений`}
            onClick={() => {
              navigate({ screen: "problems" });
            }}
          />
          <MetricCard
            label="Решений"
            value={problems.length}
            detail="уникальных проблем после группировки повторов"
            onClick={() => {
              navigate({ screen: "problems" });
            }}
          />
          <MetricCard
            label="Авто-фикс"
            value={summary.findings.autoFixable}
            detail={`${String(Math.round((summary.findings.autoFixable / Math.max(1, summary.findings.total)) * 100))}% вхождений правятся заменой строки`}
            onClick={() => {
              navigate({ screen: "problems", autoFixableOnly: true });
            }}
          />
          <MetricCard
            label="Доступность"
            value={summary.findings.byCategory.a11y}
            detail="нарушений a11y: фокус, клавиатура, ARIA, имена, контраст · клик — план с фильтром"
            onClick={() => {
              navigate({ screen: "problems", category: "a11y" });
            }}
          />
        </div>

        {/* The action plan preview — the reason the report exists. */}
        <Card>
          <CardHeader
            title="С чего начать"
            hint="решения, отсортированные по эффекту: серьёзность × количество повторов. Одна строка — одна правка, сколько бы раз она ни повторялась."
            right={
              <button
                type="button"
                className="shrink-0 text-[13px] text-accent transition-colors hover:text-fg"
                onClick={() => {
                  navigate({ screen: "problems" });
                }}
              >
                весь план ({problems.length}) →
              </button>
            }
          />
          {problems.length === 0 ? (
            <EmptyState>Ни одного отклонения. Такое бывает.</EmptyState>
          ) : (
            <ol>
              {problems.slice(0, TOP_PROBLEMS).map((problem, index) => (
                <li key={problem.key} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigate({ screen: "problems", group: problem.key });
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <span className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-faint">
                      {index + 1}
                    </span>
                    <Dot severity={problem.severity} />
                    <span className="shrink-0 text-[13.5px]">{ruleLabel(problem.rule)}</span>
                    <code className="min-w-0 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">
                      {problem.actual}
                    </code>
                    {problem.expected !== null && (
                      <>
                        <span className="shrink-0 text-faint">→</span>
                        <code className="hidden min-w-0 truncate font-mono text-[12px] text-ok md:inline">
                          {problem.expected.token ?? problem.expected.value}
                        </code>
                      </>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {problem.autoFixable && <Badge tone="ok">авто-фикс</Badge>}
                      <span className="tabular-nums text-[12px] text-muted">
                        {problem.occurrences}× · {problem.files} ф.
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader title="По категориям" hint="клик открывает план с фильтром" />
            {categorySlices.length === 0 ? (
              <EmptyState>Пусто.</EmptyState>
            ) : (
              <RankedBars
                data={categorySlices}
                onSelect={(category) => {
                  navigate({ screen: "problems", category });
                }}
              />
            )}
          </Card>

          <Card>
            <CardHeader title="По серьёзности" hint="что каждая означает — в подсказке сегмента" />
            <Donut
              data={severitySlices}
              height={200}
              onSelect={(severity) => {
                navigate({ screen: "problems", severity });
              }}
              centre={
                <div className="text-center">
                  <div className="text-[24px] font-semibold tabular-nums">
                    {summary.findings.total}
                  </div>
                  <div className="text-[11px] text-faint">всего</div>
                </div>
              }
            />
            <ul className="space-y-1 px-4 pb-3">
              {SEVERITY_ORDER.filter((severity) => summary.findings.bySeverity[severity] > 0).map(
                (severity) => (
                  <li key={severity} className="flex items-baseline gap-2 text-[12px]">
                    <Dot severity={severity} className="translate-y-px" />
                    <span className="shrink-0 text-muted">{SEVERITY_LABEL[severity]}</span>
                    <span className="min-w-0 truncate text-faint">— {SEVERITY_HINT[severity]}</span>
                  </li>
                ),
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Что хорошо" hint="отчёт из одних претензий читают один раз" />
            <ul className="space-y-2.5 p-4">
              <li className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-ok">✓</span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    Чистых файлов — {summary.files.clean} из {summary.files.scanned}
                  </div>
                  <div className="text-[12px] leading-relaxed text-muted">
                    {Math.round(cleanShare * 100)}% файлов без единого отклонения.
                  </div>
                </div>
              </li>
              {summary.positives.map((positive) => (
                <li key={positive.label} className="flex gap-2.5">
                  <span className="mt-0.5 shrink-0 text-ok">✓</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{positive.label}</div>
                    <div className="text-[12px] leading-relaxed text-muted">{positive.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Проблемные файлы"
            hint="по суммарному весу отклонений; клик открывает файл со списком правок"
            right={
              <button
                type="button"
                className="shrink-0 text-[13px] text-accent transition-colors hover:text-fg"
                onClick={() => {
                  navigate({ screen: "files" });
                }}
              >
                все файлы →
              </button>
            }
          />
          {worstFiles.length === 0 ? (
            <EmptyState>Ни одного файла с отклонениями.</EmptyState>
          ) : (
            <ul>
              {worstFiles.map((group) => (
                <li key={group.file} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigate({ screen: "files", file: group.file });
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <Dot severity={group.worst} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                      {group.file}
                    </span>
                    {group.counts.error > 0 && <Badge tone="error">{group.counts.error}</Badge>}
                    {group.counts.warning > 0 && (
                      <Badge tone="warning">{group.counts.warning}</Badge>
                    )}
                    <span className="w-10 shrink-0 text-right tabular-nums text-[12px] text-muted">
                      {group.findings.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {summary.limitations.length > 0 && (
          <Disclosure
            summary={
              <>
                Что не удалось проанализировать{" "}
                <span className="tabular-nums text-faint">({summary.limitations.length})</span> —
                молчаливый пропуск читался бы как «здесь чисто»
              </>
            }
          >
            <ul className="divide-y divide-border border-t border-border">
              {summary.limitations.slice(0, LIMITATIONS_SHOWN).map((limitation, index) => (
                <li
                  key={`${limitation.file}:${String(index)}`}
                  className="flex items-baseline gap-2.5 px-4 py-2 text-[12.5px]"
                >
                  <Badge className={cx("shrink-0")}>{limitationLabel(limitation.reason)}</Badge>
                  <span className="shrink-0 font-mono text-faint">
                    {limitation.file}
                    {limitation.line !== null && `:${String(limitation.line)}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted">{limitation.detail}</span>
                </li>
              ))}
              {summary.limitations.length > LIMITATIONS_SHOWN && (
                <li className="px-4 py-2 text-[12px] text-faint">
                  …и ещё {summary.limitations.length - LIMITATIONS_SHOWN}
                </li>
              )}
            </ul>
          </Disclosure>
        )}
      </div>
    </div>
  );
};
