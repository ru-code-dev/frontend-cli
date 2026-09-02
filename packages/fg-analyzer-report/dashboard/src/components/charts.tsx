import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cx } from "./ui.js";

/**
 * Chart wrappers.
 *
 * Recharts for everything, so the whole dashboard shares one rendering model rather than
 * accumulating a chart library per chart type. The wrappers exist to keep colour and
 * typography decisions in one place — a chart that styles itself differently from the
 * surrounding UI reads as an embedded widget rather than part of the report.
 *
 * Every series is clickable. A chart you can only look at is decoration; the point of the
 * segments is that they are the fastest way into the findings list.
 */

const AXIS = {
  stroke: "var(--color-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const TooltipBox = ({
  active,
  payload,
  suffix,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; payload?: { label?: string } }[];
  suffix?: string;
}): React.ReactElement | null => {
  const entry = payload?.[0];

  if (active !== true || entry === undefined) {
    return null;
  }

  return (
    <div className="rounded-md border border-border-strong bg-surface-2 px-2 py-1 font-mono text-[12px] shadow-lg">
      {entry.payload?.label ?? entry.name} · {String(entry.value)}
      {suffix ?? ""}
    </div>
  );
};

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Horizontal ranking. Used for findings by rule, where labels are long. */
export const RankedBars = ({
  data,
  onSelect,
  height = 220,
}: {
  data: readonly Slice[];
  onSelect?: (key: string) => void;
  height?: number;
}): React.ReactElement => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart
      data={[...data]}
      layout="vertical"
      margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
      barCategoryGap={4}
    >
      <XAxis type="number" {...AXIS} />
      <YAxis type="category" dataKey="label" width={150} {...AXIS} />
      <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--color-surface-2)" }} />
      <Bar
        dataKey="value"
        radius={[0, 3, 3, 0]}
        onClick={(entry: unknown) => {
          const slice = entry as Slice | undefined;
          if (slice?.key !== undefined) {
            onSelect?.(slice.key);
          }
        }}
        className={onSelect === undefined ? undefined : "cursor-pointer"}
      >
        {data.map((slice) => (
          <Cell key={slice.key} fill={slice.color} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

/** Composition. Used for severity, where there are four parts of one whole. */
export const Donut = ({
  data,
  onSelect,
  centre,
  height = 180,
}: {
  data: readonly Slice[];
  onSelect?: (key: string) => void;
  centre?: React.ReactNode;
  height?: number;
}): React.ReactElement => (
  <div className="relative">
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={[...data]}
          dataKey="value"
          nameKey="label"
          innerRadius="62%"
          outerRadius="92%"
          paddingAngle={2}
          stroke="none"
          onClick={(entry: unknown) => {
            const slice = entry as Slice | undefined;
            if (slice?.key !== undefined) {
              onSelect?.(slice.key);
            }
          }}
          className={onSelect === undefined ? undefined : "cursor-pointer"}
        >
          {data.map((slice) => (
            <Cell key={slice.key} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip content={<TooltipBox />} />
      </PieChart>
    </ResponsiveContainer>
    {centre !== undefined && (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {centre}
      </div>
    )}
  </div>
);

/**
 * Distribution of raw values against the kit's ramp.
 *
 * The overlay is the whole point: seeing `13px` standing between `12` and `16` is what
 * makes "off the scale" concrete.
 */
export const ScaleHistogram = ({
  values,
  scale,
  onSelect,
}: {
  values: readonly { px: number; count: number }[];
  scale: readonly number[];
  onSelect?: (px: number) => void;
}): React.ReactElement => {
  const max = Math.max(1, ...values.map((entry) => entry.count));

  return (
    <div className="flex items-end gap-[3px] overflow-x-auto px-1 pb-1 pt-4">
      {values.map((entry) => {
        const onScale = scale.includes(entry.px);

        return (
          <button
            key={entry.px}
            type="button"
            title={`${String(entry.px)}px — ${String(entry.count)}×${onScale ? " · на шкале" : " · вне шкалы"}`}
            onClick={() => {
              onSelect?.(entry.px);
            }}
            className="group flex w-6 shrink-0 flex-col items-center gap-1"
          >
            <span className="text-[10px] tabular-nums text-faint opacity-0 transition-opacity group-hover:opacity-100">
              {entry.count}
            </span>
            <span
              className={cx(
                "w-full rounded-t-sm transition-opacity",
                onScale ? "bg-ok/70" : "bg-warning/70",
              )}
              style={{ height: `${String(Math.max(3, (entry.count / max) * 76))}px` }}
            />
            <span className="font-mono text-[10px] tabular-nums text-faint">{entry.px}</span>
          </button>
        );
      })}
    </div>
  );
};
