import { compareStrings } from "@smart-tools/fe-analyzer-engine";

import type { KitA11yArtifact, KitPattern } from "../domain/artifacts.ts";

/**
 * Query facade over the embedded `kit-a11y` artifact. Ported from
 * `hackathon2026/ds-analyzer/src/kit/a11y-spec.ts:1-129`, minus `load`/`unavailable` — the
 * artifact is in the bundle, so "not built" is not a state this package can be in.
 *
 * {@link available} is kept and still means something: the artifact records whether the
 * upstream library was installed when it was extracted (`meta.upstreamAvailable`). When it was
 * not, every collection here is empty, and a rule that read that as "nothing to report" would
 * print a clean bill of health for code nobody looked at.
 */
export class A11ySpec {
  private readonly byComponent: ReadonlyMap<string, KitPattern>;
  private readonly byRole: ReadonlyMap<string, KitPattern[]>;
  private readonly artifact: KitA11yArtifact;

  constructor(artifact: KitA11yArtifact) {
    this.artifact = artifact;
    this.byComponent = new Map(artifact.patterns.map((pattern) => [pattern.component, pattern]));

    const byRole = new Map<string, KitPattern[]>();
    for (const pattern of artifact.patterns) {
      for (const role of pattern.roles) {
        const bucket = byRole.get(role);
        if (bucket) {
          bucket.push(pattern);
        } else {
          byRole.set(role, [pattern]);
        }
      }
    }
    for (const bucket of byRole.values()) {
      bucket.sort((left, right) => compareStrings(left.component, right.component));
    }

    this.byRole = byRole;
  }

  get available(): boolean {
    return this.artifact.meta.upstreamAvailable;
  }

  get upstreamVersion(): string {
    return this.artifact.meta.upstreamVersion;
  }

  get spacing(): KitA11yArtifact["spacing"] {
    return this.artifact.spacing;
  }

  pattern(component: string): KitPattern | null {
    return this.byComponent.get(component) ?? null;
  }

  /**
   * Kit components that render `role`, ranked by name for reproducibility.
   *
   * This is what turns "you hand-rolled a tablist" into "the kit's Tabs renders that role and
   * handles four arrow keys, and yours handles none" — a statement backed by the upstream's own
   * code rather than by a specification the reader has to go and trust.
   */
  componentsRendering(role: string): readonly KitPattern[] {
    return this.byRole.get(role) ?? [];
  }

  /**
   * The component to actually offer for a role.
   *
   * Shortest name first, then alphabetical. Several components legitimately render the same
   * role, and picking alphabetically hands the reader the specialised one. A qualifier in the
   * name is exactly what marks a component as the narrower case, so the unqualified name is the
   * canonical answer.
   *
   * Lives here rather than in the rules so that two rules answering the same question cannot
   * answer it differently.
   */
  canonicalComponentFor(role: string): KitPattern | null {
    return (
      [...this.componentsRendering(role)].sort(
        (left, right) =>
          left.component.length - right.component.length ||
          compareStrings(left.component, right.component),
      )[0] ?? null
    );
  }

  /** `true` when `px` sits on the grid the upstream's own spacing follows. */
  isOnSpacingGrid(px: number): boolean {
    return px % this.artifact.spacing.gridBase === 0;
  }

  /** Steps the upstream actually uses, ascending; empty when the upstream was not read. */
  spacingSteps(): readonly number[] {
    return this.artifact.spacing.steps.map((step) => step.px);
  }
}
