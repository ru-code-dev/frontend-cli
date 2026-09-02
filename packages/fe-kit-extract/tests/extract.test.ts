import { describe, expect, it } from "vite-plus/test";

import type { ComponentEntry } from "../src/types.ts";
import { component, extractFixture, REACT_NODE } from "./harness.ts";

const kit = extractFixture("kit-a");

describe("kit surface", () => {
  it("reports the kit and every package under the packages dir", () => {
    expect(kit.schemaVersion).toBe(1);
    expect(kit.kit).toEqual({
      name: "@fixture/kit-a",
      version: "1.2.3",
      tsconfig: null,
      compilerOptions: "defaults",
      packages: [
        { name: "@fixture/ui-broken", dir: "packages/ui-broken", version: "0.0.1", entry: null },
        {
          name: "@fixture/ui-core",
          dir: "packages/ui-core",
          version: "0.4.0",
          entry: "packages/ui-core/src/index.ts",
        },
        {
          name: "@fixture/ui-lab",
          dir: "packages/ui-lab",
          version: "0.0.7",
          entry: "packages/ui-lab/src/index.ts",
        },
        // Root `index.ts` fallback: this package has no `src/`.
        {
          name: "@fixture/ui-legacy",
          dir: "packages/ui-legacy",
          version: "9.9.9",
          entry: "packages/ui-legacy/index.ts",
        },
      ],
    });
  });

  it("resolves the full export surface through `export *` and `export { X } from` chains", () => {
    // Box/Button/ButtonProps arrive via `export * from`; Card/CardHeader/Maybe/Panel/Poly via
    // named re-export; Badge through a root index.ts that itself re-exports.
    expect(Object.keys(kit.components)).toEqual([
      "Badge",
      "Box",
      "Button",
      "Card",
      "Card.Footer",
      "Card.Header",
      "CardHeader",
      "Maybe",
      "Panel",
      "Poly",
      "Widget",
    ]);
  });
});

describe("props via the type checker", () => {
  const button = component(kit, "Button");

  it("flattens a 3-level extends + utility-type chain with exact types and provenance", () => {
    // ButtonProps -> Omit<InnerProps, "tone"> -> InnerProps -> UtilityProps.
    expect(button.props).toEqual([
      {
        name: "label",
        type: "string",
        required: true,
        from: { name: "InnerProps", file: "packages/ui-core/src/base-props.ts" },
      },
      {
        name: "size",
        type: '"sm" | "md" | "lg"',
        required: false,
        from: { name: "UtilityProps", file: "packages/ui-core/src/base-props.ts" },
      },
      {
        name: "testId",
        type: "string",
        required: false,
        from: { name: "UtilityProps", file: "packages/ui-core/src/base-props.ts" },
      },
      {
        name: "variant",
        type: '"primary" | "ghost"',
        required: true,
        from: { name: "ButtonProps", file: "packages/ui-core/src/Button.tsx" },
      },
    ]);
  });

  it("spells the inherited union out instead of printing its alias", () => {
    const size = button.props.find((prop) => prop.name === "size");
    expect(size?.type).toBe('"sm" | "md" | "lg"');
    expect(size?.from.name).toBe("UtilityProps");
  });

  it("drops `tone` because `Omit` removed it", () => {
    expect(button.props.map((prop) => prop.name)).not.toContain("tone");
  });

  it("collapses the raw DOM prop set instead of enumerating it", () => {
    expect(button.extendsHtml).toBe("button");
    expect(button.extendsExternal).toEqual([]);
    // `id`, `className`, `hidden`, `children`, `disabled`, `type` all come from the DOM set.
    expect(button.props.map((prop) => prop.name)).toEqual(["label", "size", "testId", "variant"]);
  });

  it("does not mistake a utility type's own literal argument for a DOM prop set", () => {
    // `Omit<InnerProps, "tone">` must not surface as an external base named `"tone"`.
    expect(button.extendsExternal).not.toContain('"tone"');
  });

  it("keeps a component that takes no DOM prop set free of a collapse marker", () => {
    expect(component(kit, "Box").extendsHtml).toBeNull();
    expect(component(kit, "Box").props).toEqual([
      {
        name: "children",
        type: REACT_NODE,
        required: false,
        from: { name: "BoxProps", file: "packages/ui-core/src/Box.tsx" },
      },
    ]);
  });
});

