/**
 * THE ARTIFACT ITSELF: one file, no network, and exactly the panels this port keeps.
 *
 * The owner's rule for this port is 0 visual regression against the hackathon dashboard —
 * same look, only fewer metrics. Two of these suites are that rule made mechanical: every
 * panel whose rules are NOT ported must be gone from the built HTML, and every panel that
 * survives must still be in it. Markers are the panels' own heading text, which is what a
 * reader would look for on screen.
 */
import { describe, expect, it } from "vite-plus/test";

import { builtBundle, builtTemplate } from "./support.ts";

/** Panels deleted by this port, by the heading each one showed. */
const REMOVED_MARKERS: readonly string[] = [
  // PrFlow — the component carrying the hardcoded Jenkins webhook (h3 §5).
  "Создать pull request",
  "Заголовок PR",
  // Kit-metric verdict strip (no ported rule behind any of it).
  "Здоровье",
  "Компоненты из ДС",
  "Кастомные на токенах ДС",
  "Кастомные без токенов ДС",
  "Покрытие токенами",
  // Token / kit-adoption panels: `token.literal.color`, `token.literal.dimension` and the
  // usage tables are all kit-parametric (h5 §1b, §2a).
  "Пробелы кита",
  "Палитра мимо токенов",
  "Размеры против шкалы кита",
  "Самые используемые токены",
  "Компоненты кита в проекте",
  "Кастомные компоненты",
  "Сторонние компоненты",
  "Компоненты кита, не использованные ни разу",
  // The kit-version badge in the sidebar named a specific private design system.
  "sds-eng",
];

/** Panels the port keeps, by the heading each one shows. */
const SURVIVING_MARKERS: readonly string[] = [
  "Аудит дизайн-системы",
  "Сводка",
  "План работ",
  "По файлам",
  "Дизайн-система",
  "Доступность",
  "С чего начать",
  "По категориям",
  "По серьёзности",
  "Что хорошо",
  "Проблемные файлы",
  "Кандидаты в дизайн-систему",
  "Иконки мимо кита",
  "Клавиатура и фокус",
  "Имена и семантика",
  "Базовые правила",
  "Не проверено",
  "Все диффы этой группы в PR",
];

describe("the built dashboard template", () => {
  it("exists and carries the ds-data slot the renderer substitutes into", () => {
    expect(builtTemplate()).toContain('<script type="application/json" id="ds-data">');
  });

  it("is one self-contained file — no script, stylesheet or image is fetched", () => {
    const external = [
      ...builtTemplate().matchAll(
        /<(?:script|link|img|iframe)\b[^>]*?(?:src|href)=["']?(https?:)?\/\//gi,
      ),
    ];
    expect(external.map((match) => match[0])).toEqual([]);
  });

  it("declares no remote font or stylesheet import in its CSS either", () => {
    expect(builtTemplate()).not.toMatch(/@import\s+(?:url\()?["']?https?:/i);
  });

  it("weighs in as one megabyte-ish HTML file, not a directory of assets", () => {
    expect(builtTemplate().length).toBeGreaterThan(200_000);
  });
});

describe("0 visual regression — the panels that had to go", () => {
  for (const marker of REMOVED_MARKERS) {
    it(`has no trace of «${marker}»`, () => {
      expect(builtTemplate()).not.toContain(marker);
    });
  }
});

describe("0 visual regression — the panels that had to stay", () => {
  for (const marker of SURVIVING_MARKERS) {
    it(`still shows «${marker}»`, () => {
      expect(builtTemplate()).toContain(marker);
    });
  }
});

describe("the library bundle", () => {
  it("has the dashboard embedded, not the build-time placeholder", () => {
    const bundle = builtBundle();
    expect(bundle).not.toContain("__FE_ANALYZER_REPORT_TEMPLATE__");
    expect(bundle).toContain('<script type=\\"application/json\\" id=\\"ds-data\\">');
  });
});
