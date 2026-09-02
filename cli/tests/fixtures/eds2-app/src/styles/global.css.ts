import { globalStyle } from "@vanilla-extract/css";

globalStyle("body", {
  margin: 0,
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: "13px",
  backgroundColor: "#fafbfc",
});

globalStyle("[class*='sds-eng-modal-root']", {
  zIndex: 9999,
  boxShadow: "0 2px 7px rgba(0, 0, 0, 0.18) !important",
});

globalStyle("[class*='sds-eng-tooltip-root']", {
  width: "213px !important",
});
