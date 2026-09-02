import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

import type { KitPaths } from "../paths.ts";
import type { Declaration } from "@smart-tools/fe-analyzer-engine";
import {
  kitCardsArtifactSchema,
  kitSignaturesArtifactSchema,
  type KitCard,
  type KitCardsArtifact,
  type KitSignature,
  type KitSignaturesArtifact,
} from "../domain/kit-knowledge.ts";
import type { KitA11yArtifact } from "../domain/kit-a11y.ts";
import { compareStrings, scanProject, sortStrings } from "@smart-tools/fe-analyzer-engine";

/**
 * Builds the kit knowledge base: `kit-signatures.json` for the static scorer and
 * `kit-cards.json` for the AI stage.
 *
 * Sources, in order of trust:
 *  - `components.json` — names, props, variants, slots, wraps (already extracted);
 *  - `kit-a11y.json` — ARIA roles and attributes per component (upstream evidence);
 *  - the kit's own component sources, read with the *same collector the analyzer runs on
 *    products* — so a kit component and a product component are described in identical
 *    vocabulary, which is what makes them comparable at all.
 *
 * Everything degrades honestly: a component whose source declaration cannot be found gets
 * an empty AST signature and is counted in `withoutSource`, never dropped.
 */

/** Names the ecosystem uses interchangeably; used by the name heuristic of the scorer. */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["Modal", "Dialog", "Popup", "Overlay", "Lightbox"],
  ["Notification", "Toast", "Snackbar"],
  ["Drawer", "SidePanel", "Sidebar"],
  ["Chip", "Pill", "Tag"],
  ["Spinner", "Loader", "Preloader"],
  ["TextField", "Input", "TextInput"],
  ["Select", "Dropdown", "Combobox"],
  ["Tooltip", "Hint"],
  ["Tabs", "TabBar"],
  ["Checkbox", "Check"],
  ["Avatar", "UserPic"],
  ["Badge", "Counter"],
];

const synonymsOf = (name: string): string[] => {
  for (const group of SYNONYM_GROUPS) {
    if (group.includes(name)) {
      return group.filter((candidate) => candidate !== name);
    }
  }
  return [];
};

/**
 * The slice of `components.json` this extractor reads.
 *
 * PORT NOTE. The hackathon reached for the two upstream artifacts through the FILESYSTEM —
 * `readComponentsArtifact(paths.artifactsDir)` / `readA11yArtifact(paths.artifactsDir)`
 * (`ds-analyzer/src/kit-knowledge/extract.ts:74-88`), each with its own `existsSync`, its own
 * `JSON.parse` and, for components, an unchecked cast. That is the same unguarded-read seam the
 * adapter was built to remove (`packages/fe-eds-adapter/src/artifacts/index.ts:26-29`), and it
 * forced the two stages to agree on a directory rather than on a value. Here the pipeline holds
 * both artifacts in memory and passes them in, so this stage cannot read a stale
 * `components.json` from a previous run and cannot fail on a directory at all.
 *
 * The structural type is kept — rather than importing `ComponentsArtifact` — because it states
 * exactly the eight fields this stage consumes, which is the honest declaration of the coupling.
 */
interface ComponentsArtifactSlice {
  components: {
    name: string;
    directory: string;
    public: boolean;
    components: { name: string; subcomponents: string[]; doc: { text: string | null } }[];
    props: {
      members: {
        name: string;
        optional: boolean;
        type: string | null;
        doc: { text: string | null };
      }[];
    }[];
    variants: { name: string; keys: string[] }[];
    slots: { slots: { name: string }[] }[];
    wraps: string[];
  }[];
}

/**
 * The declaration that *is* the component, among everything its directory declares.
 * Exact name match wins; otherwise the largest body — helpers and hooks are smaller.
 */
const mainDeclaration = (
  declarations: readonly Declaration[],
  name: string,
): Declaration | null => {
  const components = declarations.filter(
    (declaration) => declaration.kind === "component" || declaration.kind === "styled-component",
  );

  return (
    components.find((declaration) => declaration.name === name) ??
    [...components].sort((left, right) => right.elementCount - left.elementCount)[0] ??
    null
  );
};

const listExamples = (uiKitRoot: string, directory: string): string[] => {
  try {
    return readdirSync(join(uiKitRoot, directory, "examples"))
      .filter((entry) => entry.endsWith(".tsx"))
      .map((entry) => entry.replace(/\.tsx$/, ""))
      .sort(compareStrings);
  } catch {
    return [];
  }
};

/** `view: primary|secondary|negative · size: xs|sm|md` — the variant half of a T0 line. */
const variantSummary = (variants: readonly { name: string; keys: string[] }[]): string =>
  variants
    .filter((variant) => variant.keys.length > 0)
    .slice(0, 3)
    .map((variant) => `${variant.name}: ${variant.keys.join("|")}`)
    .join(" · ");

