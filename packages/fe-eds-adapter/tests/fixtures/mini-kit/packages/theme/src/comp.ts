import * as theme from "./theme";

export type EdsComp = typeof comp;

export const comp = {
  backwardCompatibilityMode: false,
  ...theme,
};
