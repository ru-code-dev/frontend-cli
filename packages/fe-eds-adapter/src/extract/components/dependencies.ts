import type { SourceFile } from "ts-morph";

import { toPackageName } from "./resolve.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * External package dependencies of a set of source files.
 *
 * This is the wrapper relation, and it is one of the highest-value facts in the whole
 * artifact: the kit's `Button` wraps `@v-uik/base`'s button, so a consumer importing
 * `@v-uik/button` directly has bypassed the design system — a violation that is
 * invisible unless you know which upstream package each kit component fronts.
 */

const V_UIK_SCOPE = "@v-uik/";

/** Bare specifiers imported or re-exported across `files`, deduplicated and sorted. */
export const collectExternalDependencies = (files: readonly SourceFile[]): string[] => {
  const packages = new Set<string>();

  const record = (specifier: string): void => {
    if (specifier.startsWith(".") || specifier.startsWith("@src/")) {
      return;
    }
    packages.add(toPackageName(specifier));
  };

  for (const file of files) {
    for (const declaration of file.getImportDeclarations()) {
      record(declaration.getModuleSpecifierValue());
    }
    for (const declaration of file.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier !== undefined) {
        record(specifier);
      }
    }
  }

  return [...packages].sort(compareStrings);
};

/** The `@v-uik` subset of `dependencies` — the upstream a kit component fronts. */
export const filterWrappedPackages = (dependencies: readonly string[]): string[] =>
  dependencies.filter((dependency) => dependency.startsWith(V_UIK_SCOPE));
