import { readFileSync } from "node:fs";

import type { JsxElement, Observations } from "../domain/observations.ts";
import type { ProjectProfile } from "../domain/profile.ts";
import { fromProjectPath } from "../shared/path.ts";
import type { RuleContext } from "./types.ts";

/**
 * Assembling everything the rules are allowed to know. Ported from
 * `hackathon2026/ds-analyzer/src/rules/context.ts:1-213`, keeping `readSources` and the
 * element grouping and dropping the three members whose consumers are not ported: the
 * spacing frequency index (source lines 36-103, read only by `token.literal.dimension`), the
 * cached SVG reader (146-175, read only by `icon.foreign-file`), and the four kit specs
 * (202-206).
 *
 * **Sources.** Findings carry a code snippet, and a snippet needs the file. Reading each file
 * once here keeps the rules pure: they receive lines, they do not open anything.
 */

export const readSources = (root: string, files: readonly string[]): Map<string, string[]> => {
  const sources = new Map<string, string[]>();

  for (const file of files) {
    try {
      const lines = readFileSync(fromProjectPath(root, file), "utf8").split(/\r?\n/);
      // A newline-terminated file splits into a phantom empty final element that no editor or
      // `git` counts as a line. Keeping it lets a snippet window near EOF claim one line more
      // than the file has — and a unified diff built from that window is rejected by
      // `git apply` with «patch does not apply».
      if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      sources.set(file, lines);
    } catch {
      // A file that vanished between scanning and analysis costs a snippet, not the run.
    }
  }

  return sources;
};

const groupElementsByFile = (elements: readonly JsxElement[]): Map<string, JsxElement[]> => {
  const byFile = new Map<string, JsxElement[]>();

  for (const element of elements) {
    const bucket = byFile.get(element.file);
    if (bucket) {
      bucket.push(element);
    } else {
      byFile.set(element.file, [element]);
    }
  }

  return byFile;
};

export const buildRuleContext = (input: {
  readonly profile: ProjectProfile;
  readonly observations: Observations;
}): RuleContext => ({
  profile: input.profile,
  observations: input.observations,
  sources: readSources(input.profile.root, input.observations.files),
  elementsByFile: groupElementsByFile(input.observations.jsxElements),
});
