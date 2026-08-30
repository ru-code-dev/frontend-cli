/**
 * The built dashboard, as one self-contained HTML string.
 *
 * The value below is a placeholder in the SOURCE tree. `pnpm build` runs
 * `scripts/embed-template.mjs` after `tsdown`, which rewrites that one string literal in
 * `dist/index.mjs` into the real `dashboard/dist/index.html`. Keeping the megabyte out of
 * the source tree is deliberate: nothing generated is committed, `tsgo` and the editor stay
 * fast, and the module still resolves before the first build (which is why the placeholder
 * is a plain string and not a thrown error).
 *
 * A build that never ran is not silent: `renderReport` rejects any template without the
 * `ds-data` slot, exactly as the source renderer does
 * (`hackathon2026/ds-analyzer/src/report/render.ts:144-146`).
 */
export const REPORT_TEMPLATE: string = "__FE_ANALYZER_REPORT_TEMPLATE__";
