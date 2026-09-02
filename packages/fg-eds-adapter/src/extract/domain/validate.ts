import type { z } from "zod";

import { ArtifactValidationError } from "../shared/errors.ts";

/** Maximum number of schema issues surfaced in an error message. */
const MAX_REPORTED_ISSUES = 25;

/**
 * Parses `value` against `schema`, converting a failure into an
 * {@link ArtifactValidationError} with readable, path-qualified issues.
 *
 * Extractors call this on their own output: an artifact that does not satisfy its
 * contract is an extractor bug and must never reach disk.
 */
export const validateArtifact = <TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> => {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });

  const reported =
    issues.length > MAX_REPORTED_ISSUES
      ? [
          ...issues.slice(0, MAX_REPORTED_ISSUES),
          `… and ${issues.length - MAX_REPORTED_ISSUES} more`,
        ]
      : issues;

  throw new ArtifactValidationError(
    `${label} failed schema validation (${issues.length} issue(s))`,
    reported,
  );
};
