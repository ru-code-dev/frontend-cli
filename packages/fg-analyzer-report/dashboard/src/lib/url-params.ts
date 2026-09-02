import {
  EMPTY_OVERRIDES,
  overrideCount,
  parseOverrides,
  serialiseOverrides,
  type RuleOverrides,
} from "./rule-config.js";

/**
 * THE URL, AS A PURE FUNCTION — no `window`, no React, no DOM.
 *
 * Split out of `url-state.ts` so the state a link encodes can be tested directly. The hook next
 * door owns the browser half (`history.pushState`, `popstate`, the pathname); everything here
 * is `search string` <-> {@link ViewState} and back, which is the half that can be wrong in a
 * way a reader would notice — a filter that survives a reset, or a rule flip that does not
 * survive a paste into a ticket.
 *
 * Nothing in this file may reach for `window`: the tier-1 suite typechecks and runs it under
 * node, where there is none.
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
  /**
   * The reader's flips on top of the file's rule config (`cfg` in the URL).
   *
   * NOT a filter, and that distinction is why it survives `navigate`/`reset` below: a filter
   * says "show me this slice of the report", a config says "these rules are not my problem".
   * Losing the second on every click into a card would make the panel unusable, and there is a
   * dedicated «сбросить к файлу» — and a chip — for undoing it.
   */
  overrides: RuleOverrides;
}

export const EMPTY: ViewState = {
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
  overrides: EMPTY_OVERRIDES,
};

const SCREENS: ReadonlySet<Screen> = new Set(["overview", "problems", "files", "design", "a11y"]);

export const parseViewState = (search: string): ViewState => {
  const params = new URLSearchParams(search);
  const read = (key: string): string | null => {
    const value = params.get(key);
    return value === null || value.length === 0 ? null : value;
  };

  const screen = read("screen");

  return {
    screen: SCREENS.has(screen as Screen) ? (screen as Screen) : "overview",
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
    overrides: parseOverrides(read("cfg")),
  };
};

export const serialiseViewState = (state: ViewState): string => {
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
  write("cfg", serialiseOverrides(state.overrides));

  return params.toString();
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
  // One chip for the whole config, not one per flip: the panel is where the detail lives, and
  // a reader who switched off three categories does not want three identical-looking chips.
  const changed = overrideCount(state.overrides);
  if (changed > 0)
    crumbs.push({ key: "overrides", label: "правила", value: `изменены (${String(changed)})` });

  return crumbs;
};
