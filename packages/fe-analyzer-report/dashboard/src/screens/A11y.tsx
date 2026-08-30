import { useMemo, useState } from "react";

import { FindingCard } from "../components/FindingCard.js";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  cx,
  Dot,
  EmptyState,
  MetricCard,
} from "../components/ui.js";
import {
  limitationLabel,
  ruleLabel,
  SEVERITY_LABEL,
  subkindLabel,
  wcagLabel,
  type Payload,
  type Severity,
} from "../data.js";
import {
  A11Y_CHECK_COUNT,
  contrastPair,
  groupA11y,
  notCheckedFor,
  sectionsFor,
  type A11yGroup,
} from "../lib/a11y.js";
import type { Screen, ViewState } from "../lib/url-state.js";

/**
 * Accessibility, on its own screen.
 *
 * It cuts the same findings as every other screen — `category === 'a11y'`, nothing parallel
 * and nothing recomputed — but arranges them the way somebody fixing accessibility reads,
 * which is by *what a person loses*, not by which checker fired. Three decisions follow
 * from that and each of them is load-bearing:
 *
 *  - The consequence leads. `a11y.impact` is the heading and the rule's own explanation is
 *    set small underneath. Reversed, the screen becomes a linter reference, and a linter
 *    reference is something people close.
 *  - `a11y.lint` is one rule carrying three quarters of the findings. Grouping folds on
 *    `impactKey`, which for that rule is one key per plugin rule, so "50 accessibility
 *    problems" resolves into the six or seven distinct ones it actually is.
 *  - An empty section is never presented as a pass. A check that could not run says so at
 *    the top of the screen, because silence next to an unmet obligation reads as approval.
 */

/**
 * The contrast pair, actually rendered.
 *
 * A ratio is a number people argue with; the same two colours drawn on top of each other
 * end the argument in one glance. Shown only when both sides are literal — a token
 * reference would resolve against this dashboard's theme rather than the audited project's.
 */
const ContrastPreview = ({ actual }: { actual: string }): React.ReactElement | null => {
  const pair = contrastPair(actual);

  if (pair === null) {
    return null;
  }

  return (
    <span
      className="inline-flex shrink-0 items-center rounded border border-border px-2 py-0.5 text-[12px] leading-5"
      style={{ background: pair[1], color: pair[0] }}
      title={actual}
    >
      Текст
    </span>
  );
};

