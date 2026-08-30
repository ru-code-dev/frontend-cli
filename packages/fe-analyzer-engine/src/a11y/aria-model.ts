import { aria, roles } from "aria-query";

/**
 * The ARIA 1.2 role model, as data. Ported verbatim from
 * `hackathon2026/ds-analyzer/src/a11y/aria-model.ts:1-144`.
 *
 * Wrapped rather than imported directly by the rules for two reasons. The rules stay
 * dependency-free and testable, and — more importantly — the wrapper is where the judgement
 * lives: `aria-query` describes the specification, while a linter has to decide which parts
 * of it are worth reporting. Those are different jobs, and mixing them is how a conformance
 * tool ends up arguing with people about `aria-atomic`.
 *
 * Nothing here is hand-written spec data. A curated table of roles would drift from the
 * specification the first time ARIA changed, and would be wrong in ways no test could catch,
 * because the test would be written from the same table.
 */

/**
 * The shape this module reads, narrowed once at the boundary.
 *
 * `@types/aria-query` lags the package it describes: `accessibleNameRequired` is present at
 * runtime but absent from the declarations, and `roles.get` is typed to a key union that
 * cannot accept a string read out of source code — which is the only kind of string this
 * module ever has. Casting once here, behind functions that return plain data, keeps that
 * mismatch from leaking into every rule.
 */
interface RoleDefinition {
  readonly abstract: boolean;
  readonly props: Readonly<Record<string, unknown>>;
  readonly requiredProps: Readonly<Record<string, unknown>>;
  readonly prohibitedProps?: readonly string[];
  readonly accessibleNameRequired?: boolean;
  readonly nameFrom?: readonly string[];
}

const roleTable = roles as unknown as {
  get: (name: string) => RoleDefinition | undefined;
  entries: () => Iterable<[string, RoleDefinition]>;
};

const ariaTable = aria as unknown as { keys: () => Iterable<string> };

/** Every non-abstract role a `role="…"` attribute may legally name. */
const CONCRETE_ROLES: ReadonlySet<string> = new Set(
  [...roleTable.entries()].filter(([, definition]) => !definition.abstract).map(([name]) => name),
);

// The source spreads into an array first (`aria-model.ts:47`); `Set` takes the iterable
// directly, which is what the house linter asks for and the same set either way.
const ALL_ARIA_ATTRIBUTES: ReadonlySet<string> = new Set(ariaTable.keys());

/**
 * Global attributes, allowed on any element regardless of role.
 *
 * Read off `roletype`, the root of the role hierarchy, rather than listed by hand: every
 * role inherits from it, so its properties are exactly the global set by definition.
 */
const GLOBAL_ARIA_ATTRIBUTES: ReadonlySet<string> = new Set(
  Object.keys(roleTable.get("roletype")?.props ?? {}),
);

export const isKnownRole = (role: string): boolean => CONCRETE_ROLES.has(role);

/**
 * Every legal spelling, sorted — the search space a typo is matched against.
 *
 * Returned as data rather than searched here: "which known name did the author mean" is a
 * judgement about how close is close enough, and that belongs with the rule that has to
 * defend the suggestion, not with the module that only reports what the specification says.
 */
export const roleNames = (): readonly string[] => [...CONCRETE_ROLES].sort();

export const ariaAttributeNames = (): readonly string[] => [...ALL_ARIA_ATTRIBUTES].sort();

export const isAbstractRole = (role: string): boolean =>
  roleTable.get(role) !== undefined && !CONCRETE_ROLES.has(role);

export const isKnownAriaAttribute = (attribute: string): boolean =>
  ALL_ARIA_ATTRIBUTES.has(attribute);

/** Attributes a role must carry to be meaningful, e.g. `aria-checked` on `checkbox`. */
export const requiredPropsOf = (role: string): readonly string[] =>
  Object.keys(roleTable.get(role)?.requiredProps ?? {}).sort();

/** `true` when `attribute` is either global or supported by `role`. */
export const roleSupports = (role: string, attribute: string): boolean => {
  if (GLOBAL_ARIA_ATTRIBUTES.has(attribute)) {
    return true;
  }

  const definition = roleTable.get(role);

  return definition !== undefined && attribute in definition.props;
};

/** Attributes explicitly forbidden on a role, e.g. `aria-label` on `role="none"`. */
export const prohibitedPropsOf = (role: string): readonly string[] =>
  [...(roleTable.get(role)?.prohibitedProps ?? [])].sort();

/**
 * `true` when the specification says this role is meaningless without an accessible name.
 *
 * Drives the missing-name rule directly, which is why it is read from the model rather than
 * from a list: `button`, `link` and `heading` are the obvious members, but the full set
 * includes roles most people would not think to add.
 */
export const requiresAccessibleName = (role: string): boolean =>
  roleTable.get(role)?.accessibleNameRequired === true;

/**
 * `true` when a role may take its accessible name from its own text content.
 *
 * The distinction decides what a missing-name finding should even say. `button` names itself
 * from its contents, so `<button>Save</button>` needs nothing more. `tabpanel` and `dialog`
 * do not — their name comes from `aria-labelledby` or `aria-label` regardless of what they
 * contain, so telling their author to "add some text" would be advice that cannot work.
 */
export const namesFromContents = (role: string): boolean =>
  (roleTable.get(role)?.nameFrom ?? []).includes("contents");

/** Native HTML tags that already carry `role` implicitly, so `role="…"` on them is redundant. */
const IMPLICIT_ROLE_BY_TAG: ReadonlyMap<string, string> = new Map([
  ["button", "button"],
  ["a", "link"],
  ["nav", "navigation"],
  ["main", "main"],
  ["header", "banner"],
  ["footer", "contentinfo"],
  ["aside", "complementary"],
  ["ul", "list"],
  ["ol", "list"],
  ["li", "listitem"],
  ["table", "table"],
  ["form", "form"],
  ["dialog", "dialog"],
  ["img", "img"],
  ["textarea", "textbox"],
  ["select", "combobox"],
  ["progress", "progressbar"],
]);

/**
 * The role a tag already has without any attribute.
 *
 * Deliberately a small, unambiguous subset of the HTML-AAM mapping. The full mapping is
 * conditional — `<a>` is a `link` only with `href`, `<input>` depends on `type`, `<header>`
 * is a `banner` only outside a sectioning element — and encoding those conditions from
 * attributes alone would produce confident wrong answers. What is here is what holds
 * unconditionally.
 */
export const implicitRoleOf = (tag: string): string | null => IMPLICIT_ROLE_BY_TAG.get(tag) ?? null;
