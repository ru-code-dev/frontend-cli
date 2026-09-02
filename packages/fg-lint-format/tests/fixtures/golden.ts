import { readFileSync } from "node:fs";

/**
 * Read one golden document.
 *
 * The goldens are FILES, not inline string literals, for two reasons a formatter suite feels
 * immediately: a reviewer can open `stylish.ru.txt` and see the terminal output as a terminal
 * would show it (column alignment is the thing being asserted, and it is unreadable escaped
 * into a template literal), and a diff on a regression points at the changed line rather than
 * at a 900-character string.
 *
 * Every one of them is `.txt`, including the two that hold JSON. `.oxfmtrc.json` puts `oxfmt`
 * over the repo's `.json` files, and a formatter that re-indented `sarif.json` would silently
 * rewrite the very bytes this suite exists to pin.
 */
export function golden(name: string): string {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8");
}