const GroupCard = ({
  group,
  expanded,
  onToggle,
  onOpenWcag,
  onOpenFile,
  selection,
  onSelectToggle,
}: {
  group: A11yGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpenWcag: (criterion: string) => void;
  onOpenFile: (file: string) => void;
  selection: ReadonlySet<string>;
  onSelectToggle: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const [openFinding, setOpenFinding] = useState<string | null>(null);

  return (
    <article
      className={cx(
        "rounded-[var(--radius-card)] border bg-surface/80 transition-colors",
        expanded ? "border-border-strong" : "border-border hover:border-border-strong",
      )}
    >
      <header className="flex cursor-pointer items-start gap-3 px-4 py-3" onClick={onToggle}>
        <Dot severity={group.severity} className="mt-1.5" />

        <div className="min-w-0 flex-1">
          {/* The consequence leads. The rule's name is metadata and sits below it. */}
          <h3 className="text-[14px] font-medium leading-snug">{group.impact}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
            <span>{ruleLabel(group.rule)}</span>
            {group.subkind !== null && (
              <>
                <span>·</span>
                <span className="font-mono">{subkindLabel(group.subkind)}</span>
              </>
            )}
            <span>·</span>
            <span className="tabular-nums">
              {group.occurrences} в {group.files} файл(ах)
            </span>
            {group.autoFixable > 0 && (
              <>
                <span>·</span>
                <span className="text-ok">{group.autoFixable} с готовым диффом</span>
              </>
            )}
          </p>
        </div>

        {group.rule === "a11y.contrast.text" && <ContrastPreview actual={group.actual} />}

        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {group.wcag.map((criterion) => (
            <button
              key={criterion}
              type="button"
              title={`WCAG ${criterion} — ${wcagLabel(criterion)}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenWcag(criterion);
              }}
            >
              <Badge tone="info" className="cursor-pointer hover:border-info">
                {criterion}
              </Badge>
            </button>
          ))}
          <span
            className={cx(
              "ml-1 text-[12px] text-faint transition-transform",
              expanded && "rotate-90",
            )}
          >
            ›
          </span>
        </span>
      </header>

      {expanded && (
        <div className="ds-enter border-t border-border">
          {group.fix !== null && (
            <div className="mx-4 mt-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 text-[13px] leading-relaxed">
              <span className="font-medium text-ok">Что сделать:</span>{" "}
              <span className="text-fg">{group.fix}</span>
            </div>
          )}

          {/* The rule's own reasoning, deliberately smaller than the consequence above. */}
          <p className="px-4 py-3 text-[12.5px] leading-relaxed text-muted">{group.why}</p>

          {group.wcag.length > 0 && (
            <p className="px-4 pb-3 text-[12px] text-faint">
              {group.wcag
                .map((criterion) => `WCAG ${criterion} — ${wcagLabel(criterion)}`)
                .join(" · ")}
            </p>
          )}

          {group.autoFixable > 0 && (
            <div className="px-4 pb-3">
              <Button
                onClick={() => {
                  onSelectToggle(
                    group.findings
                      .filter((finding) => finding.autoFixable)
                      .map((finding) => finding.id),
                  );
                }}
              >
                Все диффы этой группы в PR ({group.autoFixable})
              </Button>
            </div>
          )}

          <div className="space-y-1.5 border-t border-border p-3">
            {group.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                context="flat"
                expanded={openFinding === finding.id}
                onToggle={() => {
                  setOpenFinding((previous) => (previous === finding.id ? null : finding.id));
                }}
                onOpenFile={onOpenFile}
                selected={selection.has(finding.id)}
                onSelectToggle={() => {
                  onSelectToggle([finding.id]);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
};

export const A11yScreen = ({
  payload,
  state,
  go,
  navigate,
  selection,
  onSelectToggle,
}: {
  payload: Payload;
  state: ViewState;
  go: (patch: Partial<ViewState>) => void;
  navigate: (patch: Partial<ViewState> & { screen: Screen }) => void;
  selection: ReadonlySet<string>;
  onSelectToggle: (ids: readonly string[]) => void;
}): React.ReactElement => {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const all = useMemo(
    () => payload.findings.filter((finding) => finding.category === "a11y"),
    [payload.findings],
  );

  const findings = useMemo(
    () =>
      all.filter(
        (finding) =>
          (state.severity === null || finding.severity === state.severity) &&
          (state.wcag === null || (finding.a11y?.wcag ?? []).includes(state.wcag)),
      ),
    [all, state.severity, state.wcag],
  );

  const notChecked = useMemo(
    () => notCheckedFor(payload.summary.limitations),
    [payload.summary.limitations],
  );

  const specUnavailable = notChecked.filter(
    (limitation) => limitation.reason === "spec-unavailable",
  );

  const grouped = useMemo(() => groupA11y(findings), [findings]);

  const counts = useMemo(() => {
    const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0, candidate: 0 };
    for (const finding of all) {
      bySeverity[finding.severity] += 1;
    }

    return {
      bySeverity,
      criteria: new Set(all.flatMap((finding) => finding.a11y?.wcag ?? [])).size,
      autoFixable: all.filter((finding) => finding.autoFixable).length,
    };
  }, [all]);

  const sections = useMemo(() => sectionsFor(grouped), [grouped]);

  const filtered = state.severity !== null || state.wcag !== null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="ds-enter mx-auto max-w-5xl space-y-4 p-5">
        <header className="space-y-1">
          <h1 className="text-[19px] font-semibold tracking-tight">Доступность</h1>
          <p className="text-[13px] leading-relaxed text-muted">
            {A11Y_CHECK_COUNT} проверок: клавиатура и фокус разбираются по коду виджета, базовые
            правила — эталонным eslint-plugin-jsx-a11y. Каждая находка говорит, что теряет человек и
            что с этим сделать.
          </p>
        </header>

        {specUnavailable.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-warning/40 bg-warning/10 px-4 py-3">
            <div className="text-[13.5px] font-medium text-warning">Проверка неполная</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Клавиатурная доступность не проверялась у {specUnavailable.length} виджет(ов):
              артефакт <code className="font-mono text-fg">kit-a11y.json</code> не собран. Пустой
              раздел ниже означает «не смотрели», а не «чисто». Соберите его командой{" "}
              <code className="font-mono text-fg">npm run extract:kit-a11y</code>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="Ошибки"
            value={counts.bySeverity.error}
            detail="ломает работу без мыши или без экрана"
            tone="error"
            onClick={() => {
              go({ severity: state.severity === "error" ? null : "error" });
            }}
          />
          <MetricCard
            label="Предупреждения"
            value={counts.bySeverity.warning}
            detail="иногда осознанно — нужен взгляд"
            tone="warning"
            onClick={() => {
              go({ severity: state.severity === "warning" ? null : "warning" });
            }}
          />
          <MetricCard
            label="Критериев WCAG"
            value={counts.criteria}
            detail="затронуто из 2.1 AA"
            onClick={() => {
              go({ wcag: null, severity: null });
            }}
          />
          <MetricCard
            label="С готовым диффом"
            value={counts.autoFixable}
            detail="правится заменой строки"
            tone="ok"
          />
        </div>

        {filtered && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <span>
              Показано {findings.length} из {all.length}
              {state.wcag !== null && (
                <>
                  {" "}
                  · WCAG {state.wcag} — {wcagLabel(state.wcag)}
                </>
              )}
            </span>
            <Button
              onClick={() => {
                go({ severity: null, wcag: null });
              }}
            >
              Снять фильтр
            </Button>
          </div>
        )}

        {all.length === 0 ? (
          <Card>
            <EmptyState>
              {notChecked.length > 0
                ? "Ни одна проверка доступности не сработала — но часть из них и не отработала. Смотрите «Не проверено» ниже."
                : "Нарушений доступности не найдено. Проверялись клавиатура, фокус, ARIA, доступные имена и контраст."}
            </EmptyState>
          </Card>
        ) : (
          sections.map(({ section, groups }) => (
            <Card key={section.id}>
              <CardHeader
                title={section.title}
                hint={section.hint}
                right={
                  <span className="shrink-0 tabular-nums text-[12px] text-faint">
                    {groups.reduce((sum, group) => sum + group.occurrences, 0)}
                  </span>
                }
              />
              {groups.length === 0 ? (
                <EmptyState>
                  {filtered
                    ? "Под текущий фильтр здесь ничего не попало."
                    : section.id === "keyboard" && specUnavailable.length > 0
                      ? "Пусто, но проверка клавиатуры не отработала — см. предупреждение выше."
                      : "Здесь чисто."}
                </EmptyState>
              ) : (
                <div className="space-y-1.5 p-3">
                  {groups.map((group) => (
                    <GroupCard
                      key={group.key}
                      group={group}
                      expanded={openGroup === group.key}
                      onToggle={() => {
                        setOpenGroup((previous) => (previous === group.key ? null : group.key));
                      }}
                      onOpenWcag={(criterion) => {
                        go({ wcag: state.wcag === criterion ? null : criterion });
                      }}
                      onOpenFile={(file) => {
                        navigate({ screen: "files", file });
                      }}
                      selection={selection}
                      onSelectToggle={onSelectToggle}
                    />
                  ))}
                </div>
              )}
            </Card>
          ))
        )}

        <Card>
          <CardHeader
            title="Не проверено"
            hint="Проверки доступности, которые не отработали. Пустой раздел выше — не то же самое, что «чисто»."
            right={
              <span className="shrink-0 tabular-nums text-[12px] text-faint">
                {notChecked.length}
              </span>
            }
          />
          {notChecked.length === 0 ? (
            <EmptyState>Все проверки доступности отработали.</EmptyState>
          ) : (
            <ul className="divide-y divide-border/60">
              {notChecked.map((limitation, index) => (
                <li
                  key={`${limitation.file}:${String(limitation.line ?? 0)}:${String(index)}`}
                  className="px-4 py-2.5"
                >
                  <div className="flex items-baseline gap-2">
                    <Badge tone="warning">{limitationLabel(limitation.reason)}</Badge>
                    <button
                      type="button"
                      onClick={() => {
                        navigate({ screen: "files", file: limitation.file });
                      }}
                      className="min-w-0 truncate font-mono text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      {limitation.file}
                      {limitation.line !== null && `:${String(limitation.line)}`}
                    </button>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
                    {limitation.detail}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="pb-2 text-[11.5px] leading-relaxed text-faint">
          Уровни: {SEVERITY_LABEL.error} — уже неработоспособно без мыши или без экрана;{" "}
          {SEVERITY_LABEL.warning} — зависит от контекста, который статический разбор не видит;{" "}
          {SEVERITY_LABEL.info} — сегодня работает, но развалится при рефакторинге.
        </p>
      </div>
    </div>
  );
};
