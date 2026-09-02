import { fileURLToPath } from "node:url";

import { extractKit } from "../src/extract.ts";
import type { ComponentEntry, KitExtract } from "../src/types.ts";

/** Absolute path of a fixture kit's packages directory. */
export function fixturePackagesDir(kit: string): string {
  return fileURLToPath(new URL(`./fixtures/${kit}/packages`, import.meta.url));
}

export function extractFixture(kit: string, exclude: readonly string[] = []): KitExtract {
  return extractKit({ packagesDir: fixturePackagesDir(kit), exclude });
}

export function component(extract: KitExtract, name: string): ComponentEntry {
  const entry = extract.components[name];
  if (entry === undefined) {
    throw new Error(
      `component "${name}" missing; got: ${Object.keys(extract.components).join(", ")}`,
    );
  }
  return entry;
}

/** The `ReactNode` spelling the fixture kit's own `react.d.ts` produces, spelled out once. */
export const REACT_NODE = "null | string | number | boolean | React.ReactElement";
