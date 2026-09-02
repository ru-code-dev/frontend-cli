import { useMemo, useState } from "react";

import { Highlighted } from "../components/FindingCard.js";
import { ScaleHistogram } from "../components/charts.js";
import {
  Badge,
  Card,
  CardHeader,
  CopyButton,
  Disclosure,
  EmptyState,
  cx,
} from "../components/ui.js";
import {
  NAME_MATCH_LABEL,
  TOKEN_VERDICT_LABEL,
  VERDICT_LABEL,
  subkindLabel,
  type CustomComponent,
  type Finding,
  type Payload,
  type Usage,
} from "../data.js";
import { kitDataOf } from "../lib/kit.js";
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

const KIND_TONE = {
  exact: "error",
  near: "warning",
  shade: "info",
  foreign: "warning",
} as const;

const swatchesFrom = (
  payload: Payload,
): { value: string; token: string | null; kind: string; count: number }[] => {
  const byValue = new Map<
    string,
    { value: string; token: string | null; kind: string; count: number }
  >();

  for (const finding of payload.findings) {
    if (finding.rule !== "token.literal.color") {
      continue;
    }
    const existing = byValue.get(finding.actual);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byValue.set(finding.actual, {
      value: finding.actual,
      token: finding.expected?.token ?? null,
      kind: finding.subkind ?? "foreign",
      count: 1,
    });
  }

  return [...byValue.values()].sort((left, right) => right.count - left.count);
};

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

const dimensionsFrom = (payload: Payload): { px: number; count: number }[] => {
  const byPx = new Map<number, number>();

  for (const finding of payload.findings) {
    if (finding.rule !== "token.literal.dimension") {
      continue;
    }
    const px = Number.parseFloat(finding.actual);
    if (Number.isFinite(px)) {
      byPx.set(px, (byPx.get(px) ?? 0) + 1);
    }
  }

  return [...byPx.entries()]
    .map(([px, count]) => ({ px, count }))
    .sort((left, right) => left.px - right.px);
};

/**
 * A custom component, side by side with what the kit offers.
 *
 * The right column is honest about its own maturity: the name-based match is labelled a
 * heuristic, and the replacement-code block states that it arrives with the AI stage (M5)
 * instead of pretending an empty box is content.
 */
