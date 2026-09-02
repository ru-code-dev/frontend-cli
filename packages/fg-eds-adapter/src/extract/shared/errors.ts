/** Raised when an extractor cannot produce a trustworthy artifact and must not guess. */
export class ExtractionError extends Error {
  override readonly name = "ExtractionError";
}

/** Raised when a produced artifact fails its own schema. Indicates an extractor bug. */
export class ArtifactValidationError extends Error {
  override readonly name = "ArtifactValidationError";
  readonly issues: readonly string[];

  // Assignment rather than a constructor parameter property: `erasableSyntaxOnly`
  // (`tsconfig.base.json`) forbids the shorthand, which emits code instead of erasing.
  constructor(message: string, issues: readonly string[]) {
    super(`${message}\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.issues = issues;
  }
}
