import { compareStrings } from "@smart-tools/fe-analyzer-engine";

import type { KitIconsArtifact } from "../domain/artifacts.ts";

/** What a fingerprint resolves to: the kit icon to use, plus its geometric twins if any. */
export interface IconMatch {
  readonly name: string;
  readonly size: number;
  readonly viewBox: string | null;
  /** Other kit icons with identical geometry — the kit has a few genuine duplicates. */
  readonly alternatives: readonly string[];
}

/**
 * Query facade over the embedded `kit-icons` artifact. Ported from
 * `hackathon2026/ds-analyzer/src/kit/icon-spec.ts:1-109`, minus `load`/`unavailable`.
 *
 * Matching is exact-on-normalized-geometry only. "Visually similar but redrawn" cannot be
 * decided statically with any honesty.
 */
export class IconSpec {
  private readonly byFingerprint: ReadonlyMap<string, IconMatch>;
  private readonly previews: ReadonlyMap<
    string,
    { viewBox: string | null; shapes: readonly string[] }
  >;
  private readonly artifact: KitIconsArtifact;

  constructor(artifact: KitIconsArtifact) {
    this.artifact = artifact;

    const grouped = new Map<string, { name: string; size: number; viewBox: string | null }[]>();
    const previews = new Map<string, { viewBox: string | null; shapes: readonly string[] }>();

    for (const icon of artifact.icons) {
      for (const variant of icon.variants) {
        const bucket = grouped.get(variant.fingerprint) ?? [];
        bucket.push({ name: icon.name, size: variant.size, viewBox: variant.viewBox });
        grouped.set(variant.fingerprint, bucket);

        // Smallest size wins as the preview; the geometry is the same by construction.
        if (!previews.has(icon.name)) {
          previews.set(icon.name, { viewBox: variant.viewBox, shapes: variant.paths });
        }
      }
    }

    const byFingerprint = new Map<string, IconMatch>();
    for (const [fingerprint, entries] of grouped.entries()) {
      const names = [...new Set(entries.map((entry) => entry.name))].sort(compareStrings);
      const primary = entries
        .filter((entry) => entry.name === names[0])
        .sort((left, right) => left.size - right.size)[0];
      if (primary === undefined) {
        continue;
      }
      byFingerprint.set(fingerprint, {
        name: primary.name,
        size: primary.size,
        viewBox: primary.viewBox,
        alternatives: names.slice(1),
      });
    }

    this.byFingerprint = byFingerprint;
    this.previews = previews;
  }

  get available(): boolean {
    return this.artifact.icons.length > 0;
  }

  get iconCount(): number {
    return this.artifact.meta.counts.icons;
  }

  /** Exact geometry lookup; `null` means "the kit has no icon drawing these shapes". */
  match(fingerprint: string): IconMatch | null {
    return this.byFingerprint.get(fingerprint) ?? null;
  }

  /** Drawing data for rendering a kit icon in a report. */
  preview(name: string): { viewBox: string | null; shapes: readonly string[] } | null {
    return this.previews.get(name) ?? null;
  }
}
