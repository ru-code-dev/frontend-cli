/**
 * Finding the kit's own class names inside a consumer's SELECTOR.
 *
 * ## Why a selector matcher exists at all
 *
 * `style.override` normally learns that a declaration lands on a kit component from the engine's
 * linking pass, which follows a `className` from a stylesheet to the JSX that applies it. That
 * works when the consumer owns the class. It cannot work for EDS 2.x, where the class belongs to
 * the KIT and never appears in the consumer's JSX at all: the only way to reach a kit component's
 * paint from outside is to name its class in a selector, and the kit renders that class itself.
 *
 * ## Why a PREFIX, and why attribute selectors
 *
 * A v2 class is `sds-eng-<layer>[-<sub>]-<debugId>-<hash>`, and the trailing hash is
 * `hash(packageName + filePath) + refCount` — it moves whenever a file moves or a rule is added
 * above it (S1 §4, with the live class names). A consumer therefore CANNOT write an exact kit
 * class; what they write is `[class*='sds-eng-button-root']`, and a matcher that only understood
 * `.class` tokens would find nothing that exists in a real project.
 *
 * So the match is: the profile's prefix, then the longest declared `@layer` name (the layers are
 * the kit's own, extracted into `components.meta.styleLayers`), then whatever debug id follows.
 * Longest-first matters: `text` is a prefix of `text-field`, and matching the short one would
 * report a `TextField` override as a `Text` override.
 *
 * A kit whose profile declares no prefix — EDS 1.x, whose classes are the upstream's BEM and are
 * reached through the linking pass — gets an empty list from every function here, so the rule
 * behaves exactly as it always has.
 */
import type { KitSpec } from "../../kit/spec.ts";

/** One kit class named in a selector. */
export interface KitClassReference {
  /** The kit component the layer belongs to, e.g. `Button`. */
  readonly component: string;
  /** The debug id that follows the layer, e.g. `root`, `input`; `null` when there is none. */
  readonly slot: string | null;
  /** The matched class prefix as written, e.g. `sds-eng-text-field-input`. */
  readonly matched: string;
  /**
   * `true` when the selector continues PAST this class — `… input`, `… > span`.
   *
   * That is the honest test for "reaches inside the component": the consumer is styling an
   * element the kit renders but never named, which is the thing that breaks silently when the
   * kit's internal markup changes.
   */
  readonly inner: boolean;
}

/** `text-field` → `textfield`, so a layer can be matched against a component name. */
const flatten = (value: string): string => value.replace(/[-_\s]/g, "").toLowerCase();

/**
 * Every kit class named in `selector`, in the order they appear.
 *
 * Deliberately syntax-light: the selector arrives as SOURCE TEXT (a vanilla-extract
 * `globalStyle` selector can be a template literal, backticks and `${…}` included), so a real
 * CSS parser would have to be given something that is not CSS. Scanning for the prefix and
 * reading what follows is exact for the shapes a consumer can actually write, and yields nothing
 * for anything else.
 */
export const kitClassesIn = (selector: string, kit: KitSpec): KitClassReference[] => {
  const prefix = kit.profile.classNames.prefix;
  if (prefix === null) return [];

  const layers = kit.styleLayers;
  if (layers.length === 0) return [];

  const componentByLayer = new Map<string, string>();
  for (const component of kit.componentNames()) {
    componentByLayer.set(flatten(component), component);
  }

  const found: KitClassReference[] = [];
  const pattern = new RegExp(
    `${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}-[A-Za-z0-9-]+`,
    "g",
  );

  for (const match of selector.matchAll(pattern)) {
    const whole = match[0];
    const rest = whole.slice(prefix.length + 1);

    const layer = layers.find((name) => rest === name || rest.startsWith(`${name}-`));
    if (layer === undefined) continue;

    const component = componentByLayer.get(flatten(layer));
    if (component === undefined) continue;

    const slot = rest.length > layer.length ? rest.slice(layer.length + 1) : null;

    // What follows the class in the selector, with the attribute-selector punctuation that
    // closes it removed. Anything left is a descendant, a child or a sibling — i.e. an element
    // the kit renders and the consumer is reaching into.
    const tail = selector
      .slice((match.index ?? 0) + whole.length)
      .replace(/^['"]?\s*\]/, "")
      .replace(/`$/, "")
      .trim();

    found.push({
      component,
      slot,
      matched: whole,
      inner: tail.length > 0 && !tail.startsWith(","),
    });
  }

  return found;
};
