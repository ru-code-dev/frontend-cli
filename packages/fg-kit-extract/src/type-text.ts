import { relative } from "node:path";
import { type Node, ts, type Type } from "ts-morph";

/** Kit-root-relative, POSIX separators — the only path shape that appears in the output. */
export function toRelative(kitRoot: string, absolute: string): string {
  const rel = relative(kitRoot, absolute);
  return rel.split("\\").join("/");
}

const IMPORT_PATH_RE = /import\("([^"]*)"\)/gu;

/**
 * Absolute paths leak into checker type text as `import("/abs/path").Name`. They are rewritten
 * to kit-relative (or `node_modules`-relative) form so two runs on two machines produce
 * byte-identical JSON.
 */
export function sanitizeTypeText(text: string, kitRoot: string): string {
  return text.replaceAll(IMPORT_PATH_RE, (_match, path: string) => {
    const marker = path.lastIndexOf("node_modules/");
    if (marker >= 0) return `import("${path.slice(marker + "node_modules/".length)}")`;
    const rel = toRelative(kitRoot, path);
    return `import("${rel.startsWith("..") ? path.split("/").slice(-2).join("/") : rel}")`;
  });
}

/** `false | true` is how the checker spells `boolean` once a union has been taken apart. */
function collapseBooleanPair(parts: string[]): string[] {
  const index = parts.findIndex((part, i) => part === "false" && parts[i + 1] === "true");
  if (index < 0) return parts;
  return [...parts.slice(0, index), "boolean", ...parts.slice(index + 2)];
}

export interface TypeTextOptions {
  /** Drop the `undefined` member the checker adds to every optional property. */
  stripUndefined?: boolean;
}

/**
 * EXACT resolved type text. Unions are spelled out member by member rather than printed as the
 * alias they came from, which is the whole point: a `size` prop typed `Size` has to read
 * `"sm" | "md" | "lg"` on the component that inherited it.
 */
export function typeText(
  type: Type,
  at: Node,
  kitRoot: string,
  options: TypeTextOptions = {},
): string {
  if (type.isUnion()) {
    const members = options.stripUndefined
      ? type.getUnionTypes().filter((member) => !member.isUndefined())
      : type.getUnionTypes();
    if (members.length === 0) return "undefined";
    const parts = collapseBooleanPair(
      members.map((member) =>
        sanitizeTypeText(member.getText(at, ts.TypeFormatFlags.NoTruncation), kitRoot),
      ),
    );
    return parts.join(" | ");
  }
  return sanitizeTypeText(type.getText(at, ts.TypeFormatFlags.NoTruncation), kitRoot);
}

/**
 * Rendering used for exported TYPE declarations: an object type is spelled out property by
 * property (with each property's own union expanded) instead of collapsing to its own name.
 */
export function declaredTypeText(type: Type, at: Node, kitRoot: string): string {
  if (type.isUnion()) return typeText(type, at, kitRoot);
  const properties = type.getProperties();
  if (properties.length > 0 && type.isObject() && type.getCallSignatures().length === 0) {
    const members = properties.map((property) => {
      const optional = property.hasFlags(ts.SymbolFlags.Optional);
      const propertyType = property.getTypeAtLocation(at);
      return `${property.getName()}${optional ? "?" : ""}: ${typeText(propertyType, at, kitRoot, {
        stripUndefined: optional,
      })}`;
    });
    return `{ ${members.join("; ")} }`;
  }
  return typeText(type, at, kitRoot);
}
