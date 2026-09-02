import { useEffect, useMemo, useState } from "react";

import { RulesPanel } from "./components/RulesPanel.js";
import { cx } from "./components/ui.js";
import type { Payload } from "./data.js";
import { buildFileGroups, buildProblems } from "./lib/model.js";
import { readPayload } from "./lib/read-payload.js";
import {
  DEFAULT_RULE_CONFIG,
  EMPTY_OVERRIDES,
  applyRuleConfig,
  mergeConfig,
  overrideCount,
  recountFindings,
} from "./lib/rule-config.js";
import { activeFilters, useViewState, type Screen } from "./lib/url-state.js";
import { A11yScreen } from "./screens/A11y.js";
import { DesignScreen } from "./screens/Design.js";
import { FilesScreen } from "./screens/Files.js";
import { OverviewScreen } from "./screens/Overview.js";
import { ProblemsScreen } from "./screens/Problems.js";

/**
 * Shell: the left rail, the filter chips, the keyboard.
 *
 * The chip row is the visible half of the URL state — every active filter can be dropped
 * with one click, so it is always obvious why a list shows what it shows. Getting stuck
 * behind an invisible filter is the classic way a dashboard loses a reader, and it is the
 * single complaint this layout exists to kill.
 */

let payload: Payload | null = null;
let payloadError: string | null = null;

try {
  payload = readPayload();
} catch (error) {
  payloadError = error instanceof Error ? error.message : "Не удалось прочитать данные";
}

