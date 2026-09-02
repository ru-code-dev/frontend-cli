import { useMemo, useState } from "react";

import {
  CATEGORY_LABEL,
  FROM_FILE_LABEL,
  LEVEL_LABEL,
  ruleLabel,
  type Finding,
  type RuleCatalogEntry,
  type RuleConfig,
  type RuleLevel,
} from "../data.js";
import {
  CATEGORIES,
  INHERIT_OPTION,
  RULE_LEVELS,
  catalogByCategory,
  resolveLevel,
  tallyFindings,
  withOverride,
  type LevelChoice,
  type RuleOverrides,
  type RuleTally,
} from "../lib/rule-config.js";
import { Badge, Button, cx } from "./ui.js";

/**
 * «ПРАВИЛА» — the config, as a drawer.
 *
 * The report embeds every raw finding plus the config it was summarised under (design D10/D11),
 * which makes one question answerable that no static report could answer before: *what did the
 * file hide from me?* This panel is that question's UI. Every row shows the level in force, and
 * changing one recounts the whole dashboard live — the counters, the nav badges, the charts —
 * because nothing was thrown away at generation time.
 *
 * Three principles the layout follows:
 *
 *  - **Nothing is invisible.** Every row states its effective level, and a row that inherits it
 *    says where from («наследует: …»). A dropdown showing `error` because a category above it
 *    said so, with no way to tell, is the same trap as an unlabelled filter.
 *  - **Hidden findings are counted, not erased.** Each row carries `visible / hidden`. "0
 *    problems" and "0 shown, 14 hidden" are different sentences and the reader is owed the
 *    right one.
 *  - **The file is the baseline, not the ceiling.** «сбросить к файлу» is always one click away,
 *    and the header names the file so a reader knows what they are resetting *to*.
 *
 * A drawer rather than a sixth screen: changing a rule is something you do *while* looking at a
 * list, and the effect on the list behind it is the feedback.
 */

/**
 * One `<select>` of the six levels, led by «как в файле» — the whole control surface of this
 * panel.
 *
 * The FIRST option is the undo: picking it drops this row's override so the report's own config
 * decides again. It is never the SELECTED option — `value` is always the level actually in
 * force, which is what the reader needs to see — it is the entry you choose to go back. That
 * asymmetry is deliberate: a row showing «как в файле» instead of «Ошибка» would hide the very
 * fact the panel exists to show (V4 audit finding 3).
 */
const LevelSelect = ({
  value,
  onChange,
  label,
}: {
  value: RuleLevel;
  onChange: (choice: LevelChoice) => void;
  label: string;
}): React.ReactElement => (
  <select
    aria-label={label}
    value={value}
    onChange={(event) => {
      onChange(event.target.value as LevelChoice);
    }}
    className={cx(
      "shrink-0 rounded-md border px-1.5 py-0.5 text-[11.5px] transition-colors",
      value === "off"
        ? "border-border bg-surface-2 text-faint"
        : "border-border bg-surface-2 text-fg hover:border-border-strong",
    )}
  >
    <option value={INHERIT_OPTION}>{FROM_FILE_LABEL}</option>
    {RULE_LEVELS.map((level) => (
      <option key={level} value={level}>
        {LEVEL_LABEL[level]}
      </option>
    ))}
  </select>
);

const EMPTY_TALLY: RuleTally = { visible: 0, hidden: 0 };

/** `12 / 3 скрыто`, or nothing at all when this rule produced nothing. */
const Tally = ({ tally }: { tally: RuleTally }): React.ReactElement | null => {
  if (tally.visible === 0 && tally.hidden === 0) {
    return null;
  }

  return (
    <span className="shrink-0 tabular-nums text-[11px] text-faint">
      {tally.visible}
      {tally.hidden > 0 && <span className="text-warning"> · {tally.hidden} скрыто</span>}
    </span>
  );
};

