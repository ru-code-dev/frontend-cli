import { edsRef } from "./ref";
import { sysLight } from "./sys";
import { makeTemplates } from "./utils/makeTemplates";

export const THEME_TEMPLATES = {
  edsRef: makeTemplates(edsRef, "edsRef"),
  edsSys: makeTemplates(sysLight, "edsSys"),
};