export const App = (): React.ReactElement => {
  const { state, go, navigate, reset } = useViewState();

  // The rule drawer. Deliberately NOT in the URL: what it shows is already in the URL (`cfg`),
  // and a link that reopened somebody else's panel over their first read would be noise.
  const [rulesOpen, setRulesOpen] = useState(false);

  // Diff-check reports open filtered to the changed lines: the working screens receive a
  // payload whose findings are the intersection, so every list, counter and filter reads
  // «этот дифф», not «весь проект». One URL flag (`all=1`) restores the full view; on
  // regular audits `diff` is null and this whole path is inert — nothing changes.
  const diff = payload?.diff ?? null;
  const diffActive = diff !== null && !state.diffOff;

  // The file's config is the DEFAULT; the reader's flips (URL `cfg`) sit on top of it. Both
  // fields are read BARE: a payload written before this feature carries neither, and
  // `readPayload` fills them once at the boundary rather than each consumer guarding for itself
  // — which is what left an old report blank instead of degraded (V4 audit finding 4). The only
  // thing guarded here is `payload` being null, i.e. the read threw and the error screen below
  // is what renders; the hooks above it still have to run.
  const fileConfig = payload === null ? DEFAULT_RULE_CONFIG : payload.ruleConfig;
  const catalog = payload === null ? [] : payload.ruleCatalog;
  const effectiveConfig = useMemo(
    () => mergeConfig(fileConfig, state.overrides),
    [fileConfig, state.overrides],
  );

  /**
   * THE CONFIG, APPLIED — whole project, before any diff filter.
   *
   * Every count in the shell and in the screens comes through here, including the ones on the
   * verdict and design screens, which read the un-diffed payload. The summary counters are
   * recounted rather than carried: the generator's numbers are right only for the generator's
   * config, and the moment the reader flips a rule the embedded ones are stale. The recount is
   * proven equal to the engine's own summary under the same config
   * (`tests/rule-config-parity.test.ts`), so with an untouched config nothing on screen moves.
   *
   * `files.clean` is NOT recounted and stays the generator's — the payload carries findings,
   * not the file inventory a clean-file count needs. Overview labels it.
   */
  const configuredPayload = useMemo(() => {
    if (payload === null) {
      return null;
    }
    const findings = applyRuleConfig(payload.findings, effectiveConfig);

    return {
      ...payload,
      findings,
      summary: { ...payload.summary, findings: recountFindings(findings) },
    };
    // `payload` is a module-level binding assigned once at import, so listing it changes
    // nothing today — and that is exactly why it is listed: the day it becomes state or a prop,
    // an incomplete dependency list would serve a stale render silently (V4 audit finding 7).
  }, [payload, effectiveConfig]);

  const effectivePayload = useMemo(() => {
    if (configuredPayload === null || !diffActive || diff === null) {
      return configuredPayload;
    }
    const wanted = new Set(diff.newFindingIds);
    return {
      ...configuredPayload,
      findings: configuredPayload.findings.filter((finding) => wanted.has(finding.id)),
    };
  }, [configuredPayload, diff, diffActive]);

  const counts = useMemo(() => {
    if (effectivePayload === null) {
      return { problems: 0, files: 0, a11y: 0 };
    }
    return {
      problems: buildProblems(effectivePayload.findings).length,
      files: buildFileGroups(effectivePayload.findings).length,
      a11y: effectivePayload.findings.filter((finding) => finding.category === "a11y").length,
    };
  }, [effectivePayload]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      // Never steal a keystroke from a search box.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === "1") reset("overview");
      if (event.key === "2") reset("problems");
      if (event.key === "3") reset("files");
      if (event.key === "4") reset("design");
      if (event.key === "5") reset("a11y");
      // Esc closes the drawer FIRST: it is the topmost thing on screen, and a key that both
      // closed a panel and cleared the filters behind it would be one keystroke too eager.
      if (event.key === "Escape") {
        if (rulesOpen) {
          setRulesOpen(false);
        } else {
          reset(state.screen);
        }
      }
      if (event.key === "/") {
        event.preventDefault();
        navigate({ screen: "problems" });
        window.setTimeout(() => {
          document.querySelector("input")?.focus();
        }, 0);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate, reset, rulesOpen, state.screen]);

  if (payload === null || configuredPayload === null || effectivePayload === null) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold text-error">Нет данных анализа</h1>
          <p className="text-[13px] text-muted">{payloadError}</p>
          <p className="font-mono text-[12px] text-faint">npm run analyze -- /путь/к/проекту</p>
        </div>
      </div>
    );
  }

  // The verdict screen keeps whole-project numbers even in diff mode — health and the
  // interface composition are project properties; the banner carries the diff's own count.
  const data = effectivePayload;
  const fullData = configuredPayload;
  const changedRules = overrideCount(state.overrides);
  const crumbs = activeFilters(state);
  const diffAutoFixable =
    diff === null ? 0 : data.findings.filter((finding) => finding.autoFixable).length;

  const NAV: { key: Screen; label: string; count?: number; hint: string }[] = [
    { key: "overview", label: "Сводка", hint: "вердикт и с чего начать" },
    { key: "problems", label: "План работ", count: counts.problems, hint: "решения по приоритету" },
    { key: "files", label: "По файлам", count: counts.files, hint: "правки файла сверху вниз" },
    { key: "design", label: "Дизайн-система", hint: "кастомы, палитра, компоненты" },
    { key: "a11y", label: "Доступность", count: counts.a11y, hint: "клавиатура, имена, контраст" },
  ];

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface/50">
        <div className="border-b border-border px-4 py-4">
          <div className="text-[14px] font-semibold tracking-tight">Аудит дизайн-системы</div>
          <div className="mt-1 truncate text-[12px] text-muted" title={data.project.root}>
            {data.project.name ?? data.project.root}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-faint">{data.generatedAt}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item, index) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                navigate({ screen: item.key });
              }}
              className={cx(
                "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                state.screen === item.key
                  ? "bg-surface-2 text-fg"
                  : "text-muted hover:bg-surface-2/60 hover:text-fg",
              )}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <span className="w-3 text-[11px] tabular-nums text-faint">{index + 1}</span>
                {item.label}
                {item.count !== undefined && (
                  <span className="ml-auto tabular-nums text-[12px] text-faint">{item.count}</span>
                )}
              </span>
              <span className="pl-5 text-[11px] leading-tight text-faint">{item.hint}</span>
            </button>
          ))}
        </nav>

        {/* The config, one click from every screen. The dot is the only thing that changes
            when nothing has been overridden — an untouched report looks exactly as it did. */}
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => {
              setRulesOpen(true);
            }}
            className={cx(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
              rulesOpen ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
            )}
          >
            <span className="w-3 text-[11px] text-faint">⚙</span>
            Правила
            {changedRules > 0 && (
              <span
                className="ml-auto h-1.5 w-1.5 rounded-full bg-accent"
                title={`изменено правил: ${String(changedRules)}`}
              />
            )}
          </button>
        </div>

        <div className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-faint">
          1–5 — экраны · / — поиск
          <br />
          Esc — сбросить фильтры
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {diff !== null && (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-accent/40 bg-accent/10 px-5 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              проверка диффа
            </span>
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">
              {diff.range}
            </code>
            <span className="text-[12.5px] text-muted">
              изменено {diff.changedFiles} ф. · {diff.changedLines} строк —{" "}
              <span
                className={cx(
                  "font-semibold",
                  diff.newFindingIds.length > 0 ? "text-warning" : "text-ok",
                )}
              >
                {diff.newFindingIds.length > 0
                  ? `внесено отклонений: ${String(diff.newFindingIds.length)}`
                  : "отклонений не внесено"}
              </span>
              {diffAutoFixable > 0 && ` · авто-фикс: ${String(diffAutoFixable)}`}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  go({ diffOff: false });
                }}
                className={cx(
                  "rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                  diffActive
                    ? "border-accent/50 bg-accent/15 text-fg"
                    : "border-border text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                Только изменения
              </button>
              <button
                type="button"
                onClick={() => {
                  go({ diffOff: true });
                }}
                className={cx(
                  "rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                  !diffActive
                    ? "border-accent/50 bg-accent/15 text-fg"
                    : "border-border text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                Весь проект
              </button>
            </div>
          </div>
        )}
        {crumbs.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-bg/70 px-5 py-2 backdrop-blur">
            <span className="text-[11px] uppercase tracking-wider text-faint">фильтры</span>
            {crumbs.map((crumb) => (
              <button
                key={crumb.key}
                type="button"
                onClick={() => {
                  // The rules chip is not a filter with a null state: dropping it means
                  // "back to what the file said", which is an empty override set.
                  if (crumb.key === "overrides") {
                    go({ overrides: EMPTY_OVERRIDES });
                    return;
                  }
                  go({
                    [crumb.key]:
                      crumb.key === "query" ? "" : crumb.key === "autoFixableOnly" ? false : null,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-[12px] text-fg transition-colors hover:border-accent"
              >
                <span className="text-faint">{crumb.label}:</span>
                <span className="max-w-48 truncate font-mono">{crumb.value}</span>
                <span className="text-faint">×</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                reset(state.screen);
              }}
              className="ml-1 text-[12px] text-muted underline-offset-2 transition-colors hover:text-fg hover:underline"
            >
              сбросить всё
            </button>
          </div>
        )}

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {state.screen === "overview" && <OverviewScreen payload={fullData} navigate={navigate} />}
          {state.screen === "problems" && (
            <ProblemsScreen payload={data} state={state} go={go} reset={reset} />
          )}
          {state.screen === "files" && <FilesScreen payload={data} state={state} go={go} />}
          {state.screen === "design" && (
            <DesignScreen payload={fullData} state={state} go={go} navigate={navigate} />
          )}
          {state.screen === "a11y" && (
            <A11yScreen payload={data} state={state} go={go} navigate={navigate} />
          )}
        </main>
      </div>

      {rulesOpen && (
        <RulesPanel
          fileConfig={fileConfig}
          config={effectiveConfig}
          catalog={catalog}
          findings={payload.findings}
          overrides={state.overrides}
          onOverridesChange={(overrides) => {
            go({ overrides });
          }}
          onClose={() => {
            setRulesOpen(false);
          }}
        />
      )}
    </div>
  );
};
