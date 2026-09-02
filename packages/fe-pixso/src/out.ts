/**
 * WHERE THE BYTES GO — the one module that answers it for all four pixso commands.
 *
 * The owner's law is that `-o` is optional everywhere and that a run without it writes files
 * anyway, to a documented default, and reports them as absolute paths
 * (`WORKFLOW/features/eds-parser/briefs/e2b-output-normalization.md:19-32`). What that costs is
 * a naming decision: with no `-o` there is no filename, so one has to be DERIVED from the
 * design the user named. Deriving it in four places is four chances to derive it differently,
 * so it happens here and the commands only ask.
 *
 * ── THE DEFAULTS ────────────────────────────────────────────────────────────────────────────
 *
 *   `--psvg`    → `<cwd>/fe-out/pixso/<name>.svg`
 *   `--phtml`   → `<cwd>/fe-out/pixso/<name>.html`
 *   `--pprompt` → `<cwd>/fe-out/pixso/<name>.md`
 *   `--passets` → `<cwd>/fe-out/pixso/<name>/` + the four `card.*` files
 *
 * The three faces share a stem and differ only in extension, which is the point: running all
 * three on one design leaves three files that sort together and obviously belong to each other.
 * `--passets` takes a DIRECTORY of the same name instead, because it writes four files whose
 * names are already fixed ({@link ASSET_FILES}) and flattening them into the same directory as
 * the faces would collide `<name>.svg` with the set's `card.svg` at the first shared design.
 *
 * ── THE NAME ────────────────────────────────────────────────────────────────────────────────
 *
 * `<name>` is the DESIGN's identity, sanitized: the node guid for the local route (`11:10` →
 * `11-10`), and for a design link the `item-id` it carries — which is the same guid, written
 * the way the Pixso app writes it in a URL. That is why a link and a bare guid pointing at one
 * frame produce ONE filename rather than two: the name follows the design, not the spelling.
 *
 * The item-id is read with core's own `parseDesignUrl`
 * (`ru-code-packages/packages/pixso-core/src/io/designUrl.ts:24-48`) rather than a regex here.
 * It is the module that defines what an item-id IS in this product, and a second reading of a
 * URL is a second answer waiting to disagree with the first. Its `no-item-id` case falls back
 * to the file key, which is still the design's identity and still stable across runs; only a
 * link core cannot read at all falls through to {@link LINK_FALLBACK}.
 *
 * ── WHY `ASSET_FILES` LIVES HERE AND NOT IN `strings.ts` ────────────────────────────────────
 *
 * Because a filename is not a sentence. `card.svg` is never translated, it is half of a path,
 * and its extension is now also the extension a bare `--psvg` writes — so keeping it beside the
 * path builders is what makes `<name>.svg` and the set's `card.svg` provably the same suffix.
 * `strings.ts` imports it, for the help text; the arrow points that way and not back.
 */
import { join, resolve } from "node:path";

import type { CommandContext } from "@smart-tools/fe-cli-kit";
import { FE_OUT_DIR, safeSegment } from "@smart-tools/fe-cli-kit";
import { parseDesignUrl } from "@smart-tools/pixso-core";

/** The four filenames `--get-pixso-assets` writes. Named once; the command reads them from
 *  here and so does its test, so a rename cannot pass silently (design 2.1:99-102). */
export const ASSET_FILES = {
  svg: "card.svg",
  html: "card.html",
  prompt: "card.md",
  meta: "card.json",
} as const;

/** The subdirectory of `fe-out/` this package owns. Every pixso artifact lands under it, so a
 *  project report written by the other package cannot collide with a design named `report`. */
export const PIXSO_OUT_DIR = "pixso";

/** The default location, as one cwd-relative string — what the help page and the README print.
 *  Assembled from the two constants rather than typed, so the documentation and the writer can
 *  never name different directories. */
export const DEFAULT_DIR = `${FE_OUT_DIR}/${PIXSO_OUT_DIR}`;