/** «наследует: Ошибка» — shown only on a row that has no level of its own. */
const Inherited = ({ level }: { level: RuleLevel }): React.ReactElement => (
  <span className="shrink-0 text-[11px] text-faint">наследует: {LEVEL_LABEL[level]}</span>
);

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <span className={cx("w-3 shrink-0 text-[10px] text-faint", open && "text-muted")}>
    {open ? "▾" : "▸"}
  </span>
);

export const RulesPanel = ({
  fileConfig,
  config,
  catalog,
  findings,
  overrides,
  onOverridesChange,
  onClose,
}: {
  /** What the generator's file said — the baseline «сбросить к файлу» returns to. */
  fileConfig: RuleConfig;
  /** `fileConfig` with the reader's flips merged in: what every row displays. */
  config: RuleConfig;
  catalog: RuleCatalogEntry[];
  /** RAW findings, before the config — the only set that can count what is hidden. */
  findings: Finding[];
  overrides: RuleOverrides;
  onOverridesChange: (next: RuleOverrides) => void;
  onClose: () => void;
}): React.ReactElement => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const tally = useMemo(() => tallyFindings(findings, config), [findings, config]);
  const grouped = useMemo(() => catalogByCategory(catalog, findings), [catalog, findings]);

  const source = config.source;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* The backdrop is a button so a click outside closes the drawer, like Esc does. */}
      <button
        type="button"
        aria-label="Закрыть панель правил"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-bg/60 backdrop-blur-[1px]"
      />

      <aside className="relative flex h-full w-[min(30rem,100vw)] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Правила</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] text-muted transition-colors hover:text-fg"
            >
              закрыть · Esc
            </button>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-faint">
            Отчёт хранит все находки целиком. Здесь вы меняете только то, что показано, — цифры
            пересчитываются сразу, файл отчёта не меняется.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-faint">конфиг</span>
            {source.kind === "file" ? (
              <code
                title={source.path}
                className="max-w-64 truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px]"
              >
                {source.path}
              </code>
            ) : (
              <span className="text-[12px] text-muted">встроенные значения по умолчанию</span>
            )}
            <Button
              className="ml-auto"
              onClick={() => {
                onOverridesChange({ categories: {}, rules: {} });
              }}
              title="Вернуть все уровни к тому, что задано конфигом отчёта"
            >
              сбросить к файлу
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* The default: the level everything falls back to when nothing more specific applies. */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="w-3 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="text-[13px] font-medium">По умолчанию</span>
              <span className="ml-2 font-mono text-[11px] text-faint">*</span>
            </span>
            {overrides.default !== undefined && (
              <Badge tone="accent" title={`в файле: ${LEVEL_LABEL[fileConfig.default]}`}>
                изменено
              </Badge>
            )}
            <LevelSelect
              label="Уровень по умолчанию"
              value={config.default}
              onChange={(choice) => {
                onOverridesChange(withOverride(overrides, { kind: "default" }, choice));
              }}
            />
          </div>

          {CATEGORIES.map((category) => {
            const rules = grouped.get(category) ?? [];
            const categoryTally = tally.byCategory.get(category) ?? EMPTY_TALLY;
            const own = config.categories[category];
            const effective = own ?? config.default;
            const open = expanded.has(`@${category}`);

            return (
              <div key={category} className="border-b border-border">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      toggle(`@${category}`);
                    }}
                    disabled={rules.length === 0}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  >
                    <Chevron open={open} />
                    <span className="truncate text-[13px] font-medium">
                      {CATEGORY_LABEL[category]}
                    </span>
                    <span className="shrink-0 tabular-nums text-[11px] text-faint">
                      {rules.length} прав.
                    </span>
                  </button>
                  <Tally tally={categoryTally} />
                  {own === undefined && <Inherited level={effective} />}
                  {overrides.categories[category] !== undefined && (
                    <Badge tone="accent">изменено</Badge>
                  )}
                  <LevelSelect
                    label={`Категория: ${CATEGORY_LABEL[category]}`}
                    value={effective}
                    onChange={(choice) => {
                      onOverridesChange(
                        withOverride(overrides, { kind: "category", id: category }, choice),
                      );
                    }}
                  />
                </div>

                {open && (
                  <div className="border-t border-border/60 bg-bg/40">
                    {rules.map((entry) => (
                      <RuleRow
                        key={entry.id}
                        entry={entry}
                        config={config}
                        overrides={overrides}
                        tally={tally}
                        expanded={expanded}
                        onToggle={toggle}
                        onOverridesChange={onOverridesChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
};

/**
 * One catalog rule, and — for `a11y.lint` — its 30 sub-rules under it.
 *
 * The sub-rules are the reason this row can expand at all: `a11y.lint` is thirty independent
 * jsx-a11y checks wearing one id, and «выключить всю доступность» is almost never what somebody
 * means when they want `img-redundant-alt` to stop shouting.
 */
const RuleRow = ({
  entry,
  config,
  overrides,
  tally,
  expanded,
  onToggle,
  onOverridesChange,
}: {
  entry: RuleCatalogEntry;
  config: RuleConfig;
  overrides: RuleOverrides;
  tally: ReturnType<typeof tallyFindings>;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onOverridesChange: (next: RuleOverrides) => void;
}): React.ReactElement => {
  const own = config.rules[entry.id];
  // Asking the resolver rather than re-deriving: a rule can inherit from a dot-prefix key
  // (`style.override` covering `style.override.repaint`), which no local reading would catch.
  const effective = resolveLevel(
    { rule: entry.id, subkind: null, category: entry.category },
    config,
  );
  const ruleTally = tally.byRule.get(entry.id) ?? EMPTY_TALLY;
  const open = expanded.has(entry.id);
  const hasSubrules = entry.subrules.length > 0;

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="flex items-start gap-2 py-2 pl-8 pr-4">
        <button
          type="button"
          onClick={() => {
            onToggle(entry.id);
          }}
          disabled={!hasSubrules}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:cursor-default"
        >
          <span className="flex items-center gap-2">
            <Chevron open={hasSubrules && open} />
            <span className="truncate text-[12.5px]">{ruleLabel(entry.id)}</span>
            {hasSubrules && (
              <span className="shrink-0 tabular-nums text-[11px] text-faint">
                {entry.subrules.length} подправ.
              </span>
            )}
          </span>
          <span className="truncate pl-5 font-mono text-[11px] text-faint">{entry.id}</span>
          {entry.description.length > 0 && (
            <span className="pl-5 text-[11px] leading-snug text-faint">{entry.description}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <Tally tally={ruleTally} />
          {own === undefined && <Inherited level={effective} />}
          {overrides.rules[entry.id] !== undefined && <Badge tone="accent">изменено</Badge>}
          <LevelSelect
            label={`Правило: ${entry.id}`}
            value={effective}
            onChange={(choice) => {
              onOverridesChange(withOverride(overrides, { kind: "rule", id: entry.id }, choice));
            }}
          />
        </div>
      </div>

      {hasSubrules && open && (
        <div className="bg-surface-2/40">
          {entry.subrules.map((subrule) => {
            const key = `${entry.id}/${subrule.id}`;
            const subOwn = config.rules[key];
            const subEffective = resolveLevel(
              { rule: entry.id, subkind: subrule.id, category: entry.category },
              config,
            );

            return (
              <div key={key} className="flex items-start gap-2 py-1.5 pl-14 pr-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px]">{subrule.id}</div>
                  {subrule.description.length > 0 && (
                    <div className="truncate text-[11px] leading-snug text-faint">
                      {subrule.description}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Tally tally={tally.bySubrule.get(key) ?? EMPTY_TALLY} />
                  {subOwn === undefined && <Inherited level={subEffective} />}
                  {overrides.rules[key] !== undefined && <Badge tone="accent">изменено</Badge>}
                  <LevelSelect
                    label={`Подправило: ${key}`}
                    value={subEffective}
                    onChange={(choice) => {
                      onOverridesChange(withOverride(overrides, { kind: "rule", id: key }, choice));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
