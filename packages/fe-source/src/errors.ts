/**
 * THE FOUR WAYS ACQUIRING A SOURCE TREE CAN FAIL — and nothing else.
 *
 * WHY A CLASS AND NOT A DISCRIMINATED UNION OF RESULT VALUES. Brief B1 deliverable 2 offers
 * both and says «pick the simpler». The simpler one is decided by deliverable 1's signature,
 * not by taste: `resolveSource` returns `Promise<ResolvedSource>`, so a failure has exactly one
 * channel — rejection — and a rejection value has to be throwable. A union of plain objects
 * would force every caller to `throw` a non-Error (which loses the stack) or force this package
 * to return `Result<ResolvedSource, SourceError>` and contradict the fixed signature. So: ONE
 * `Error` subclass carrying a `code` field, which is itself a discriminated union — callers get
 * exhaustive `switch (err.code)` narrowing AND a real stack trace.
 *
 * NO USER-FACING STRINGS LIVE HERE (brief B1 deliverable 2). This is an internal core package;
 * the feature package (`fe-project-report`) owns ru+en wording and maps `code` to it via
 * `pick()` from the frozen contract (`packages/cli-kit/src/index.ts:31-33`). The `message` this
 * class builds is DEVELOPER-facing — `"<code>: <input>"` — so an unhandled rejection in a test
 * or a stack trace still says which case fired, without that sentence ever being fit to print
 * to a user.
 *
 * AND RAW GIT STDERR IS NEVER THE PRIMARY ERROR PATH (same deliverable). `git`'s own words are
 * English, unlocalized, and shaped for a terminal, so they are parked on the separate
 * {@link SourceError.gitStderr} field: available for a `--verbose` lane or a bug report, never
 * the thing a caller has to render. The originating error is preserved on `cause` for the same
 * reason — kept, not surfaced.
 */

/**
 * Which failure happened. The four codes are exactly brief B1 deliverable 2's list; this union
 * is the discriminant callers narrow on.
 *
 * - `path-not-found`   — the input is neither a URL nor anything that exists on disk.
 * - `not-a-directory`  — the input exists, but it is a file (or a socket, or a device).
 * - `git-not-installed`— a clone was required and `git` could not be spawned at all.
 * - `clone-failed`     — `git` ran and refused; its trimmed stderr rides on `gitStderr`.
 */
export type SourceErrorCode =
  | "path-not-found"
  | "not-a-directory"
  | "git-not-installed"
  | "clone-failed";

/** What {@link SourceError} is built from. An options object rather than four positionals so a
 *  call site cannot silently swap `input` and `gitStderr`. */
export interface SourceErrorInit {
  readonly code: SourceErrorCode;
  /** The argument the caller passed to `resolveSource`, verbatim — a path or a URL. */
  readonly input: string;
  /** Trimmed `git` stderr. Set for `clone-failed` and nothing else. */
  readonly gitStderr?: string | undefined;
  /** The underlying `ENOENT`/exit-code error, kept so nothing is lost. */
  readonly cause?: unknown;
}

/**
 * The single error type this package throws. Nothing else escapes `resolveSource`.
 *
 * Narrowing is by `code`:
 *
 * ```ts
 * catch (err) {
 *   if (!isSourceError(err)) throw err;
 *   switch (err.code) { case "clone-failed": … }
 * }
 * ```
 */
export class SourceError extends Error {
  override readonly name = "SourceError";
  /** The discriminant. */
  readonly code: SourceErrorCode;
  /** The `resolveSource` argument that produced this failure. */
  readonly input: string;
  /** Trimmed `git` stderr when `code === "clone-failed"`, `undefined` otherwise. Diagnostic
   *  only — see the file header on why this is never the primary error path. */
  readonly gitStderr: string | undefined;

  constructor(init: SourceErrorInit) {
    // `cause` is spread CONDITIONALLY: under `exactOptionalPropertyTypes`
    // (`tsconfig.base.json:28`) an explicit `undefined` is not assignable to
    // `ErrorOptions.cause?`, and passing the key at all would put a `cause: undefined` own
    // property on the error where callers expect the key to be absent.
    super(`${init.code}: ${init.input}`, init.cause === undefined ? {} : { cause: init.cause });
    this.code = init.code;
    this.input = init.input;
    this.gitStderr = init.gitStderr;
  }
}

/** Type guard for `catch (err: unknown)`. `instanceof` is sound here because this package is a
 *  single ESM module instance — nothing re-declares the class. */
export function isSourceError(value: unknown): value is SourceError {
  return value instanceof SourceError;
}
