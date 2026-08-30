import { useCallback, useEffect, useState } from "react";

/**
 * Navigation state lives in the URL.
 *
 * Every level of drill-down — screen, filter, selected problem, file — is a query
 * parameter, so any view can be pasted into a ticket and opened by somebody else at
 * exactly the same place. The back button works for free, because each transition is a
 * `pushState`.
 *
 * Two ways to move, and the distinction is the whole UX fix:
 *
 *  - `go` merges a patch — used for toggling filters *within* the current screen.
 *  - `navigate` resets everything first — used for every click that *opens* a view
 *    (a chart segment, a stat card, a swatch). The old dashboard merged those too, which
 *    let a search query from one screen silently empty a list on another. A filter the
 *    user cannot see is a bug, not a feature.
 */

export type Screen = "overview" | "problems" | "files" | "design" | "a11y";

export interface ViewState {
  screen: Screen;
  /** Problems screen: `flat` shows every occurrence as its own row instead of folding. */
  mode: "flat" | null;
  /** Filter by rule id, e.g. `token.literal.color`. */
  rule: string | null;
  /** Filter by subkind within a rule, e.g. `near`. */
  subkind: string | null;
  severity: string | null;
  category: string | null;
  /** Exact match on the raw value, e.g. `#2969e3` — set by palette and histogram clicks. */
  value: string | null;
  /** Selected file on the files screen. */
  file: string | null;
  /** Selected problem group (impactKey); opens expanded and scrolled into view. */
  group: string | null;
  /** Selected finding id within a file. */
  finding: string | null;
  /** Selected kit component on the design screen. */
  component: string | null;
  /** Filter by WCAG success criterion, e.g. `2.1.1`. Set from the accessibility screen. */
  wcag: string | null;
  /** Free-text search across file, value and explanation. */
  query: string;
  /** Only findings that can be patched without a human. */
  autoFixableOnly: boolean;
  /**
   * Diff-check reports open filtered to the changed lines; this flag (`all=1` in the URL)
   * switches back to the whole project. Meaningless when the payload carries no diff.
   */
  diffOff: boolean;
}

const EMPTY: ViewState = {
  screen: "overview",
  mode: null,
  rule: null,
  subkind: null,
  severity: null,
  category: null,
  value: null,
  file: null,
  group: null,
  finding: null,
  component: null,
  wcag: null,
  query: "",
  autoFixableOnly: false,
  diffOff: false,
};

const SCREENS: readonly Screen[] = ["overview", "problems", "files", "design", "a11y"];

const parse = (search: string): ViewState => {
  const params = new URLSearchParams(search);
  const read = (key: string): string | null => {
    const value = params.get(key);
    return value === null || value.length === 0 ? null : value;
  };

  const screen = read("screen");

  return {
    screen: SCREENS.includes(screen as Screen) ? (screen as Screen) : "overview",
    mode: read("mode") === "flat" ? "flat" : null,
    rule: read("rule"),
    subkind: read("subkind"),
    severity: read("severity"),
    category: read("category"),
    value: read("value"),
    file: read("file"),
    group: read("group"),
    finding: read("finding"),
    component: read("component"),
    wcag: read("wcag"),
    query: read("q") ?? "",
    autoFixableOnly: params.get("fix") === "1",
    diffOff: params.get("all") === "1",
  };
};

const serialise = (state: ViewState): string => {
  const params = new URLSearchParams();
  const write = (key: string, value: string | null): void => {
    if (value !== null && value.length > 0) {
      params.set(key, value);
    }
  };

  // `overview` is the default, so it is left out to keep shared links short.
  write("screen", state.screen === "overview" ? null : state.screen);
  write("mode", state.mode);
  write("rule", state.rule);
  write("subkind", state.subkind);
  write("severity", state.severity);
  write("category", state.category);
  write("value", state.value);
  write("file", state.file);
  write("group", state.group);
  write("finding", state.finding);
  write("component", state.component);
  write("wcag", state.wcag);
  write("q", state.query);
  if (state.autoFixableOnly) {
    params.set("fix", "1");
  }
  if (state.diffOff) {
    params.set("all", "1");
  }

  const query = params.toString();

  return query.length === 0 ? window.location.pathname : `${window.location.pathname}?${query}`;
};

export const useViewState = (): {
  state: ViewState;
  /** Merge a patch into the current state — filter toggles within a screen. */
  go: (patch: Partial<ViewState>) => void;
  /** Reset everything, then apply the patch — every click that opens a view. */
  navigate: (patch: Partial<ViewState>) => void;
  reset: (screen?: Screen) => void;
} => {
  const [state, setState] = useState<ViewState>(() => parse(window.location.search));

  useEffect(() => {
    const onPop = (): void => {
      setState(parse(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const apply = useCallback((next: ViewState): void => {
    window.history.pushState(null, "", serialise(next));
    setState(next);
  }, []);

  const go = useCallback(
    (patch: Partial<ViewState>): void => {
      setState((previous) => {
        const next = { ...previous, ...patch };
        window.history.pushState(null, "", serialise(next));
        return next;
      });
    },
    [setState],
  );

  const navigate = useCallback(
    (patch: Partial<ViewState>): void => {
      apply({ ...EMPTY, ...patch });
    },
    [apply],
  );

  const reset = useCallback(
    (screen: Screen = "overview"): void => {
      apply({ ...EMPTY, screen });
    },
    [apply],
  );

  return { state, go, navigate, reset };
};

/** Non-default filters, for the always-visible chip row. */
export const activeFilters = (
  state: ViewState,
): { key: keyof ViewState; label: string; value: string }[] => {
  const crumbs: { key: keyof ViewState; label: string; value: string }[] = [];

  if (state.severity !== null)
    crumbs.push({ key: "severity", label: "серьёзность", value: state.severity });
  if (state.category !== null)
    crumbs.push({ key: "category", label: "категория", value: state.category });
  if (state.rule !== null) crumbs.push({ key: "rule", label: "правило", value: state.rule });
  if (state.subkind !== null)
    crumbs.push({ key: "subkind", label: "подвид", value: state.subkind });
  if (state.value !== null) crumbs.push({ key: "value", label: "значение", value: state.value });
  if (state.file !== null) crumbs.push({ key: "file", label: "файл", value: state.file });
  if (state.component !== null)
    crumbs.push({ key: "component", label: "компонент", value: state.component });
  if (state.wcag !== null) crumbs.push({ key: "wcag", label: "WCAG", value: state.wcag });
  if (state.query.length > 0) crumbs.push({ key: "query", label: "поиск", value: state.query });
  if (state.autoFixableOnly)
    crumbs.push({ key: "autoFixableOnly", label: "только", value: "авто-фикс" });

  return crumbs;
};
