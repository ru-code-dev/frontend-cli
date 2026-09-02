/**
 * JSON modules arrive as `unknown`.
 *
 * Deliberately not `resolveJsonModule`. The five artifacts under `src/artifacts/` total four
 * megabytes of minified JSON; letting the type checker infer a literal type for each of them
 * would cost minutes per `typecheck` run and produce a type nobody reads. The wrapper in
 * `artifacts/index.ts` asserts each one to the hand-written interface for its schema, once.
 */
declare module "*.json" {
  const value: unknown;
  export default value;
}
