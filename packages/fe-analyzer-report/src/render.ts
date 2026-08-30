import type { ReportPayload } from "./contract.ts";
import { REPORT_TEMPLATE } from "./template.ts";

/**
 * Stage D of the ported pipeline: analysis JSON → one self-contained HTML file.
 *
 * The mechanism is the source's, transcribed rather than reinvented
 * (`hackathon2026/ds-analyzer/src/report/render.ts:24-40,133-176`): the dashboard is a
 * PRE-BUILT artifact and rendering a report substitutes a JSON payload into its
 * `<script type="application/json" id="ds-data">` slot. No bundler, no network, no
 * `node_modules` on the machine that opens the file.
 *
 * Two deliberate differences from the source renderer, both consequences of what this port
 * does not carry:
 *
 *  - no `templatePath`/filesystem read. The template is embedded in this bundle
 *    (`template.ts`) because the CLI ships as one file; the seam survives as the optional
 *    `template` argument, which is what the tests substitute into.
 *  - no `<style id="ds-syntax">` injection. That line carries Shiki's stylesheet
 *    (`.../render.ts:175`); Shiki is not a dependency of this port (h3 §2), so snippets are
 *    emitted as plain text inside the `.shiki` element the dashboard already styles — see
 *    `payloadOf`.
 */

/** `hackathon2026/ds-analyzer/src/report/render.ts:24`, verbatim. */
const PLACEHOLDER = /(<script type="application\/json" id="ds-data">)[\s\S]*?(<\/script>)/;

/**
 * Escapes the payload for embedding in a `<script>` element.
 *
 * A `</script>` sequence anywhere inside the JSON — in a code snippet, say — would close the
 * element early and produce a file that renders as garbage. Escaping the `<` is the standard
 * remedy and survives `JSON.parse` untouched. U+2028/U+2029 are escaped for the same reason
 * the source does it (`.../render.ts:33-40`): they are line terminators to a JS parser.
 */
const embed = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** Raised when the template argument is not a substitutable dashboard build. */
export class ReportTemplateError extends Error {
  override readonly name = "ReportTemplateError";
}

/**
 * Produces the finished HTML document: one file, openable by double-clicking.
 *
 * @param payload what the dashboard reads out of the `ds-data` slot — see `payloadOf`.
 * @param template defaults to the dashboard build embedded in this package.
 */
export function renderReport(payload: ReportPayload, template: string = REPORT_TEMPLATE): string {
  if (!PLACEHOLDER.test(template)) {
    throw new ReportTemplateError(
      "The report template has no ds-data slot. Build the package first: pnpm --filter @smart-tools/fe-analyzer-report build",
    );
  }

  // Function form only: string replacements interpret `$`-sequences, and the payload
  // contains arbitrary project code — a snippet with `$'` splices the rest of the page into
  // the JSON and kills the whole dashboard (`.../render.ts:170-174`).
  return template.replace(
    PLACEHOLDER,
    (_match, open: string, close: string) => `${open}${embed(payload)}${close}`,
  );
}
