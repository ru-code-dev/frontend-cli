export * from "./Frame";
// Re-export of a component another package already exports — the SAME declaration, so it is
// recorded once rather than reported as a collision. Resolvable only through the `paths` alias.
export { Chip } from "@kitb/core";
