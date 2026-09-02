/**
 * `kit-icons.json` for EDS 2.x — same fingerprints, a different directory and a name rule.
 *
 * Three things move from v1 (S1 break V9, `reports/s1-v2-facts.md:390`):
 *  - the SVGs are at `packages/base/src/components/Icon/svg`, flat, 466 files = 233 icons × {16,20};
 *  - there is no legacy barrel, so `legacyComponents` is `["Icon"]` — the wrapper and nothing else;
 *  - the COMPONENT NAME is not the file's suffix. The kit generates its `Icon/_generated`
 *    directory from these files (`Icon/script/entities/Component.ts:102-117`), and that directory
 *    is gitignored, so a checkout cannot be asked what a file is called — the generator's own
 *    rule has to be re-implemented. S1 validated the re-implementation: 233 groups, 233 distinct
 *    names, 0 collisions.
 *
 * The geometry side is `svgFingerprint`, unchanged and shared, because "the kit draws exactly
 * this path" must mean the same thing under both profiles or the two reports are not comparable.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { compareStrings } from "@smart-tools/fg-analyzer-engine";

import { svgFingerprint } from "../../icons/fingerprint.ts";
import {
  kitIconsArtifactSchema,
  type KitIcon,
  type KitIconsArtifact,
} from "../domain/kit-icons.ts";
import { ExtractionError } from "../shared/errors.ts";

import type { KitPathsV2 } from "./paths.ts";

const ICON_FILE = /^io(\d+)-(.+)\.svg$/;

const DIGIT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
] as const;

/**
 * The generator's name rule, re-implemented.
 *
 * `accordions-down` → `AccordionsDown`, `2fa` → `Twofa`, `META-API` → `MetaAPI`,
 * `Pulse-color` → `PulseColor`. The `META` fix-up is the generator's own
 * (`Component.ts:102-117`) and is kept because dropping it would rename eight real icons.
 */
export const iconComponentName = (stem: string): string => {
  const spelled = stem.replace(/^\d+/, (digits) =>
    [...digits].map((digit) => DIGIT_WORDS[Number(digit)] ?? digit).join(""),
  );

  const camel = spelled
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

  return camel.replace(/META/g, "Meta");
};

export const extractIconsV2 = (paths: KitPathsV2): KitIconsArtifact => {
  let entries: string[];
  try {
    entries = readdirSync(paths.iconsSvgDir);
  } catch {
    throw new ExtractionError(
      `Icon sources not found at ${paths.iconsSvgDir}. Is the EDS 2.x checkout complete?`,
    );
  }

  const byName = new Map<string, KitIcon["variants"][number][]>();
  let files = 0;
  let unreadable = 0;

  for (const entry of [...entries].toSorted(compareStrings)) {
    if (!entry.endsWith(".svg")) continue;
    files += 1;

    const match = ICON_FILE.exec(entry);
    const size = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
    const stem = match?.[2];

    if (stem === undefined || !Number.isFinite(size)) {
      unreadable += 1;
      continue;
    }

    let geometry;
    try {
      geometry = svgFingerprint(readFileSync(join(paths.iconsSvgDir, entry), "utf8"));
    } catch {
      geometry = null;
    }
    if (geometry === null) {
      unreadable += 1;
      continue;
    }

    const name = iconComponentName(stem);
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
    .toSorted(([left], [right]) => compareStrings(left, right))
    .map(([name, variants]) => ({ name, variants: [...variants].toSorted((a, b) => a.size - b.size) }));

  return kitIconsArtifactSchema.parse({
    $schema: "ds-analyzer/kit-icons@1",
    meta: { counts: { icons: icons.length, files, unreadable } },
    icons,
    // The wrapper component, and nothing else: EDS 2.x ships no hand-written icon barrel.
    legacyComponents: ["Icon"],
  } satisfies KitIconsArtifact);
};
