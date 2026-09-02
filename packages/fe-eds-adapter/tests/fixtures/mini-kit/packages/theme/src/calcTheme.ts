// Copied VERBATIM from `ui-kit-eds-ce/packages/theme/src/calcTheme.ts`, minus a stray
// `eslint-disable-next-line` that disabled nothing. This file is the fixture's whole point: the
// loader must execute the kit's real resolution code — including the `rgba(...)` alpha
// arithmetic below — rather than a reimplementation of it, so reproducing it is not optional.

import { ref, edsRef } from "./ref";
import { comp, EdsComp } from "./comp";
import { EdsSys } from "./sys";

const getByPath = (obj: unknown, path: string) => {
  let val = obj;
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    // @ts-expect-error
    val = val[parts[i]];
  }
  return val;
};

const recursiveReplace = (obj: unknown, values: unknown) => {
  if (typeof obj === "string") {
    const colorToken = obj.match(/\{(.*?)\}/)?.[1];

    if (!colorToken) {
      return obj;
    }

    const colorValue = getByPath(values, colorToken);

    const isRgba = /rgba\(\{.*\)/.test(obj);

    if (isRgba) {
      const opacityStr = obj.match(/,(.*)\)/)?.[1];

      if (opacityStr) {
        let trimmedString = opacityStr.trim().replace("0.", "");
        trimmedString = trimmedString.length === 1 ? `${trimmedString}0` : trimmedString;
        const percNumber = Number(trimmedString);
        const perc = Math.round((255 * percNumber) / 100);
        let opacity = Number(perc).toString(16);
        if (opacity.length === 1) {
          opacity = `0${opacity}`;
        }
        return `${colorValue}${opacity}`;
      }
    }

    return colorValue;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  // @ts-expect-error
  return Object.keys(obj).reduce((acc, key) => {
    // @ts-expect-error
    acc[key] = recursiveReplace(obj[key], values);
    return acc;
  }, {});
};

export const calcTheme = (sys: EdsSys) => {
  const edsSys = recursiveReplace(sys, { edsRef }) as EdsSys;
  const edsComp = recursiveReplace(comp, { edsRef, edsSys }) as EdsComp;

  return {
    ref,
    edsRef,
    edsSys,
    comp: edsComp,
  };
};
