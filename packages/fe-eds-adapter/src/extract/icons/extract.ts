import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { KitPaths } from "../paths.ts";
import {
  kitIconsArtifactSchema,
  type KitIcon,
  type KitIconsArtifact,
} from "../domain/kit-icons.ts";
import { ExtractionError } from "../shared/errors.ts";
import { compareStrings } from "@smart-tools/fe-analyzer-engine";
import { svgFingerprint } from "../../icons/fingerprint.ts";

/**
 * Reads the kit's icon set off its SVG sources.
 *
 * `ioNN-Name.svg` is the kit's own naming convention: `NN` the nominal size, `Name` the
 * generated component's name. Files outside that convention are counted as unreadable
 * rather than skipped in silence — a shrinking artifact must be visible in review.
 */

const ICON_FILE = /^io(\d+)-(.+)\.svg$/;

const ICONS_SUBPATH = ["icons", "svg"] as const;

/** `export { Bulb } from './old/Bulb'` — the hand-written icons predating the generator. */
const LEGACY_EXPORT = /export\s+\{\s*(\w+)\s*\}\s+from\s+'\.\/old\//g;

const legacyComponents = (baseSrcDir: string): string[] => {
  let barrel: string;
  try {
    barrel = readFileSync(join(baseSrcDir, "icons", "index.ts"), "utf8");
  } catch {
    return [];
  }

  const names = [...barrel.matchAll(LEGACY_EXPORT)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);

  // The `Icon` wrapper lives in `components/`, re-exported via `export * from './components'`.
  return [...new Set(["Icon", ...names])].sort(compareStrings);
};

export const extractIcons = (paths: KitPaths): KitIconsArtifact => {
  const svgDir = join(paths.baseSrcDir, ...ICONS_SUBPATH);

  let entries: string[];
  try {
    entries = readdirSync(svgDir);
  } catch {
    throw new ExtractionError(
      `Icon sources not found at ${svgDir}. Is the ui-kit checkout complete?`,
    );
  }

  const byName = new Map<string, KitIcon["variants"][number][]>();
  let files = 0;
  let unreadable = 0;

  for (const entry of [...entries].sort(compareStrings)) {
    if (!entry.endsWith(".svg")) {
      continue;
    }
    files += 1;

    const match = ICON_FILE.exec(entry);
    const size = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
    const name = match?.[2];

    if (name === undefined || !Number.isFinite(size)) {
      unreadable += 1;
      continue;
    }

    let geometry;
    try {
      geometry = svgFingerprint(readFileSync(join(svgDir, entry), "utf8"));
    } catch {
      geometry = null;
    }
    if (geometry === null) {
      unreadable += 1;
      continue;
    }

    const variants = byName.get(name) ?? [];
    variants.push({
      size,
      viewBox: geometry.viewBox,
      fingerprint: geometry.fingerprint,
      paths: [...geometry.shapes],
    });
    byName.set(name, variants);
  }

  const icons: KitIcon[] = [...byName.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, variants]) => ({ name, variants: [...variants].sort((a, b) => a.size - b.size) }));

  const artifact: KitIconsArtifact = {
    $schema: "ds-analyzer/kit-icons@1",
    meta: {
      counts: { icons: icons.length, files, unreadable },
    },
    icons,
    legacyComponents: legacyComponents(paths.baseSrcDir),
  };

  return kitIconsArtifactSchema.parse(artifact);
};
