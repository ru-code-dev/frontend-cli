import type { Payload } from "../contract.js";
import { DEFAULT_RULE_CONFIG } from "./rule-config.js";

/**
 * What a report written before the rule-config feature carries: everything except the two
 * fields that feature added.
 */
type LegacyPayload = Omit<Payload, "ruleConfig" | "ruleCatalog"> &
  Partial<Pick<Payload, "ruleConfig" | "ruleCatalog">>;

/**
 * Reads the injected payload.
 *
 * Throws rather than rendering an empty shell: an un-substituted template is a generator
 * bug, and a dashboard that silently shows "0 findings" for it would be the most
 * misleading possible failure.
 *
 * Split out of `data.ts` for one reason: it is the only line in the display vocabulary that
 * needs a `document`, and keeping it here lets the rest of that vocabulary be checked by a test
 * that runs under node.
 *
 * ── ONE DEFENCE, AT THE BOUNDARY ─────────────────────────────────────────────────────────────
 *
 * `ruleConfig` and `ruleCatalog` are required by the contract and always written by this
 * package's generator, so the only file that can lack them is an OLDER report somebody kept.
 * That case used to be half-handled: `App.tsx` had a `??` for it while `Overview.tsx` read
 * `payload.ruleConfig.source` bare — and the bare read won, so an old report rendered a blank
 * page and a `TypeError` instead of degrading (V4 audit finding 4). The absence is filled ONCE,
 * here, where the untrusted JSON becomes a `Payload`; every consumer downstream reads the field
 * without a fallback, which is what makes "the field is always there" true rather than hoped.
 */
export const readPayload = (): Payload => {
  const element = document.getElementById("ds-data");

  if (!element?.textContent) {
    throw new Error("No analysis payload found. This file is the unsubstituted template.");
  }

  const parsed: unknown = JSON.parse(element.textContent);

  if (parsed === null || typeof parsed !== "object") {
    throw new Error("The analysis payload is empty. Regenerate the report.");
  }

  const raw = parsed as LegacyPayload;

  return {
    ...raw,
    // The identity config renders an old report exactly as it always rendered; an empty catalog
    // gives the rules panel nothing to list, which is the truth about a report that carries no
    // catalog.
    ruleConfig: raw.ruleConfig ?? DEFAULT_RULE_CONFIG,
    ruleCatalog: raw.ruleCatalog ?? [],
  };
};
