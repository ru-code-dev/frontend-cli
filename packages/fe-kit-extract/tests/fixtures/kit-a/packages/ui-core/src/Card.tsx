import type * as React from "react";

export interface CardHeaderProps {
  title: string;
}

export function CardHeader(props: CardHeaderProps) {
  return <header>{props.title}</header>;
}

export interface CardFooterProps {
  sticky?: boolean;
}

/** Deliberately NOT exported standalone — reachable only as `Card.Footer`. */
function CardFooter(props: CardFooterProps) {
  return <footer hidden={props.sticky}>{null}</footer>;
}

export interface CardProps {
  children?: React.ReactNode;
}

export function Card(props: CardProps) {
  return <section>{props.children}</section>;
}

Card.Header = CardHeader;

Object.assign(Card, { Footer: CardFooter });
