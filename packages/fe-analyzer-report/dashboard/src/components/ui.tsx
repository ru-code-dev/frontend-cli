import { useEffect, useState, type ReactNode } from "react";

import type { Severity } from "../data.js";

/**
 * The primitive set.
 *
 * shadcn/ui's visual language, copied in rather than installed — which is what shadcn is
 * anyway. Only the pieces this dashboard uses exist here, so there is no unused surface
 * and no Radix runtime for behaviour we do not need. Anything genuinely interactive
 * (virtualised lists, charts, diffs) uses a real library.
 */

export const cx = (...values: (string | false | null | undefined)[]): string =>
  values.filter(Boolean).join(" ");

export const SEVERITY_CLASS: Record<Severity, string> = {
  error: "text-error border-error/40 bg-error/10",
  warning: "text-warning border-warning/40 bg-warning/10",
  info: "text-info border-info/40 bg-info/10",
  candidate: "text-candidate border-candidate/40 bg-candidate/10",
};

export const SEVERITY_DOT: Record<Severity, string> = {
  error: "bg-error",
  warning: "bg-warning",
  info: "bg-info",
  candidate: "bg-candidate",
};

export const Dot = ({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}): React.ReactElement => (
  <span
    className={cx("inline-block size-2 shrink-0 rounded-full", SEVERITY_DOT[severity], className)}
  />
);

export const Card = ({
  children,
  className,
  as: Element = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}): React.ReactElement => (
  <Element
    className={cx("rounded-[var(--radius-card)] border border-border bg-surface/80", className)}
  >
    {children}
  </Element>
);

export const CardHeader = ({
  title,
  hint,
  right,
}: {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
}) => (
  <header className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3">
    <div className="min-w-0">
      <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
      {hint !== undefined && <p className="mt-0.5 text-[12px] leading-snug text-faint">{hint}</p>}
    </div>
    {right}
  </header>
);

export const Badge = ({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Severity | "neutral" | "ok" | "accent";
  className?: string;
  title?: string;
}): React.ReactElement => {
  const toneClass =
    tone === "neutral"
      ? "text-muted border-border bg-surface-2"
      : tone === "ok"
        ? "text-ok border-ok/40 bg-ok/10"
        : tone === "accent"
          ? "text-accent border-accent/40 bg-accent/10"
          : SEVERITY_CLASS[tone];

  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
};

export const Button = ({
  children,
  onClick,
  active,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  className?: string;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cx(
      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors",
      active
        ? "border-accent/50 bg-accent/15 text-fg"
        : "border-border bg-transparent text-muted hover:border-border-strong hover:text-fg",
      className,
    )}
  >
    {children}
  </button>
);

/** Copy-to-clipboard with the confirmation the user asked for on every suggestion. */
export const CopyButton = ({
  value,
  label = "Копировать",
}: {
  value: string;
  label?: string;
}): React.ReactElement => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
          },
          () => {
            // Clipboard access can be denied when the file is opened from disk under a
            // strict policy. Saying so beats a button that silently does nothing.
            window.prompt("Скопируйте вручную:", value);
          },
        );
      }}
      active={copied}
      title={value}
    >
      {copied ? "✓ Скопировано" : label}
    </Button>
  );
};

/**
 * Class names are written out rather than composed.
 *
 * Tailwind extracts classes by scanning source text, so `bg-${tone}` is invisible to it
 * and would ship a bar with no colour.
 */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const METER_TONE = {
  accent: "bg-accent",
  info: "bg-info",
  ok: "bg-ok",
  warning: "bg-warning",
  error: "bg-error",
} as const;

export const Meter = ({
  value,
  tone = "accent",
}: {
  value: number;
  tone?: keyof typeof METER_TONE;
}): React.ReactElement => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
    <div
      className={cx("h-full rounded-full transition-[width] duration-500", METER_TONE[tone])}
      style={{ width: `${String(Math.round(clamp01(value) * 100))}%` }}
    />
  </div>
);

/**
 * A headline metric. Always interactive: a number the reader cannot click to see its
 * makeup is a number they will argue with instead.
 */
export const MetricCard = ({
  label,
  value,
  detail,
  meter,
  tone,
  onClick,
  title,
}: {
  label: string;
  value: ReactNode;
  /** One line in plain words: what the number is made of. */
  detail: ReactNode;
  meter?: number;
  tone?: keyof typeof METER_TONE;
  onClick?: () => void;
  title?: string;
}): React.ReactElement => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cx(
      "flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border border-border bg-surface/80 px-4 py-3 text-left transition-colors",
      onClick !== undefined
        ? "cursor-pointer hover:border-border-strong hover:bg-surface-2/60"
        : "cursor-default",
    )}
  >
    <span className="text-[12px] font-medium tracking-wide text-muted">{label}</span>
    <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">
      {value}
    </span>
    {meter !== undefined && <Meter value={meter} tone={tone} />}
    <span className="text-[12px] leading-snug text-faint">{detail}</span>
  </button>
);

/** The health ring — draws itself on load, colour follows the score. */
export const HealthRing = ({
  score,
  size = 132,
}: {
  score: number;
  size?: number;
}): React.ReactElement => {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp01(score / 100));
  const tone =
    score >= 75 ? "var(--color-ok)" : score >= 45 ? "var(--color-warning)" : "var(--color-error)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-2)"
          strokeWidth={stroke}
        />
        <circle
          className="ds-ring"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={
            {
              "--ds-ring-circumference": `${String(circumference)}px`,
              "--ds-ring-offset": `${String(offset)}px`,
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[32px] font-semibold leading-none tabular-nums">{score}</span>
        <span className="mt-1 text-[11px] tracking-wide text-faint">из 100</span>
      </div>
    </div>
  );
};

/**
 * Selection checkbox for the PR flow. Only rendered next to auto-fixable items, so the
 * presence of the control is itself the "this can go into a PR" signal.
 */
export const Checkbox = ({
  checked,
  onToggle,
  title = "Выбрать для PR",
}: {
  checked: boolean;
  onToggle: () => void;
  title?: string;
}): React.ReactElement => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    title={title}
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    className={cx(
      "flex size-[18px] shrink-0 items-center justify-center rounded border transition-colors",
      checked
        ? "border-accent bg-accent text-bg"
        : "border-border-strong bg-transparent text-transparent hover:border-accent/70",
    )}
  >
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 6.5 4.7 9 10 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </button>
);

/** An empty list must explain itself and offer the way out — a silent void reads as a bug. */
export const EmptyState = ({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}): React.ReactElement => (
  <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
    <p className="text-[13px] text-muted">{children}</p>
    {action !== undefined && onAction !== undefined && (
      <Button onClick={onAction} className="border-accent/50 text-accent hover:text-accent">
        {action}
      </Button>
    )}
  </div>
);

/** Collapsed-by-default section for the report's appendices. */
export const Disclosure = ({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}): React.ReactElement => (
  <details
    open={defaultOpen}
    className="group rounded-[var(--radius-card)] border border-border bg-surface/80 open:pb-1"
  >
    <summary className="cursor-pointer select-none px-4 py-3 text-[14px] font-medium text-muted transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
      <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
      {summary}
    </summary>
    {children}
  </details>
);
