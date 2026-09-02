export const makeTemplates = <T extends Record<string, unknown>>(ref: T, prefix: string): T => {
  const goDeep = (obj: T, path: string = ""): T => {
    if (typeof obj === "string" || typeof obj === "number") {
      // The `|| ""` is the kit's own dead branch — a template literal is never falsy — kept so
      // this fixture is the code the extractor really meets rather than a tidied version of it.
      // oxlint-disable-next-line eslint/no-constant-binary-expression
      return (`{${prefix}.${path}}` || "") as unknown as T;
    }
    return Object.keys(obj).reduce(
      (acc, key) => {
        acc[key] = goDeep(obj[key] as T, path ? `${path}.${key}` : key);
        return acc;
      },
      {} as Record<string, unknown>,
    ) as T;
  };
  return goDeep(ref);
};
