/**
 * A MINIMAL, WIRE-SHAPED DSL envelope — derived from the engine's own fixture builder
 * (`ru-code-packages/packages/pixso-core/dev/fixtures/fakeDsl.ts:1-56`), trimmed to the one
 * shape these suites need.
 *
 * Derived rather than imported: `dev/` is outside `pixso-core`'s `"files": ["dist"]`
 * (`ru-code-packages/packages/pixso-core/package.json:6-8`), so it does not exist in the
 * installed package — importing it would work only while the cross-repo symlink is up, which is
 * exactly the fragility the registry-fallback route exists to avoid. The brief authorises the
 * copy (brief 3.2 line 47) and this is the whole of it.
 *
 * The guid matters. `ROOT_GUID` is what both routes request — the LOCAL route passes it as
 * `itemId`, and the REMOTE route's `item-id` query parameter in `DESIGN_URL` decodes to the
 * same value — so the ladder finds the root it was asked for. A mismatch is `requested-root-
 * absent`, one of the engine's refusal kinds
 * (`ru-code-packages/packages/pixso-core/src/pipeline/scanFromRaw.ts:84-99`), and it would fail
 * these tests for a reason that has nothing to do with the commands.
 */

/** The frame guid the fixture's root carries, and the id both routes ask for. */
export const ROOT_GUID = "11:10";

/** A Pixso design link whose `item-id` decodes to {@link ROOT_GUID}. Shaped so
 *  `parseDesignUrl` returns `kind: "ok"` — the file key must be 8+ chars of `[A-Za-z0-9_-]`
 *  and must not be a routing word
 *  (`ru-code-packages/packages/pixso-core/src/io/designUrl.ts:19-22, 37-45`). */
export const DESIGN_URL = "https://pixso.test/app/design/AbCdEfGh1234?item-id=11%3A10";

interface FakeNodeOptions {
  readonly guid: string;
  readonly name: string;
  readonly type?: string;
  readonly parentGuid?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

const node = (options: FakeNodeOptions): Record<string, unknown> => ({
  guid: options.guid,
  name: options.name,
  type: options.type ?? "FRAME",
  visible: true,
  angle: 0,
  opacity: 1,
  width: 255,
  height: 160,
  top: 100,
  left: 40,
  ...(options.parentGuid !== undefined
    ? { parentGuid: options.parentGuid, parentGuids: ["0:1", options.parentGuid] }
    : { parentGuids: ["0:1"] }),
  ...options.extra,
});

const envelope = (pixDslNodes: ReadonlyArray<Record<string, unknown>>): string =>
  JSON.stringify({
    dslVersion: "2.1.15",
    converterVersion: "2.2.13",
    variableMap: {},
    sourceMapByUrl: {},
    pixComponentNodes: [],
    pixDslNodes,
  });

/** One clean FRAME with a text child — parses with zero warnings. */
export const CLEAN_DSL = envelope([
  node({ guid: ROOT_GUID, name: "Card" }),
  node({
    guid: "11:11",
    name: "Title",
    type: "TEXT",
    parentGuid: ROOT_GUID,
    extra: {
      nodeText: "Заголовок",
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 14,
      fillPaints: [
        { type: "SOLID", color: { r: 25, g: 25, b: 25, a: 1 }, opacity: 1, visible: true },
      ],
    },
  }),
]);

/** A syntactically valid envelope with NO nodes — the engine refuses it, which is how these
 *  suites reach the "the scan itself failed" branch without inventing a transport error. */
export const EMPTY_SELECTION_DSL = envelope([]);
