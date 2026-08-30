/**
 * THE OWNER'S EDIT POINT.
 *
 * Three values, three names, fixed by the owner in the design's amendment 1
 * (`WORKFLOW/features/initial-analysis/plans/2.1-design.md:105-111`): zero renames, and the
 * SAME three spellings are the recognized `.env` / environment keys. Changing where this CLI
 * talks means editing this file (or setting the matching env key) — nothing else in the tree
 * carries an endpoint literal.
 *
 * The two URL defaults are the VALUES of `pixso-core`'s own internal constants, copied here
 * rather than imported: core declares them "never configurable, no env override" and does not
 * export them from its exports map, so the CLI restates them at the one place the owner edits.
 *
 *   `PIXSO_REMOTE_MCP_URL` <- `PIXSO_REMOTE_MCP_ENDPOINT`
 *     `ru-code-packages/packages/pixso-core/src/io/constants.ts:23`
 *   `PIXSO_LOCAL_MCP_URL`  <- `PIXSO_MCP_ENDPOINT`
 *     `ru-code-packages/packages/pixso-core/src/io/constants.ts:10`
 *
 * Note what core's own comments say about the remote value: it is an IN-GIT PLACEHOLDER
 * pointing at the merged local fake listener (port 3667, route `/remote-mcp`), never the real
 * company URL, which is "injected at RELEASE by editing this constant OUTSIDE git"
 * (`constants.ts:16-22`). The same is true of the copy below — it is a placeholder, and a real
 * deployment supplies the true endpoint through `--endpoint`, the `PIXSO_REMOTE_MCP_URL` env
 * key, or an edit here.
 */

/** Remote (design-link) MCP endpoint. Default = pixso-core `PIXSO_REMOTE_MCP_ENDPOINT`. */
export const PIXSO_REMOTE_MCP_URL = "http://127.0.0.1:3667/remote-mcp";

/** Local (guid / item-id) MCP endpoint. Default = pixso-core `PIXSO_MCP_ENDPOINT`. */
export const PIXSO_LOCAL_MCP_URL = "http://127.0.0.1:3667/local-mcp";

/**
 * Token for the REMOTE route. Default EMPTY on purpose — a secret has no business being a
 * literal in a published bundle. The remote route reports a localized, actionable error when
 * it resolves empty (design 2.1:117-118); the local route never needs it.
 */
export const PIXSO_REMOTE_MCP_TOKEN = "";
