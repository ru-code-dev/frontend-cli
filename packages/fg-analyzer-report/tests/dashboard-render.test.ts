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
import {
  DEFAULT_RULE_CONFIG,
  applyRuleConfig,
  recountFindings,
} from "../dashboard/src/lib/rule-config.js";
import { OverviewScreen } from "../dashboard/src/screens/Overview.js";
import { payloadOf, summaryOf } from "../src/index.js";
import { kitResultOf, minimalFinding, resultOf } from "./support.js";

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


/**
 * G1 — `--format summary` IS the dashboard's numbers. The Overview screen is rendered from the
 * very payload `summaryOf` reads, and every figure the summary carries is found where the screen
 * draws it: the value slot of the metric card with that label, the health ring's number, the
 * first rows of «С чего начать».
 */
const finding = (over: Partial<typeof minimalFinding>): typeof minimalFinding => ({
  ...minimalFinding,
  ...over,
});

/** The text in the value slot of the metric card labelled `label`. */
const cardValue = (html: string, label: string): string | undefined =>
  new RegExp(`>${label}</span><span[^>]*>([^<]*)</span>`, "u").exec(html)?.[1];

describe("G1 parity — summaryOf equals what the Overview screen shows", () => {
  /** Six findings over four problems, mixed severities and categories, one auto-fixable. */
  const findings = [
    minimalFinding,
    finding({ id: "a2", file: "src/Other.tsx", line: 3 }),
    finding({
      id: "t1",
      rule: "token.color.hardcode",
      category: "token",
      severity: "warning",
      actual: "#ff0000",
      autoFixable: true,
      impactKey: "token.color:#ff0000",
      file: "src/Card.tsx",
    }),
    finding({
      id: "t2",
      rule: "token.color.hardcode",
      category: "token",
      severity: "warning",
      actual: "#ff0000",
      autoFixable: true,
      impactKey: "token.color:#ff0000",
      file: "src/Card.tsx",
      line: 20,
    }),
    finding({
      id: "i1",
      rule: "icon.foreign-pack",
      category: "icon",
      severity: "info",
      actual: "lucide",
      impactKey: "icon:lucide",
    }),
    finding({
      id: "c1",
      rule: "component.duplicate",
      category: "component",
      severity: "candidate",
      actual: "Card",
      impactKey: "dup:Card",
    }),
  ];
  const payload = generated();
  const kitPayload = payloadOf(kitResultOf(findings), { generatedAt: "2026-10-28" }) as unknown as Payload;

  it("kit payload: health, totals, shares, coverage — each where the screen draws it", () => {
    const html = overviewHtml(kitPayload);
    const summary = summaryOf(kitPayload as never);
    expect(summary.health?.score).toBe(71);
    expect(html).toContain(`tabular-nums">${String(summary.health?.score)}</span><span class="mt-1 text-[11px] tracking-wide text-faint">из 100`);
    expect(cardValue(html, "Отклонения")).toBe(String(summary.totals.findings));
    expect(cardValue(html, "Решений")).toBe(String(summary.totals.problems));
    expect(cardValue(html, "Авто-фикс")).toBe(String(summary.totals.autoFixable));
    expect(cardValue(html, "Доступность")).toBe(String(summary.totals.a11y));
    expect(cardValue(html, "Компоненты из ДС")).toBe(`${String(summary.kit?.kitShare)}%`);
    expect(cardValue(html, "Кастомные на токенах ДС")).toBe(`${String(summary.kit?.customTokensShare)}%`);
    expect(cardValue(html, "Кастомные без токенов ДС")).toBe(
      `${String(summary.kit?.customWithoutTokensShare)}%`,
    );
    expect(cardValue(html, "Покрытие токенами")).toBe(`${String(summary.kit?.tokenCoverage)}%`);
    expect(html).toContain(
      `${String(summary.totals.errors)} ошибок · ${String(summary.totals.warnings)} предупреждений`,
    );
    // The arithmetic the fixture fixes, so a summary that drifted with the screen is caught too.
    expect(summary.totals).toMatchObject({
      findings: 6,
      errors: 2,
      warnings: 2,
      info: 1,
      candidates: 1,
      problems: 4,
      autoFixable: 2,
      a11y: 2,
    });
    expect(summary.kit).toEqual({
      components: 10,
      kitShare: 40,
      customTokensShare: 20,
      customWithoutTokensShare: 40,
      tokenCoverage: 62,
    });
  });

  it("kit payload: topProblems are «С чего начать»'s first rows, in its order", () => {
    const html = overviewHtml(kitPayload);
    const summary = summaryOf(kitPayload as never);
    const plan = html.slice(html.indexOf("С чего начать"));
    let at = 0;
    for (const problem of summary.topProblems) {
      const label = plan.indexOf(`>${problem.label}<`, at);
      const row = plan.indexOf(`${String(problem.occurrences)}× · ${String(problem.files)} ф.`, label);
      expect(label, problem.rule).toBeGreaterThanOrEqual(at);
      expect(row, problem.rule).toBeGreaterThan(label);
      at = row + 1;
    }
    expect(summary.topProblems.map((p) => p.rule)).toEqual([
      "a11y.name.missing",
      "token.color.hardcode",
      "icon.foreign-pack",
      "component.duplicate",
    ]);
  });

  it("caps topProblems at five", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      finding({ id: `m${String(i)}`, impactKey: `k${String(i)}`, actual: `a${String(i)}` }),
    );
    expect(summaryOf(payloadOf(kitResultOf(many)) as never).topProblems).toHaveLength(5);
  });

  it("follows the FILE's rule config, as the dashboard's default view does", () => {
    const off = payloadOf(kitResultOf(findings), {
      ruleConfig: {
        default: "on",
        categories: { a11y: "off" },
        rules: {},
        source: { kind: "file", path: "/repo/fg.config.json" },
      },
    }) as unknown as Payload;
    const summary = summaryOf(off as never);
    expect(summary.totals.a11y).toBe(0);
    expect(summary.totals.findings).toBe(4);
    // What App.tsx hands the Overview screen: the file's config applied, the counters recounted.
    const shown = applyRuleConfig(off.findings, off.ruleConfig);
    const screen = { ...off, findings: shown, summary: { ...off.summary, findings: recountFindings(shown) } };
    expect(cardValue(overviewHtml(screen), "Отклонения")).toBe("4");
    expect(cardValue(overviewHtml(screen), "Доступность")).toBe("0");
  });

  it("no adapter: no health ring, no kit cards — and null in the summary", () => {
    const html = overviewHtml(payload);
    const summary = summaryOf(payload as never);
    expect(summary.health).toBeNull();
    expect(summary.kit).toBeNull();
    expect(html).not.toContain("Компоненты из ДС");
    expect(cardValue(html, "Отклонения")).toBe(String(summary.totals.findings));
  });

  it("is small: the kit summary serialises to well under qwen's 30 000-char shell cap", () => {
    expect(JSON.stringify(summaryOf(kitPayload as never), null, 2).length).toBeLessThan(5000);
  });
});
