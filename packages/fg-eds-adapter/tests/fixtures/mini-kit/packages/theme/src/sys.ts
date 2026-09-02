export const sysLight = {
  Background: { backAccent: "{edsRef.color.blue}", backPlain: "{edsRef.color.white}" },
  Border: { borderBase: "rgba({edsRef.color.blue},0.06)" },
  borderWidth: { none: "{edsRef.borderWidth.none}" },
};
export const sysDark = {
  Background: { backAccent: "{edsRef.color.white}", backPlain: "{edsRef.color.blue}" },
  Border: { borderBase: "rgba({edsRef.color.white},0.06)" },
  borderWidth: { none: "{edsRef.borderWidth.none}" },
};
export type EdsSys = typeof sysLight;
