/**
 * EVERY LIMITATION REASON THIS BUILD CAN EMIT HAS A RUSSIAN BADGE.
 *
 * `Overview.tsx` renders `limitationLabel(reason)` as a badge, and that helper ends in
 * `?? reason` — so a reason nobody labelled does not fail, it SHIPS, as an English kebab id
 * inside a Russian report. That is exactly what happened to `unresolved-token-reference` and
 * `no-upstream`, the two reasons EDS 2.x added and the visible half of design E5 and E6 (V6
 * audit finding #2); `unsupported-syntax` had been in the same state since before that wave.
 *
 * The list is DERIVED, never transcribed. `limitationSchema` is the engine's own wire contract
 * for a limitation, so its `reason` enum is the complete set of ids the analysis can produce,
 * and a ninth reason added tomorrow arrives here as a failing assertion instead of as a badge
 * a reader cannot read. The adapter half is derived too — `import.bypass` is the one rule that
 * declares a limitation of its own, and it is called for its answer rather than quoted.
 *
 * The fallback in `limitationLabel` stays and is asserted separately: a payload written by a
 * NEWER build than the viewer must still render, and an unknown id shown raw is the honest
 * failure mode there.
 */
import { limitationSchema } from "@smart-tools/fg-analyzer-engine";
import { describe, expect, it } from "vite-plus/test";

import { bypassImportRule } from "../../fg-eds-adapter/src/rules/api/imports.ts";
import type { KitContext } from "../../fg-eds-adapter/src/rules/kit-context.ts";
import { LIMITATION_LABEL, limitationLabel } from "../dashboard/src/data.js";

/** Every reason the engine's contract admits, read off the schema rather than listed. */
const REASONS: readonly string[] = limitationSchema.shape.reason.options;

/**
 * The kit facade `import.bypass` reads to decide whether it has anything to check.
 *
 * Only the two fields its `limitations()` touches, because building a real `KitSpec` here would
 * mean loading a four-megabyte corpus to learn one string. A profile with no upstream scope is
 * the EDS 2.x shape (`profile.ts`'s `eds2.upstreamScope: null`) and is what makes the rule
 * declare its limitation.
 */
const NO_UPSTREAM_KIT = {
  kit: { profile: { upstreamScope: null, displayName: "EDS 2.x" } },
} as unknown as KitContext;

describe("limitation labels", () => {
  it("labels every reason the engine's contract can carry", () => {
    // Anchored by a literal so that a schema which lost a reason cannot make this pass by
    // shrinking: nine reasons today (`domain/profile.ts`'s `limitationReasonSchema`) — the
    // ninth, `file-too-large`, is f1-fixes item 6 / V6 audit finding #7.
    expect(REASONS).toHaveLength(9);

    const unlabelled = REASONS.filter((reason) => LIMITATION_LABEL[reason] === undefined);
    expect(unlabelled).toEqual([]);
  });

  it("labels the two reasons EDS 2.x added, in Russian", () => {
    expect(LIMITATION_LABEL["unresolved-token-reference"]).toBe(
      "не удалось разобрать ссылку на токен",
    );
    expect(LIMITATION_LABEL["no-upstream"]).toBe(
      "у дизайн-системы нет обёрнутой библиотеки — проверка обхода не применима",
    );
  });

  it("labels the reason the ADAPTER emits, taken from the rule and not from a list", () => {
    const declared = bypassImportRule(NO_UPSTREAM_KIT).limitations?.({
      // The rule's `limitations()` reads nothing but the kit; the context is a placeholder its
      // signature requires.
    } as never);

    expect(declared?.map((entry) => entry.reason)).toEqual(["no-upstream"]);
    for (const entry of declared ?? []) {
      expect(limitationLabel(entry.reason)).not.toBe(entry.reason);
    }
  });

  it("never renders a reason as the raw kebab id it arrived as", () => {
    for (const reason of REASONS) {
      const label = limitationLabel(reason);
      expect(label).not.toBe(reason);
      // A Russian report: every badge carries Cyrillic, so an English id copied into the table
      // as its own label would not pass either.
      expect(label).toMatch(/[а-яё]/i);
    }
  });

  it("still renders an id from a newer build, raw", () => {
    // The fallback is deliberate. A payload is read by whatever dashboard the reader has.
    expect(limitationLabel("a-reason-from-the-future")).toBe("a-reason-from-the-future");
  });
});
