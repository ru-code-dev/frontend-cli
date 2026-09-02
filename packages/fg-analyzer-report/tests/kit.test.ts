/**
 * PANEL VISIBILITY, BOTH WAYS.
 *
 * The restored kit panels must draw when the report carries design-system data and be absent —
 * not empty, not zeroed — when it does not. No browser exists in this repo (b3 §10, b4 §7 both
 * state it), so the assertion is made where the decision actually is: `dashboard/lib/kit.ts`
 * is the single gate every kit panel reads, and it is a pure function over a payload.
 *
 * Two halves, and both are needed:
 *
 *  - here: the payloads a real run produces map to "panels on" / "panels off";
 *  - `template.test.ts`: the panels' markup is in the built artifact at all.
 *
 * Importing a `dashboard/` module from this suite is the arrangement `lib/a11y.ts` was split
 * out for (`dashboard/src/lib/a11y.ts:6-8`): the file is types-only, no DOM and no React, so
 * it loads under the library's own test config unchanged.
 */
import { describe, expect, it } from "vite-plus/test";

import { a11yCheckCount, JSX_A11Y_CHECK_COUNT } from "../dashboard/src/lib/a11y.ts";
import { kitDataOf } from "../dashboard/src/lib/kit.ts";
import type { Payload } from "../dashboard/src/contract.ts";
import { payloadOf } from "../src/index.ts";

import { kitResultOf, minimalFinding, resultOf } from "./support.ts";

/**
 * The dashboard's `Payload` and the library's `ReportPayload` are two declarations of one wire
 * shape, deliberately not shared (`src/contract.ts:10-15`). Passing a real `payloadOf` result
 * through this cast is what keeps them honest: if the two drift, this file stops compiling.
 */
const asPayload = (value: unknown): Payload => value as Payload;

describe("kitDataOf — the one gate the kit panels read", () => {
  it("a report from a run WITH an adapter switches the panels on", () => {
    const kit = kitDataOf(asPayload(payloadOf(kitResultOf([minimalFinding]))));

    expect(kit).not.toBeNull();
    expect(kit?.healthScore).toBe(71);
    expect(kit?.tokenCoverage).toBeCloseTo(0.62);
    expect(kit?.kitGaps).toHaveLength(1);
    // The tables, the palette and the custom-component cards all read this one object.
    expect(kit?.usage.components[0]?.name).toBe("Button");
    expect(kit?.usage.customComponents[0]?.name).toBe("Card");
    expect(kit?.usage.unusedComponents).toEqual(["Drawer"]);
  });

  it("a report from a run WITHOUT an adapter switches them off", () => {
    expect(kitDataOf(asPayload(payloadOf(resultOf([minimalFinding]))))).toBeNull();
  });

  it("is all-or-nothing: usage without the summary half is still off", () => {
    const half = { ...payloadOf(kitResultOf([minimalFinding])) } as Record<string, unknown>;
    half["summary"] = payloadOf(resultOf([minimalFinding])).summary;

    // `usage` is present and the panels stay hidden, because a health ring drawn around an
    // absent score is worse than no ring.
    expect(half["usage"]).toBeDefined();
    expect(kitDataOf(asPayload(half))).toBeNull();
  });
});

describe("the accessibility check count is derived, not pinned", () => {
  const a11yRules = {
    "a11y.lint": "…",
    "a11y.name.missing": "…",
    "a11y.contrast.text": "…",
  };

  it("counts every hand-written a11y rule that ran, plus the jsx-a11y checks", () => {
    // `a11y.lint` is not one check but the twenty-nine, so it must not be counted twice.
    expect(a11yCheckCount(a11yRules)).toBe(JSX_A11Y_CHECK_COUNT + 2);
  });

  it("goes up by one when the adapter's kit-gated keyboard rule joins the run", () => {
    expect(a11yCheckCount({ ...a11yRules, "a11y.pattern.keyboard": "…" })).toBe(
      a11yCheckCount(a11yRules) + 1,
    );
  });

  it("ignores rules from other domains", () => {
    expect(
      a11yCheckCount({ ...a11yRules, "icon.foreign-pack": "…", "token.literal.color": "…" }),
    ).toBe(a11yCheckCount(a11yRules));
  });
});