/** The stem used when the source yields nothing nameable — an `http://` with no item-id and no
 *  recognizable file key, or a guid made entirely of punctuation. Never empty, because a
 *  command that could not name its file would have to refuse, and refusing is what this whole
 *  change removes. */
export const LINK_FALLBACK = "design";

/** Which face is being written, and therefore which extension the default path gets. */
export type FaceKind = "svg" | "html" | "prompt";

/** `card.svg` → `.svg`. A filename with no dot would be a bug in {@link ASSET_FILES} rather
 *  than an input, so it yields `""` rather than being defended against. */
function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot <= 0 ? "" : file.slice(dot);
}

/** The extension each face's default file carries, taken from the asset set's own filenames so
 *  the two cannot drift (`card.svg` → `.svg`). Exported because the help text prints them. */
export const FACE_EXTENSION: Readonly<Record<FaceKind, string>> = {
  svg: extensionOf(ASSET_FILES.svg),
  html: extensionOf(ASSET_FILES.html),
  prompt: extensionOf(ASSET_FILES.prompt),
};

/**
 * The design's identity as ONE safe path segment. Pure, total, and exported because it is what
 * the tests pin — the sanitization rule is documented in the README and users predict it.
 */
export function designName(source: string): string {
  return safeSegment(identityOf(source), LINK_FALLBACK);
}

/**
 * The four answers `parseDesignUrl` can give, mapped to the string worth naming a file after.
 * Total over its union, so a fifth variant added upstream is a compile error here rather than a
 * filename that silently became the whole URL.
 *
 *  - `ok`          → the item-id: the frame, which is what the user actually asked for.
 *  - `no-item-id`  → the file key: still the design, just less specific. Better than the URL,
 *                    which carries a scheme and a host that say nothing about the content.
 *  - `no-file-key` → nothing nameable. It IS an http(s) URL — that is the only way this variant
 *                    is reached — so the source is a link with no identity in it, and using the
 *                    link itself would produce `https-pixso.test` and call it a design.
 *  - `invalid` / `empty` → NOT a URL at all, which on this surface means the LOCAL route's node
 *                    guid (`packages/fe-pixso/src/routing.ts`'s `isDesignLink` draws the same
 *                    line). The source is exactly the right name; `11:10` becomes `11-10`.
 */
function identityOf(source: string): string {
  const parsed = parseDesignUrl(source);
  switch (parsed.kind) {
    case "ok":
      return parsed.itemId;
    case "no-item-id":
      return parsed.fileKey;
    case "no-file-key":
      return LINK_FALLBACK;
    case "invalid":
    case "empty":
      return source;
  }
}

/**
 * The file a single-face command writes: `-o` when the user gave one, the documented default
 * when they did not. Absolute in both cases — the card prints it, and a relative path in a card
 * is a path whose meaning depends on where the reader happens to be standing.
 */
export function faceTarget(ctx: CommandContext, source: string, face: FaceKind): string {
  if (ctx.out !== undefined && ctx.out !== "") return resolve(ctx.cwd, ctx.out);
  return resolve(
    ctx.cwd,
    FE_OUT_DIR,
    PIXSO_OUT_DIR,
    `${designName(source)}${FACE_EXTENSION[face]}`,
  );
}

/** The directory `--get-pixso-assets` writes its four files into. Same rule, one level up. */
export function assetsTarget(ctx: CommandContext, source: string): string {
  if (ctx.out !== undefined && ctx.out !== "") return resolve(ctx.cwd, ctx.out);
  return resolve(ctx.cwd, FE_OUT_DIR, PIXSO_OUT_DIR, designName(source));
}

/** One of the four files `--get-pixso-assets` writes, paired with the face that fills it. The
 *  command builds this list once and uses it for BOTH the write loop and the card's path list,
 *  so the paths reported are the paths written, in the order they were written. */
export const assetPathIn = (dir: string, file: string): string => join(dir, file);
