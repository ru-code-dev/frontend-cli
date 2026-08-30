/**
 * «This call rejected, and here is the error» as ONE helper.
 *
 * `expect(...).rejects.toThrow(...)` matches on the MESSAGE, and the messages here are
 * deliberately developer-facing and unstable (`src/errors.ts` header) — asserting on them would
 * pin the wrong thing. Every failure assertion in this package therefore goes through this
 * function and then asserts on `code`, which IS the contract feature packages will switch on.
 *
 * A call that RESOLVES fails loudly rather than silently passing an inverted test, and a
 * non-`SourceError` rejection is re-thrown untouched — `resolveSource` promising that nothing
 * else escapes it is itself one of the things under test.
 */
import { isSourceError, type SourceError } from "../../src/index.ts";

export async function rejection(call: Promise<unknown>): Promise<SourceError> {
  try {
    await call;
  } catch (err) {
    if (isSourceError(err)) return err;
    throw err;
  }
  throw new Error("expected the call to reject with a SourceError; it resolved instead");
}