const CustomComponentCard = ({
  component,
  finding,
  navigate,
}: {
  component: CustomComponent;
  /** The component-rule finding for this declaration, when the scorer produced one. */
  finding: Finding | null;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const [showCode, setShowCode] = useState(false);

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-surface/80">
      <header
        className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5"
        onClick={() => {
          setShowCode((previous) => !previous);
        }}
      >
        <span
          className={cx("text-[12px] text-faint transition-transform", showCode && "rotate-90")}
        >
          ›
        </span>
        <span className="font-mono text-[13.5px] font-medium">{component.name}</span>
        {component.hasInlineSvg && <Badge tone="candidate">inline-svg</Badge>}
        {component.nameMatch !== null && (
          <Badge tone={component.nameMatch.kind === "exact" ? "error" : "warning"}>
            ≈ {component.nameMatch.component}
          </Badge>
        )}
        <Badge
          tone={
            component.tokenVerdict === "tokens"
              ? "ok"
              : component.tokenVerdict === "mixed"
                ? "warning"
                : component.tokenVerdict === "hardcode"
                  ? "error"
                  : "neutral"
          }
          title={`токенов: ${String(component.tokenRefs)} · хардкода: ${String(component.hardcodedValues)} — свой файл + импортированные стили`}
        >
          {TOKEN_VERDICT_LABEL[component.tokenVerdict]}
          {component.tokenVerdict !== "no-styles" &&
            ` · ${String(component.tokenRefs)} var / ${String(component.hardcodedValues)}`}
        </Badge>
        <span className="ml-auto flex items-center gap-2 text-[12px] text-muted">
          <span className="tabular-nums">
            {component.usages}× · {component.files} ф.
          </span>
          <span className="hidden font-mono text-[11px] text-faint md:inline">
            {component.file}:{component.line}
          </span>
        </span>
      </header>

      {showCode && (
        <div className="ds-enter border-t border-border">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="border-b border-border px-4 py-2 text-[12px] text-faint">
                Текущий код · {component.file}:{component.line}
              </div>
              {component.snippetHtml.length > 0 ? (
                <Highlighted html={component.snippetHtml} />
              ) : component.snippet.length > 0 ? (
                // Highlighting is capped generator-side on huge reports; the code still ships.
                <pre className="overflow-x-auto px-4 py-2 font-mono text-[12.5px] leading-relaxed text-muted">
                  {component.snippet}
                </pre>
              ) : (
                <p className="px-4 py-3 text-[12.5px] text-faint">Код не был извлечён.</p>
              )}
            </div>

            <div className="min-w-0 border-t border-border lg:border-l lg:border-t-0">
              <div className="border-b border-border px-4 py-2 text-[12px] text-faint">
                Что предлагает кит
              </div>
              <div className="space-y-2.5 p-4 text-[12.5px] leading-relaxed">
                {finding !== null ? (
                  <>
                    <p className="text-muted">{finding.why}</p>
                    {finding.candidates.length > 0 && (
                      <div className="space-y-1.5">
                        {finding.candidates.map((candidate) => (
                          <div key={candidate.component} className="flex items-center gap-2.5">
                            <span className="w-28 shrink-0 truncate font-mono text-fg">
                              {candidate.component}
                            </span>
                            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className="block h-full rounded-full bg-accent/80"
                                style={{
                                  width: `${String(Math.round(Math.min(1, candidate.score) * 100))}%`,
                                }}
                              />
                            </span>
                            <span className="w-10 shrink-0 tabular-nums text-[12px] text-faint">
                              {candidate.score.toFixed(2)}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-[12px] text-muted"
                              title={candidate.reasons.join("; ")}
                            >
                              {candidate.reasons.join("; ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : component.nameMatch !== null ? (
                  <>
                    <p>
                      <span className="font-mono text-fg">{component.nameMatch.component}</span>{" "}
                      <span className="text-muted">
                        — {NAME_MATCH_LABEL[component.nameMatch.kind]}.
                      </span>
                    </p>
                    <p className="text-muted">
                      Это эвристика по имени, а не доказательство дубля: сверьте пропы и поведение.
                    </p>
                  </>
                ) : (
                  <p className="text-muted">
                    Похожего компонента в ките нет. Если он нужен ещё где-то — это кандидат на
                    добавление в дизайн-систему.
                  </p>
                )}

                {component.props.length > 0 && (
                  <p className="text-muted">
                    <span className="text-faint">Пропы:</span>{" "}
                    <span className="font-mono text-[12px]">{component.props.join(", ")}</span>
                  </p>
                )}
                {component.kitComponentsUsed.length > 0 && (
                  <p className="text-muted">
                    <span className="text-faint">Собран из кита:</span>{" "}
                    <span className="font-mono text-[12px]">
                      {component.kitComponentsUsed.join(", ")}
                    </span>
                  </p>
                )}

                <div className="rounded-md border border-dashed border-border-strong px-3 py-2.5 text-faint">
                  Готовый код замены соберёт ИИ-этап (M6) — статический скоринг по имени, ARIA,
                  пропам и структуре уже отработал.
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <CopyButton value={`${component.file}:${String(component.line)}`} label="Путь" />
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-fg"
                    onClick={() => {
                      navigate({ screen: "files", file: component.file });
                    }}
                  >
                    Отклонения файла →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

/**
 * THE KIT HALF OF THIS SCREEN, AND WHY IT IS FOUR COMPONENTS.
 *
 * Everything below down to {@link DesignScreen} is restored from the hackathon source
 * (`hackathon2026/ds-analyzer/dashboard/src/screens/Design.tsx`) and is character-identical to
 * it modulo this repo's formatter and one level of indentation. It renders only when the report
 * carries adapter-domain data (`../lib/kit.ts`).
 *
 * The source computed its custom-component filter state and its six `usage.*` derivations at the
 * top of one 520-line screen. A conditional cannot wrap a `useState`/`useMemo`, so the panels
 * that own those computations are lifted into components of their own, each holding the source's
 * own derivations beside the source's own markup. The alternative — rewriting each derivation to
 * tolerate an absent `usage` — would have edited every one of those lines instead of moving them.
 */

const KitCustomComponents = ({
  usage,
  componentFindings,
  navigate,
}: {
  usage: Usage;
  componentFindings: ReadonlyMap<string, Finding>;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  // Token-verdict filter for the custom list; `null` shows everything.
  const [tokenFilter, setTokenFilter] = useState<CustomComponent["tokenVerdict"] | null>(null);
  const filteredCustoms = usage.customComponents.filter(
    (component) => tokenFilter === null || component.tokenVerdict === tokenFilter,
  );
  const kitLike = filteredCustoms.filter((component) => component.verdict === "kit-like");
  const candidates = filteredCustoms.filter((component) => component.verdict === "kit-candidate");
  const locals = filteredCustoms.filter((component) => component.verdict === "local");

  const styled = usage.customComponents.filter(
    (component) => component.tokenVerdict !== "no-styles",
  );
  const onTokens = usage.customComponents.filter(
    (component) => component.tokenVerdict === "tokens",
  );

  // Custom components — the part the ds team scrolls to first.
  return (
    <Card>
      <CardHeader
        title="Кастомные компоненты"
        hint={`написаны в проекте руками; «≈ Имя» — похоже, кит это уже умеет. Со стилями: ${String(styled.length)}, из них на токенах ДС — ${String(onTokens.length)}${styled.length > 0 ? ` (${String(Math.round((onTokens.length / styled.length) * 100))}%)` : ""}.`}
      />
      {usage.customComponents.length === 0 ? (
        <EmptyState>Заметных кастомных компонентов не найдено.</EmptyState>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setTokenFilter(null);
              }}
              className={cx(
                "rounded-full border px-3 py-1 text-[12px] transition-colors",
                tokenFilter === null
                  ? "border-accent/60 bg-accent/15 text-fg"
                  : "border-border text-muted hover:border-border-strong hover:text-fg",
              )}
            >
              все {usage.customComponents.length}
            </button>
            {(["tokens", "mixed", "hardcode", "no-styles"] as const).map((verdict) => {
              const count = usage.customComponents.filter(
                (component) => component.tokenVerdict === verdict,
              ).length;
              if (count === 0) {
                return null;
              }
              return (
                <button
                  key={verdict}
                  type="button"
                  onClick={() => {
                    setTokenFilter((previous) => (previous === verdict ? null : verdict));
                  }}
                  className={cx(
                    "rounded-full border px-3 py-1 text-[12px] transition-colors",
                    tokenFilter === verdict
                      ? "border-accent/60 bg-accent/15 text-fg"
                      : "border-border text-muted hover:border-border-strong hover:text-fg",
                  )}
                >
                  {TOKEN_VERDICT_LABEL[verdict]} {count}
                </button>
              );
            })}
          </div>
          {kitLike.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[12px] font-medium tracking-wide text-warning">
                Похожи на компоненты кита — проверить на дубль ({kitLike.length})
              </h3>
              {kitLike.map((component) => (
                <CustomComponentCard
                  key={component.name}
                  component={component}
                  finding={componentFindings.get(component.name) ?? null}
                  navigate={navigate}
                />
              ))}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[12px] font-medium tracking-wide text-candidate">
                Кандидаты на добавление в дизайн-систему ({candidates.length})
              </h3>
              {candidates.map((component) => (
                <CustomComponentCard
                  key={component.name}
                  component={component}
                  finding={componentFindings.get(component.name) ?? null}
                  navigate={navigate}
                />
              ))}
            </div>
          )}

          {locals.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-[12px] font-medium tracking-wide text-faint">
                {VERDICT_LABEL.local} ({locals.length})
              </h3>
              {locals.map((component) => (
                <CustomComponentCard
                  key={component.name}
                  component={component}
                  finding={componentFindings.get(component.name) ?? null}
                  navigate={navigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const KitTokenPanels = ({
  payload,
  navigate,
}: {
  payload: Payload;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const swatches = useMemo(() => swatchesFrom(payload), [payload]);
  const dimensions = useMemo(() => dimensionsFrom(payload), [payload]);

  return (
    <>
      <Card>
        <CardHeader
          title="Палитра мимо токенов"
          hint="цвета, написанные литералом, и токен, которым их надо было записать; клик — все места в плане"
        />
        {swatches.length === 0 ? (
          <EmptyState>Сырых цветов нет — палитра целиком на токенах.</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
            {swatches.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                onClick={() => {
                  navigate({
                    screen: "problems",
                    rule: "token.literal.color",
                    value: swatch.value,
                  });
                }}
                className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/50 px-2.5 py-2 text-left transition-colors hover:border-border-strong"
              >
                <span
                  className="size-9 shrink-0 rounded-md border border-border-strong"
                  style={{ background: swatch.value }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px]">{swatch.value}</span>
                  <span className="block truncate font-mono text-[11px] text-faint">
                    {swatch.token ?? "близкого токена нет"}
                  </span>
                </span>
                <Badge tone={KIND_TONE[swatch.kind as keyof typeof KIND_TONE] ?? "neutral"}>
                  {subkindLabel(swatch.kind)}
                </Badge>
                <span className="shrink-0 tabular-nums text-[12px] text-muted">
                  {swatch.count}×
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Размеры против шкалы кита"
          hint="зелёное — значение есть на шкале, жёлтое — нет; клик показывает все места"
        />
        {dimensions.length === 0 ? (
          <EmptyState>Сырых размеров не найдено.</EmptyState>
        ) : (
          <ScaleHistogram
            values={dimensions}
            scale={[0, 2, 4, 8, 10, 12, 14, 16, 18, 20, 24, 30, 32, 36, 38, 46, 48]}
            onSelect={(px) => {
              navigate({
                screen: "problems",
                rule: "token.literal.dimension",
                query: `${String(px)}px`,
              });
            }}
          />
        )}
      </Card>
    </>
  );
};

const KitTokenUsage = ({ usage }: { usage: Usage }): React.ReactElement => {
  const topTokens = Object.entries(usage.tokenUsage)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);

  return (
    <Card>
      <CardHeader
        title="Самые используемые токены"
        hint="обращения через var(--…) — то, что уже делается правильно"
      />
      {topTokens.length === 0 ? (
        <EmptyState>Ни одного обращения к токенам через CSS-переменные.</EmptyState>
      ) : (
        <ul className="p-3">
          {topTokens.map(([token, count]) => {
            const max = topTokens[0]?.[1] ?? 1;

            return (
              <li key={token} className="flex items-center gap-2.5 px-1 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{token}</span>
                <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-ok/70"
                    style={{ width: `${String(Math.max(4, (count / max) * 100))}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-[12px] text-muted">
                  {count}×
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

const KitComponentsColumn = ({
  usage,
  state,
  go,
  navigate,
}: {
  usage: Usage;
  state: ViewState;
  go: (patch: Partial<ViewState>) => void;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const selected = usage.components.find((component) => component.name === state.component) ?? null;
  const thirdParty = usage.foreignComponents.filter((component) => !component.local);

  return (
    <div className="min-w-0 space-y-3">
      <Card>
        <CardHeader
          title="Компоненты кита в проекте"
          hint={`${String(usage.components.length)} используется · ${String(usage.unusedComponents.length)} ни разу; клик — какие пропы и варианты реально нужны`}
        />
        <ul className="max-h-[420px] overflow-y-auto">
          {usage.components.map((component) => (
            <li key={component.name} className="border-t border-border/60 first:border-t-0">
              <button
                type="button"
                onClick={() => {
                  go({
                    component: state.component === component.name ? null : component.name,
                  });
                }}
                className={cx(
                  "flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors",
                  state.component === component.name ? "bg-surface-2" : "hover:bg-surface-2/50",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{component.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {component.files} ф.
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-[12.5px]">
                  {component.usages}×
                </span>
                {component.overrides > 0 && (
                  <Badge tone="warning">{component.overrides} перекр.</Badge>
                )}
                {component.findings === 0 ? (
                  <Badge tone="ok">чисто</Badge>
                ) : (
                  <Badge tone="warning">{component.findings}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selected !== null && (
        <Card className="ds-enter">
          <CardHeader
            title={selected.name}
            hint={`${String(selected.usages)} использований в ${String(selected.files)} файлах`}
            right={
              <button
                type="button"
                className="shrink-0 text-[13px] text-accent transition-colors hover:text-fg"
                onClick={() => {
                  navigate({ screen: "problems", component: selected.name });
                }}
              >
                отклонения →
              </button>
            }
          />
          <div className="space-y-3 p-4">
            {Object.entries(selected.props).length === 0 ? (
              <p className="text-[12.5px] text-faint">Пропы с вариантами не использовались.</p>
            ) : (
              Object.entries(selected.props).map(([prop, values]) => {
                const total = Object.values(values).reduce((sum, count) => sum + count, 0);

                return (
                  <div key={prop}>
                    <div className="mb-1 font-mono text-[12px] text-muted">{prop}</div>
                    <div className="space-y-1">
                      {Object.entries(values)
                        .sort((left, right) => right[1] - left[1])
                        .map(([value, count]) => (
                          <div key={value} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 truncate font-mono text-[12px]">
                              {value}
                            </span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className="block h-full rounded-full bg-info"
                                style={{ width: `${String((count / total) * 100)}%` }}
                              />
                            </span>
                            <span className="w-8 shrink-0 text-right tabular-nums text-[12px] text-faint">
                              {count}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}

      {thirdParty.length > 0 && (
        <Card>
          <CardHeader
            title="Сторонние компоненты"
            hint="импортированы из чужих пакетов — каждый из них конкурирует с китом"
          />
          <ul className="p-3">
            {thirdParty.slice(0, 20).map((component) => (
              <li key={component.name} className="flex items-center gap-2 px-1 py-1 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-mono">{component.name}</span>
                {component.source !== null && (
                  <span className="min-w-0 truncate font-mono text-[11px] text-faint">
                    {component.source}
                  </span>
                )}
                <span className="w-9 shrink-0 text-right tabular-nums text-muted">
                  {component.usages}×
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {usage.unusedComponents.length > 0 && (
        <Disclosure
          summary={
            <>
              Компоненты кита, не использованные ни разу{" "}
              <span className="tabular-nums text-faint">({usage.unusedComponents.length})</span>
            </>
          }
        >
          <div className="flex flex-wrap gap-1.5 border-t border-border p-4">
            {usage.unusedComponents.map((name) => (
              <Badge key={name}>{name}</Badge>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
};

export const DesignScreen = ({
  payload,
  state,
  go,
  navigate,
}: {
  payload: Payload;
  state: ViewState;
  go: (patch: Partial<ViewState>) => void;
  navigate: (patch: Partial<ViewState>) => void;
}): React.ReactElement => {
  const iconGroups = useMemo(() => iconGroupsFrom(payload), [payload]);

  // The scorer's verdict per local component, for the custom-component cards.
  const componentFindings = useMemo(() => {
    const byName = new Map<string, Finding>();
    for (const finding of payload.findings) {
      if (finding.category === "component" && !byName.has(finding.actual)) {
        byName.set(finding.actual, finding);
      }
    }
    return byName;
  }, [payload]);

  const novel = useMemo(
    () =>
      payload.findings.filter(
        (finding) => finding.rule === "component.novel" || finding.rule === "component.duplicate",
      ),
    [payload],
  );

  // THE GATE — see `../lib/kit.ts`. `null` on a report produced without a design-system
  // adapter, and every kit panel is written as "kit present" so the adapter-less render is the
  // pre-existing one. The two wrappers below carry their grid classes only in the kit case, so
  // without one the icons card sits alone in a plain block exactly as it did before.
  const kit = kitDataOf(payload);

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

        {kit !== null && (
          <KitCustomComponents
            usage={kit.usage}
            componentFindings={componentFindings}
            navigate={navigate}
          />
        )}

        <div className={cx(kit !== null && "grid grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]")}>
          <div className={cx(kit !== null && "min-w-0 space-y-3")}>
            {kit !== null && <KitTokenPanels payload={payload} navigate={navigate} />}

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
                          <span className="block truncate font-mono text-[12px]">
                            {group.label}
                          </span>
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

            {kit !== null && <KitTokenUsage usage={kit.usage} />}
          </div>

          {kit !== null && (
            <KitComponentsColumn usage={kit.usage} state={state} go={go} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
};
