/**
 * `isGitUrl` — the predicate a caller can ask BEFORE it has a directory.
 *
 * It is exported (and therefore tested) because the feature package needs the same question
 * answered to decide whether to tell the user «cloning…», and a second copy of this rule over
 * there is exactly the drift `fe-source` exists to prevent. The suite is a table: what routes
 * to `git clone`, what does not, and the two forms that route only when nothing is on disk —
 * the filesystem half of that is proven in `local.test.ts` and `clone.test.ts`, because it is
 * `resolveSource`'s decision, not this predicate's.
 */
import { describe, expect, it } from "vite-plus/test";

import { isGitUrl } from "../src/index.ts";

const GIT_URLS = [
  "https://github.com/org/repo",
  "https://github.com/org/repo.git",
  "http://internal.example/org/repo",
  "file:///tmp/origin.git",
  "ssh://git@example.com/org/repo",
  "git://example.com/org/repo",
  "git@github.com:org/repo.git",
  "git@github.com:org/repo",
  "/an/absolute/path/repo.git",
  "./relative/repo.git",
] as const;

const NOT_GIT_URLS = [
  "",
  ".",
  "..",
  "/home/user/projects/app",
  "./src",
  "../sibling-project",
  "app",
  // A `.git` INSIDE the path is not a `.git` suffix — the rule is on the ending, so a checkout
  // referred to through its metadata directory is not mistaken for a remote.
  "/home/user/app/.git/config",
  "https-not-a-scheme/repo",
] as const;

describe("isGitUrl", () => {
  it.each(GIT_URLS)("routes %s to git", (input) => {
    expect(isGitUrl(input)).toBe(true);
  });

  it.each(NOT_GIT_URLS)("leaves %s to the filesystem", (input) => {
    expect(isGitUrl(input)).toBe(false);
  });
});