describe("root rendered element", () => {
  it("is certain for a literal intrinsic root", () => {
    expect(component(kit, "Button").renders).toEqual({
      element: "button",
      confidence: "certain",
      via: [],
      reason: null,
    });
  });

  it("resolves transitively when the root delegates to another kit component", () => {
    expect(component(kit, "Panel").renders).toEqual({
      element: "div",
      confidence: "delegated",
      via: ["Box"],
      reason: null,
    });
  });

  it("is honestly unknown when the root is decided at runtime", () => {
    expect(component(kit, "Maybe").renders).toEqual({
      element: null,
      confidence: "unknown",
      via: [],
      reason: "conditional-root",
    });
    expect(kit.unresolved).toContainEqual({
      export: "@fixture/ui-core#Maybe",
      reason: "renders: root element unknown (conditional-root)",
    });
  });

  it("is unknown for a dynamic tag, and records the polymorphic prop and its default", () => {
    const poly = component(kit, "Poly");
    expect(poly.renders).toEqual({
      element: null,
      confidence: "unknown",
      via: [],
      reason: "dynamic-tag",
    });
    expect(poly.polymorphic).toEqual({ prop: "as", default: "button" });
    expect(kit.unresolved).toContainEqual({
      export: "@fixture/ui-core#Poly",
      reason: "renders: root element unknown (dynamic-tag)",
    });
  });
});

describe("zero kit assumptions", () => {
  it("resolves a component produced by an arbitrarily named factory", () => {
    // Nothing in the extractor knows the string "zzqFabricate": the export is a component
    // because the checker gives it a call signature and the implementation behind the call
    // returns JSX, and its props come from that signature's parameter.
    expect(component(kit, "Widget")).toEqual({
      name: "Widget",
      package: "@fixture/ui-lab",
      source: "packages/ui-lab/src/Widget.tsx",
      props: [
        {
          name: "name",
          type: "string",
          required: true,
          from: { name: "GlyphProps", file: "packages/ui-lab/src/factory.tsx" },
        },
        {
          name: "weight",
          type: '"regular" | "bold"',
          required: false,
          from: { name: "GlyphProps", file: "packages/ui-lab/src/factory.tsx" },
        },
      ],
      extendsHtml: null,
      extendsExternal: [],
      renders: { element: "span", confidence: "certain", via: [], reason: null },
      polymorphic: null,
      subcomponents: [],
      parent: null,
      alsoExportedAs: null,
      snapshot: {
        root: { tag: "span", kind: "intrinsic", attributes: ["id"], children: [] },
        props: ["name: string", 'weight?: "regular" | "bold"'],
      },
    } satisfies ComponentEntry);
  });
});

describe("subcomponents", () => {
  it("maps `Card.Header = CardHeader` and points at the standalone export", () => {
    expect(component(kit, "Card").subcomponents).toEqual(["Footer", "Header"]);
    const header = component(kit, "Card.Header");
    expect(header.parent).toBe("Card");
    expect(header.alsoExportedAs).toBe("CardHeader");
    expect(header.source).toBe("packages/ui-core/src/Card.tsx");
    expect(header.renders).toEqual({
      element: "header",
      confidence: "certain",
      via: [],
      reason: null,
    });
  });

  it("maps a subcomponent merged in by a call, with no standalone export", () => {
    const footer = component(kit, "Card.Footer");
    expect(footer.parent).toBe("Card");
    expect(footer.alsoExportedAs).toBeNull();
    expect(footer.props).toEqual([
      {
        name: "sticky",
        type: "boolean",
        required: false,
        from: { name: "CardFooterProps", file: "packages/ui-core/src/Card.tsx" },
      },
    ]);
    expect(footer.renders.element).toBe("footer");
  });
});