export interface KnowledgeExtraction {
  readonly signatures: KitSignaturesArtifact;
  readonly cards: KitCardsArtifact;
}

export interface ExtractKnowledgeInput {
  readonly paths: KitPaths;
  /** The `components.json` this run produced — passed as a value, never re-read from disk. */
  readonly components: ComponentsArtifactSlice;
  /** The `kit-a11y.json` this run produced, or `null` when the upstream was unavailable. */
  readonly a11y: KitA11yArtifact | null;
}

export const extractKnowledge = (input: ExtractKnowledgeInput): KnowledgeExtraction => {
  const { paths, a11y } = input;
  const artifact = input.components;

  // The kit's sources through the product collector: same vocabulary on both sides.
  const { observations } = scanProject({ path: paths.componentsDir });
  const declarationsByDirectory = new Map<string, Declaration[]>();
  for (const declaration of observations.declarations) {
    const match = /components\/([^/]+)\//.exec(declaration.file);
    if (match?.[1] === undefined) {
      continue;
    }
    const bucket = declarationsByDirectory.get(match[1]) ?? [];
    bucket.push(declaration);
    declarationsByDirectory.set(match[1], bucket);
  }

  const patternByComponent = new Map(
    (a11y?.patterns ?? []).map((pattern) => [pattern.component, pattern]),
  );

  const publicComponents = artifact.components.filter((component) => component.public);

  // TF-IDF over prop names: document = component, term = prop.
  const documentFrequency = new Map<string, number>();
  const propsByComponent = new Map<string, string[]>();
  for (const component of publicComponents) {
    const props = sortStrings([
      ...new Set(component.props.flatMap((group) => group.members.map((member) => member.name))),
    ]);
    propsByComponent.set(component.name, props);
    for (const prop of props) {
      documentFrequency.set(prop, (documentFrequency.get(prop) ?? 0) + 1);
    }
  }
  const idf = (prop: string): number =>
    Math.round(Math.log(publicComponents.length / (documentFrequency.get(prop) ?? 1)) * 1000) /
    1000;

  const signatures: KitSignature[] = [];
  const cards: KitCard[] = [];
  let withoutSource = 0;
  let exampleCount = 0;

  for (const component of [...publicComponents].sort((left, right) =>
    compareStrings(left.name, right.name),
  )) {
    const directory = basename(component.directory);
    const declaration = mainDeclaration(
      declarationsByDirectory.get(directory) ?? [],
      component.name,
    );
    if (declaration === null) {
      withoutSource += 1;
    }

    const props = propsByComponent.get(component.name) ?? [];
    const pattern = patternByComponent.get(component.name);
    const main = component.components.find((candidate) => candidate.name === component.name);

    signatures.push({
      name: component.name,
      propSignature: props,
      propWeights: Object.fromEntries(props.map((prop) => [prop, idf(prop)])),
      ariaRoles: pattern?.roles ?? [],
      ariaAttributes: pattern?.ariaAttributes ?? [],
      nativeTags: declaration?.nativeTags ?? [],
      domShape: declaration?.jsxShape ?? [],
      cssProperties: declaration?.cssProperties ?? [],
      astSignature: declaration?.astSignature ?? [],
      synonyms: synonymsOf(component.name),
      subcomponents: main?.subcomponents ?? [],
      wraps: component.wraps,
    });

    const examples = listExamples(paths.uiKitRoot, component.directory);
    exampleCount += examples.length;

    const doc = main?.doc.text?.split("\n")[0] ?? null;
    const summary = variantSummary(component.variants);

    cards.push({
      name: component.name,
      t0: [
        `${component.name} — ${doc ?? "компонент кита"}`,
        summary.length > 0 ? summary : null,
        props.length > 0 ? `пропы: ${props.slice(0, 8).join(", ")}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      t1: {
        import: `import { ${component.name} } from '@sds-eng/base'`,
        props: component.props.flatMap((group) =>
          group.members.map((member) => ({
            name: member.name,
            type: member.type,
            values: [],
            doc: member.doc.text,
          })),
        ),
        variants: Object.fromEntries(
          component.variants
            .filter((variant) => variant.keys.length > 0)
            .map((variant) => [variant.name, variant.keys]),
        ),
        slots: sortStrings([
          ...new Set(component.slots.flatMap((group) => group.slots.map((slot) => slot.name))),
        ]),
        subcomponents: main?.subcomponents ?? [],
        wraps: component.wraps,
        examples,
      },
    });
  }

  return {
    signatures: kitSignaturesArtifactSchema.parse({
      $schema: "ds-analyzer/kit-signatures@1",
      meta: { counts: { components: signatures.length, withoutSource } },
      signatures,
    }),
    cards: kitCardsArtifactSchema.parse({
      $schema: "ds-analyzer/kit-cards@1",
      meta: { counts: { components: cards.length, examples: exampleCount } },
      cards,
    }),
  };
};
