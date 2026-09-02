/**
 * THE BROWSER HALF, RENDERED — the two audit findings that are only observable on screen.
 *
 * A file of its own because it is the only suite that imports the dashboard's `.tsx` screens
 * and its one DOM-touching module. Those need `jsx` and the `DOM` lib, which the package's
 * node-side `tsconfig.json` deliberately does not have (its job is a pure string generator that
 * must never reach for `document`), so this file is excluded there and included by
 * `dashboard/tsconfig.json` instead — checked by the project that owns the code it exercises.
 * Every import therefore uses a `.js` specifier, the way the dashboard's own sources do.
 *
 * `renderToStaticMarkup` rather than a string search over the built template: both findings are
 * about what a conditional in JSX decides, and the only way to prove a branch does not render
 * is to render it. The screen is pure — a payload and a `navigate` callback in, markup out — so
 * it runs here under node beside the rest of the tier-1 lane.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { Payload } from "../dashboard/src/data.js";
import { readPayload } from "../dashboard/src/lib/read-payload.js";
import { DEFAULT_RULE_CONFIG } from "../dashboard/src/lib/rule-config.js";
import { OverviewScreen } from "../dashboard/src/screens/Overview.js";
import { payloadOf } from "../src/index.js";
import { minimalFinding, resultOf } from "./support.js";

const overviewHtml = (payload: Payload): string =>
  renderToStaticMarkup(createElement(OverviewScreen, { payload, navigate: () => undefined }));

const CLEAN_LINE = /Чистых файлов[^<]*/u;

/** The real generator's output, seen as the dashboard sees it. */
const generated = (options: Parameters<typeof payloadOf>[1] = {}): Payload =>
  payloadOf(resultOf([minimalFinding]), {
    generatedAt: "2026-09-08",
    ...options,
  }) as unknown as Payload;

/** The `#ds-data` element, as the browser hands it to `readPayload`. */
const withInjected = <T>(json: string, body: () => T): T => {
  const previous = Reflect.get(globalThis, "document") as unknown;
  Reflect.set(globalThis, "document", {
    getElementById: (id: string) => (id === "ds-data" ? { textContent: json } : null),
  });
  try {
    return body();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "document");
    else Reflect.set(globalThis, "document", previous);
  }
};

/** A report written before this feature: everything else, neither of the two new fields. */
const legacyJson = (): string => {
  // Through JSON and back first: what a stored report holds is text, and the two fields have
  // to be missing from THAT, not merely undefined on an object.
  const raw = JSON.parse(
    JSON.stringify(payloadOf(resultOf([minimalFinding]), { generatedAt: "2026-09-08" })),
  ) as Record<string, unknown>;
  delete raw["ruleConfig"];
  delete raw["ruleCatalog"];
  return JSON.stringify(raw);
};

describe("an untouched config leaves the screen untouched (audit finding 2)", () => {
  it("a defaults payload renders the clean-files line exactly as it did before the feature", () => {
    const html = overviewHtml(generated());

    // The line the audit caught reading «… 9 из 10 (по конфигу по умолчанию)».
    expect(CLEAN_LINE.exec(html)?.[0]).toBe("Чистых файлов — 9 из 10");
    expect(html).not.toContain("конфиг");
    expect(html).not.toContain("умолчанию");
  });

  it("…and says it, with the parentheses, when a file actually decided something", () => {
    const html = overviewHtml(
      generated({
        ruleConfig: {
          default: "on",
          categories: {},
          rules: {},
          source: { kind: "file", path: "/repo/fg.config.json" },
        },
      }),
    );

    expect(CLEAN_LINE.exec(html)?.[0]).toBe("Чистых файлов — 9 из 10 (по конфигу файла)");
  });
});

describe("a payload without the two new fields degrades, never blanks (audit finding 4)", () => {

  it("fills the identity config and an empty catalog ONCE, at the read boundary", () => {
    const json = legacyJson();
    expect(JSON.parse(json)).not.toHaveProperty("ruleConfig");
    expect(JSON.parse(json)).not.toHaveProperty("ruleCatalog");

    const payload = withInjected(json, readPayload);
    expect(payload.ruleConfig).toEqual(DEFAULT_RULE_CONFIG);
    expect(payload.ruleCatalog).toEqual([]);
  });

  it("and the screen that reads `ruleConfig` bare renders it instead of throwing", () => {
    const payload = withInjected(legacyJson(), readPayload);

    // Before the fix this threw `Cannot read properties of undefined (reading 'source')` inside
    // `configNote`, and the whole dashboard went blank.
    const html = overviewHtml(payload);
    expect(CLEAN_LINE.exec(html)?.[0]).toBe("Чистых файлов — 9 из 10");
    expect(html.length).toBeGreaterThan(1000);
  });
});
