/**
 * THE REPO'S FORBIDDEN-STRING GUARD SET — one source of truth.
 *
 * The hackathon's leaked secret (an internal Jenkins `generic-webhook-trigger` URL WITH its auth
 * token in the query string) must never live in this repo, nor in anything `fg` ships. Two
 * consumers read this list:
 *
 *  - `packVendor` (`./pack.ts`) runs it over EVERY file of `vendor/ru-code/` and FAILS THE BUILD
 *    on a hit — the payload is embedded brotli+base64, so no grep of `dist/fg.mjs` could ever see
 *    it, and the owner swaps `vendor/` without touching code;
 *  - `packages/fg-analyzer-report/tests/forbidden-strings.test.ts` scans that package's sources
 *    and build artifacts with the same list.
 *
 * The token itself is deliberately NOT written here: the shape is the assertion (a
 * `token=<16+ opaque characters>` query parameter has no legitimate reason to appear in a static
 * file). BUILD-TIME ONLY: this module is imported by `./pack.ts` and by tests, never by the
 * runtime, so these strings never reach `fg.mjs`.
 */

/** Literal strings that may not appear anywhere in the repo's scanned files or in the vendor tree. */
export const FORBIDDEN_LITERALS: readonly string[] = [
  "sbt-jenkins",
  "sigma.sbrf.ru",
  "generic-webhook-trigger",
  "@v-uik",
  "@sds-eng",
  // Not in the analyzer-report guard before the lists were unified: the internal host family the
  // leaked webhook lives under (`packages/fg-analyzer-engine/tests/forbidden-content.test.ts`
  // forbids it too). Carried over from `fg install`'s own integration check.
  "sberworks",
];

/** Any embedded credential in a URL, whatever its value; and the design-system internal marker. */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [/[?&]token=[A-Za-z0-9_-]{16,}/, /_DNU_ST_/];

/** One hit: the file and the literal or pattern that matched. */
export interface ForbiddenHit {
  readonly file: string;
  readonly needle: string;
}

/** Every literal / pattern of the guard set that `text` contains, as printable strings. */
export function forbiddenIn(text: string): string[] {
  return [
    ...FORBIDDEN_LITERALS.filter((literal) => text.includes(literal)).map(
      (literal) => `«${literal}»`,
    ),
    ...FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(text)).map(String),
  ];
}
