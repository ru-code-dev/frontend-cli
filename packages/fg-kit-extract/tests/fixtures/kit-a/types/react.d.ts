// Hermetic React stand-in for the fixture kit.
//
// The extractor is never allowed to assume a kit ships `@types/react`, and the test suite is
// never allowed to depend on a package that is not declared in this package's manifest. So the
// fixture kit declares the handful of React shapes its components use, as a `.d.ts` — which is
// exactly how a real kit sees React too (a declaration file it did not author). The extractor's
// "kit-authored vs external" split keys off that fact, not off the name `react`.

declare namespace JSX {
  interface Element {
    readonly jsx: unique symbol;
  }
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}

declare module "react" {
  export interface ReactElement {
    readonly type: unknown;
  }
  export type ReactNode = string | number | boolean | null | undefined | ReactElement;

  export interface DomSharedProps {
    id?: string;
    className?: string;
    hidden?: boolean;
    children?: ReactNode;
  }

  export interface IntrinsicPropsMap {
    a: DomSharedProps & { href?: string };
    button: DomSharedProps & { disabled?: boolean; type?: "button" | "submit" | "reset" };
    div: DomSharedProps;
    span: DomSharedProps;
  }

  export type ComponentPropsWithoutRef<T extends keyof IntrinsicPropsMap> = IntrinsicPropsMap[T];

  export type FC<P> = (props: P) => JSX.Element;

  export function forwardRef<T, P>(
    render: (props: P, ref: T) => JSX.Element,
  ): (props: P) => JSX.Element;
}
