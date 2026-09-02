import type {
  BarrelEntryDto,
  ExternalReExportDto,
  PublicSymbolDto,
  UiKitComponentDto,
} from "../domain/components.ts";
import type { DiagnosticDto } from "../domain/tokens.ts";

/**
 * Findings about the component layer, including the *limits* of this extraction.
 *
 * Reporting the limits is as important as reporting the data: a consumer that treats
 * `publicSymbols` as exhaustive would wrongly flag every symbol re-exported from an
 * unresolvable `@v-uik` package as "not part of the kit".
 */

const MAX_SAMPLES = 15;

const diagnostic = (
  code: string,
  severity: DiagnosticDto["severity"],
  message: string,
  samples: readonly string[],
): DiagnosticDto => ({
  code,
  severity,
  message,
  samples: [...samples].slice(0, MAX_SAMPLES),
  count: samples.length,
});

export interface ComponentDiagnosticsInput {
  readonly components: readonly UiKitComponentDto[];
  readonly publicSymbols: readonly PublicSymbolDto[];
  readonly externalReExports: readonly ExternalReExportDto[];
  readonly barrel: readonly BarrelEntryDto[];
}

export const buildComponentDiagnostics = (input: ComponentDiagnosticsInput): DiagnosticDto[] => {
  const diagnostics: DiagnosticDto[] = [];

  if (input.externalReExports.length > 0) {
    diagnostics.push(
      diagnostic(
        "external-reexport-unresolved",
        "warning",
        "Packages the kit re-exports wholesale but whose export lists could not be enumerated, because the " +
          "kit's node_modules are not installed. Symbols from these packages are part of the kit's public API " +
          "yet are absent from `publicSymbols`. Install dependencies and re-run to close this gap.",
        input.externalReExports.map((entry) => entry.package),
      ),
    );
  }

  const withoutEntry = input.components.filter((component) => component.entryFile === null);
  if (withoutEntry.length > 0) {
    diagnostics.push(
      diagnostic(
        "component-entry-missing",
        "info",
        "Component directories with no `index.ts`/`index.tsx`. They are not reachable through the barrel and " +
          "are therefore internal, not public API.",
        withoutEntry.map((component) => component.name),
      ),
    );
  }

  const privateDirectories = input.components.filter((component) => !component.public);
  if (privateDirectories.length > 0) {
    diagnostics.push(
      diagnostic(
        "component-not-in-barrel",
        "info",
        "Component directories that exist on disk but are not star-re-exported from `components/index.ts`. " +
          "Some are exported under a different path; others are genuinely internal.",
        privateDirectories.map((component) => component.name),
      ),
    );
  }

  const withoutProps = input.components.filter(
    (component) =>
      component.public && component.props.length === 0 && component.components.length > 0,
  );
  if (withoutProps.length > 0) {
    diagnostics.push(
      diagnostic(
        "props-type-not-found",
        "warning",
        "Public components for which no `*Props` type was found in their directory. Their prop contract lives " +
          "in `@v-uik` and cannot be read without installed dependencies, so prop-level validation is " +
          "unavailable for these components.",
        withoutProps.map((component) => component.name),
      ),
    );
  }

  const passthroughOnly = input.components.filter(
    (component) =>
      component.public && component.components.length === 0 && component.wraps.length > 0,
  );
  if (passthroughOnly.length > 0) {
    diagnostics.push(
      diagnostic(
        "component-passthrough",
        "info",
        "Public directories that declare no component of their own and only re-export a `@v-uik` package. " +
          "For these the kit is a namespace, not a wrapper.",
        passthroughOnly.map((component) => `${component.name} -> ${component.wraps.join(", ")}`),
      ),
    );
  }

  const deprecated = input.publicSymbols.filter((symbol) => symbol.deprecated);
  if (deprecated.length > 0) {
    diagnostics.push(
      diagnostic(
        "public-symbol-deprecated",
        "info",
        "Public symbols carrying a `@deprecated` JSDoc tag. Usage of these in consumer code is a migration " +
          "finding in its own right.",
        deprecated.map((symbol) => symbol.name),
      ),
    );
  }

  const unresolvedNamed = input.publicSymbols.filter((symbol) => symbol.kind === "unresolved");
  if (unresolvedNamed.length > 0) {
    diagnostics.push(
      diagnostic(
        "symbol-kind-unresolved",
        "info",
        "Public symbols whose kind (component / type / value) could not be determined because they are " +
          "re-exported from an unresolvable package.",
        unresolvedNamed.map((symbol) => symbol.name),
      ),
    );
  }

  const doNotUse = input.barrel.filter((entry) => entry.specifier.includes("_DNU_"));
  if (doNotUse.length > 0) {
    diagnostics.push(
      diagnostic(
        "do-not-use-exported",
        "warning",
        'The barrel re-exports a `_DNU_` ("do not use") module. Any consumer import of a symbol originating ' +
          "there is a violation by the kit's own naming.",
        doNotUse.map((entry) => entry.specifier),
      ),
    );
  }

  return diagnostics;
};