describe("snapshot", () => {
  it("records the JSX root structure and the flattened prop signature", () => {
    expect(component(kit, "Button").snapshot).toEqual({
      root: {
        tag: "button",
        kind: "intrinsic",
        attributes: ["className", "disabled", "id"],
        children: ["expression"],
      },
      props: [
        "label: string",
        'size?: "sm" | "md" | "lg"',
        "testId?: string",
        'variant: "primary" | "ghost"',
      ],
    });
  });

  it("records a delegating root as a component root", () => {
    expect(component(kit, "Panel").snapshot.root).toEqual({
      tag: "Box",
      kind: "component",
      attributes: [],
      children: ["expression"],
    });
  });

  it("has no root to record when the root is runtime-decided", () => {
    expect(component(kit, "Maybe").snapshot.root).toEqual({
      tag: null,
      kind: "none",
      attributes: [],
      children: [],
    });
  });
});

describe("types", () => {
  it("captures every exported type with its resolved text", () => {
    expect(kit.types).toEqual({
      BadgeProps: {
        name: "BadgeProps",
        package: "@fixture/ui-legacy",
        source: "packages/ui-legacy/Badge.tsx",
        kind: "interface",
        text: "{ text: string }",
      },
      BoxProps: {
        name: "BoxProps",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/Box.tsx",
        kind: "interface",
        text: `{ children?: ${REACT_NODE} }`,
      },
      ButtonProps: {
        name: "ButtonProps",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/Button.tsx",
        kind: "interface",
        text:
          '{ variant: "primary" | "ghost"; label: string; size?: "sm" | "md" | "lg"; testId?: string; ' +
          `id?: string; className?: string; hidden?: boolean; children?: ${REACT_NODE}; ` +
          'disabled?: boolean; type?: "button" | "submit" | "reset" }',
      },
      GlyphProps: {
        name: "GlyphProps",
        package: "@fixture/ui-lab",
        source: "packages/ui-lab/src/factory.tsx",
        kind: "interface",
        text: '{ name: string; weight?: "regular" | "bold" }',
      },
      InnerProps: {
        name: "InnerProps",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/base-props.ts",
        kind: "interface",
        text: '{ tone: "neutral" | "accent"; label: string; size?: "sm" | "md" | "lg"; testId?: string }',
      },
      Size: {
        name: "Size",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/tokens.ts",
        kind: "type-alias",
        text: '"sm" | "md" | "lg"',
      },
      Tone: {
        name: "Tone",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/tokens.ts",
        kind: "type-alias",
        text: '"neutral" | "accent"',
      },
      UtilityProps: {
        name: "UtilityProps",
        package: "@fixture/ui-core",
        source: "packages/ui-core/src/base-props.ts",
        kind: "interface",
        text: '{ size?: "sm" | "md" | "lg"; testId?: string }',
      },
    });
  });
});

describe("unresolved", () => {
  it("lists every export the tool could not fully resolve, and nothing else", () => {
    expect(kit.unresolved).toEqual([
      {
        export: "@fixture/ui-broken",
        reason: "no entry file: none of src/index.ts, src/index.tsx, index.ts, index.tsx exists",
      },
      {
        export: "@fixture/ui-core#CORE_TAG",
        reason: "export is neither a component nor a type (VariableDeclaration)",
      },
      {
        export: "@fixture/ui-core#Maybe",
        reason: "renders: root element unknown (conditional-root)",
      },
      {
        export: "@fixture/ui-core#Poly",
        reason: "renders: root element unknown (dynamic-tag)",
      },
    ]);
  });
});
