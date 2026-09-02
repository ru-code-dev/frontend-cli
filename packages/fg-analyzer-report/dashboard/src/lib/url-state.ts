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
 *
 * The state ITSELF — its shape, and the two functions that turn it into a query string and
 * back — lives in `url-params.ts`, which touches no browser API and is therefore testable under
 * node. This file is the browser half: `pushState`, `popstate`, and the pathname the query is
 * hung off.
 */

import {
  EMPTY,
  parseViewState,
  serialiseViewState,
  type Screen,
  type ViewState,
} from "./url-params.js";

export { activeFilters, type Screen, type ViewState } from "./url-params.js";

/** The query string of `url-params.ts`, hung off the page's own path. */
const serialise = (state: ViewState): string => {
  const query = serialiseViewState(state);

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
  const [state, setState] = useState<ViewState>(() => parseViewState(window.location.search));

  useEffect(() => {
    const onPop = (): void => {
      setState(parseViewState(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Takes a function of the previous state, not a value: `navigate` and `reset` wipe every
  // FILTER but carry the rule overrides forward, and that carry needs to read what was there.
  const apply = useCallback((next: (previous: ViewState) => ViewState): void => {
    setState((previous) => {
      const state = next(previous);
      window.history.pushState(null, "", serialise(state));
      return state;
    });
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
      apply((previous) => ({ ...EMPTY, overrides: previous.overrides, ...patch }));
    },
    [apply],
  );

  const reset = useCallback(
    (screen: Screen = "overview"): void => {
      apply((previous) => ({ ...EMPTY, overrides: previous.overrides, screen }));
    },
    [apply],
  );

  return { state, go, navigate, reset };
};
