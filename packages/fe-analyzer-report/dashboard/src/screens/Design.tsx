import { useMemo } from "react";

import { Badge, Card, CardHeader, EmptyState } from "../components/ui.js";
import type { Payload } from "../data.js";
import type { ViewState } from "../lib/url-state.js";

/**
 * The kit's-eye view.
 *
 * The other screens answer "what is wrong in this code". This one answers the questions
 * the design-system team asks instead: which components does the product actually use and
 * with which variants, what has it built by hand that the kit already has, what has it
 * built that the kit *should* have, which colours does it keep reaching for, where do its
 * raw sizes sit against the ramps. Every row leads back into the work plan.
 */

/** Re-renders a kit icon from its normalized shape list (`kind:data`). */
const IconGlyph = ({
  viewBox,
  shapes,
  size = 28,
}: {
  viewBox: string | null;
  shapes: readonly string[];
  size?: number;
}): React.ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox ?? "0 0 16 16"}
    fill="currentColor"
    aria-hidden
    className="shrink-0 text-fg"
  >
    {shapes.map((shape, index) => {
      const separator = shape.indexOf(":");
      const kind = shape.slice(0, separator);
      const data = shape.slice(separator + 1);
      const key = `${String(index)}:${kind}`;
      const numbers = data.split(" ");

      switch (kind) {
        case "path":
          return <path key={key} d={data} fillRule="evenodd" />;
        case "circle":
          return <circle key={key} cx={numbers[0]} cy={numbers[1]} r={numbers[2]} />;
        case "rect":
          return (
            <rect
              key={key}
              x={numbers[0]}
              y={numbers[1]}
              width={numbers[2]}
              height={numbers[3]}
              rx={numbers[4]}
            />
          );
        case "ellipse":
          return (
            <ellipse key={key} cx={numbers[0]} cy={numbers[1]} rx={numbers[2]} ry={numbers[3]} />
          );
        case "line":
          return (
            <line
              key={key}
              x1={numbers[0]}
              y1={numbers[1]}
              x2={numbers[2]}
              y2={numbers[3]}
              stroke="currentColor"
            />
          );
        case "polyline":
        case "polygon":
          return kind === "polygon" ? (
            <polygon key={key} points={data} />
          ) : (
            <polyline key={key} points={data} />
          );
        default:
          return null;
      }
    })}
  </svg>
);

interface IconGroup {
  key: string;
  rule: string;
  subkind: string | null;
  /** Kit icon name for matches; the reference or `<svg>` otherwise. */
  label: string;
  kitIcon: string | null;
  count: number;
  files: number;
}

const iconGroupsFrom = (payload: Payload): IconGroup[] => {
  const byKey = new Map<string, IconGroup>();

  for (const finding of payload.findings) {
    if (finding.category !== "icon") {
      continue;
    }
    const existing = byKey.get(finding.impactKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(finding.impactKey, {
      key: finding.impactKey,
      rule: finding.rule,
      subkind: finding.subkind,
      label: finding.expected?.component ?? finding.actual,
      kitIcon: finding.expected?.component ?? null,
      count: 1,
      files: finding.impact.files,
    });
  }

  return [...byKey.values()].sort((left, right) => right.count - left.count);
};

export const DesignScreen = ({
  payload,
  navigate,
}: {
  payload: Payload;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const iconGroups = useMemo(() => iconGroupsFrom(payload), [payload]);

  const novel = useMemo(
    () =>
      payload.findings.filter(
        (finding) => finding.rule === "component.novel" || finding.rule === "component.duplicate",
      ),
    [payload],
  );

  return (
    <div className="ds-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-5">
        <p className="text-[13px] leading-relaxed text-muted">
          Взгляд со стороны дизайн-системы: что из кита проект использует и как, что собрал руками
          вместо кита, и что кит мог бы забрать себе. Каждая строка ведёт в план работ или в файл.
        </p>

        {novel.length > 0 && (
          <Card>
            <CardHeader
              title="Кандидаты в дизайн-систему"
              hint="компоненты без аналога в ките, которые проект переиспользует или уже дублирует — выход для команды кита, а не претензия к продукту"
            />
            <ul>
              {novel.map((finding) => (
                <li key={finding.id} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigate({ screen: "problems", group: finding.impactKey });
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  >
                    <Badge tone="candidate" className="mt-0.5">
                      {finding.rule === "component.duplicate" ? "дубли" : "кандидат"}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[13px] font-medium">
                        {finding.actual}
                      </span>
                      <span className="block text-[12.5px] leading-relaxed text-muted">
                        {finding.why}
                      </span>
                      {finding.note !== null && (
                        <span className="block text-[11.5px] text-faint">{finding.note}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">
                      {finding.file}:{finding.line}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Иконки мимо кита"
            hint="совпадение — по точной геометрии рисунка; такие иконки в ките уже есть. Без пары — кандидаты в набор."
          />
          {iconGroups.length === 0 ? (
            <EmptyState>Все иконки проекта — из кита.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
              {iconGroups.map((group) => {
                const preview =
                  group.kitIcon === null ? undefined : payload.iconPreviews[group.kitIcon];

                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => {
                      navigate({ screen: "problems", group: group.key });
                    }}
                    className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/50 px-2.5 py-2 text-left transition-colors hover:border-border-strong"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border-strong bg-bg">
                      {preview !== undefined ? (
                        <IconGlyph viewBox={preview.viewBox} shapes={preview.shapes} />
                      ) : (
                        <span className="text-[16px] text-faint">?</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px]">{group.label}</span>
                      <span className="block truncate text-[11px] text-faint">
                        {group.rule === "icon.foreign-pack"
                          ? "сторонний пакет иконок"
                          : group.subkind === "kit-icon"
                            ? "есть в ките — заменить"
                            : "нет в ките — кандидат"}
                      </span>
                    </span>
                    <Badge
                      tone={
                        group.subkind === "kit-icon" || group.rule === "icon.foreign-pack"
                          ? "warning"
                          : "candidate"
                      }
                    >
                      {group.count}×
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
