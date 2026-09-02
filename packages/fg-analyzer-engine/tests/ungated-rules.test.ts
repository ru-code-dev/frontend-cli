import { describe, expect, it } from "vite-plus/test";

import { analyzeFixture, countsByRule, findingsOf } from "./fixtures.ts";

/**
 * The two rules whose kit gate was removed in this port.
 *
 * Both fixtures are ordinary React projects with no design system anywhere in them, which is
 * the whole point: in the source repo each of these rules returned `[]` before looking at a
 * single line, because an artifact it never actually consulted was missing. These tests are
 * what "ungated" means operationally — findings on a project that has no kit at all.
 */

describe("component.duplicate — copy-pasted components, ungated", () => {
  it("clusters the pair and reports it once, anchored on one member", async () => {
    const result = await analyzeFixture("duplicates");
    const findings = findingsOf(result, "component.duplicate");

    expect(countsByRule(result)).toEqual({ "component.duplicate": 1 });
    expect(findings[0]?.category).toBe("component");
    expect(findings[0]?.severity).toBe("candidate");
    expect(findings[0]?.actual).toBe("TeamCard");
    expect(findings[0]?.file).toBe("src/TeamCard.tsx");
    // The other member of the cluster is named in the finding, with its coordinates.
    expect(findings[0]?.why).toContain("UserCard");
    expect(findings[0]?.note).toContain("src/UserCard.tsx");
  });

  it("runs only when the components domain is asked for", async () => {
    const a11yOnly = await analyzeFixture("duplicates", ["a11y"]);
    const components = await analyzeFixture("duplicates", ["components"]);

    expect(findingsOf(a11yOnly, "component.duplicate")).toHaveLength(0);
    expect(findingsOf(components, "component.duplicate")).toHaveLength(1);
  });
});

describe("icon.foreign-pack — third-party icon libraries, ungated", () => {
  it("reports one finding per foreign import and ignores the project's own icon", async () => {
    const result = await analyzeFixture("foreign-icons");
    const findings = findingsOf(result, "icon.foreign-pack");

    expect(countsByRule(result)).toEqual({ "icon.foreign-pack": 2 });
    expect(findings.map((finding) => finding.actual)).toEqual(["lucide-react", "react-icons/fi"]);
    expect(findings.map((finding) => finding.file)).toEqual(["src/Toolbar.tsx", "src/Toolbar.tsx"]);
    expect(findings[0]?.category).toBe("icon");
    expect(findings[0]?.severity).toBe("warning");
    // A deep import counts as the pack it reaches into.
    expect(findings[1]?.impactKey).toBe("icon.foreign-pack:react-icons");
  });

  it("runs only when the icons domain is asked for", async () => {
    const a11yOnly = await analyzeFixture("foreign-icons", ["a11y"]);
    const icons = await analyzeFixture("foreign-icons", ["icons"]);

    expect(findingsOf(a11yOnly, "icon.foreign-pack")).toHaveLength(0);
    expect(findingsOf(icons, "icon.foreign-pack")).toHaveLength(2);
  });
});
