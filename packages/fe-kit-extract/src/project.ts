import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Project, ts } from "ts-morph";

import type { DiscoveredKit } from "./discover.ts";

/**
 * The compiler options used when the kit ships no `tsconfig.json`.
 *
 * They are deliberately permissive: this tool reads a kit it does not own, and a diagnostic the
 * kit's own build would raise is none of its business. `Bundler` resolution is what a modern
 * React kit is authored against (extensionless relative imports), `Preserve` keeps JSX in the
 * tree where the root-element resolver can see it, and `allowJs` means a kit with stray `.jsx`
 * files still enumerates.
 */
export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  allowJs: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
};

export const DEFAULT_COMPILER_OPTIONS_DOC =
  "target ESNext, module ESNext, moduleResolution Bundler, jsx Preserve, strict, " +
  "allowJs, allowImportingTsExtensions, allowSyntheticDefaultImports, esModuleInterop, " +
  "resolveJsonModule, skipLibCheck, noEmit";

export interface KitProject {
  project: Project;
  /** Absolute path of the tsconfig used, or `null` when `DEFAULT_COMPILER_OPTIONS` were used. */
  tsConfigPath: string | null;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function collectSourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot > 0 && SOURCE_EXTENSIONS.has(name.slice(dot))) out.push(full);
  }
}

/**
 * One ts-morph project per kit.
 *
 * The kit's own `tsconfig.json` wins when there is one (at the kit root, else at the packages
 * directory) because only it knows the kit's `paths` aliases. Its `include`/`files` are ignored
 * — the file set comes from walking the kit root — so a tsconfig that only covers one package
 * cannot hide the rest of the kit from the extractor.
 */
export function createKitProject(kit: DiscoveredKit): KitProject {
  const candidates = [join(kit.kitRoot, "tsconfig.json"), join(kit.packagesDir, "tsconfig.json")];
  const tsConfigPath = candidates.find((candidate) => existsSync(candidate)) ?? null;

  const project =
    tsConfigPath === null
      ? new Project({
          compilerOptions: DEFAULT_COMPILER_OPTIONS,
          skipAddingFilesFromTsConfig: true,
        })
      : new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true });

  const files: string[] = [];
  collectSourceFiles(kit.kitRoot, files);
  for (const file of files) project.addSourceFileAtPathIfExists(file);

  return { project, tsConfigPath };
}
