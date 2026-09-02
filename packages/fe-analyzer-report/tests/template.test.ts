/**
 * THE ARTIFACT ITSELF: one file, no network, and exactly the panels this build ships.
 *
 * The owner's rule is 0 visual regression against the hackathon dashboard. Three suites make
 * it mechanical, and X3 split the first one in two because the panels now come in three kinds
 * rather than two:
 *
 *  - **gone forever** — PrFlow, which carried a live Jenkins webhook and its token (h3 §5),
 *    and the sidebar badge naming a private design system. These must never be in the build,
 *    with or without an adapter, and deletion (not disabling) is the requirement.
 *  - **conditional** — the kit panels B3 deleted for lack of rules and X3 restored. Their
 *    markup SHIPS (the template is one static build serving both kinds of report) and the
 *    payload decides whether they draw. Asserting their presence here is what proves the
 *    restoration actually reached the artifact; whether they render is `kit.test.ts`.
 *  - **always shown** — the generic panels.
 *
 * Markers are the panels' own heading text, which is what a reader would look for on screen.
 */
import { describe, expect, it } from "vite-plus/test";

import { builtBundle, builtTemplate } from "./support.ts";

/** Deleted forever, whatever the payload says. */
const REMOVED_MARKERS: readonly string[] = [
  // PrFlow — the component carrying the hardcoded Jenkins webhook (h3 §5). Its feature has no
  // counterpart in this product and its secret must not enter this repository in any form.
  "Создать pull request",
  "Заголовок PR",
  // The kit-version badge in the sidebar named a specific private design system.
  "sds-eng",
];

/**
 * Restored by X3, and present in the build because one template serves both kinds of report.
 *
 * Each one is fed by an adapter rule or by `usage`, so each is drawn only when the payload
 * carries adapter-domain data (`dashboard/src/lib/kit.ts`, asserted in `kit.test.ts`). If any
 * of these is missing from the artifact, the restoration did not survive the build — which is
 * a failure a payload-level test could not see.
 */
const KIT_MARKERS: readonly string[] = [
  // Kit-metric verdict strip.
  "Здоровье",
  "Компоненты из ДС",
  "Кастомные на токенах ДС",
  "Кастомные без токенов ДС",
  "Покрытие токенами",
  // Token / kit-adoption panels: `token.literal.color`, `token.literal.dimension` and the
  // usage tables (h5 §1b, §2a) — all adapter rules.
  "Пробелы кита",
  "Палитра мимо токенов",
  "Размеры против шкалы кита",
  "Самые используемые токены",
  "Компоненты кита в проекте",
  "Кастомные компоненты",
  "Сторонние компоненты",
  "Компоненты кита, не использованные ни разу",
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

describe("0 visual regression — the panels that had to go, and stay gone", () => {
  for (const marker of REMOVED_MARKERS) {
    it(`has no trace of «${marker}»`, () => {
      expect(builtTemplate()).not.toContain(marker);
    });
  }
});

describe("the restored kit panels reached the artifact", () => {
  for (const marker of KIT_MARKERS) {
    it(`ships «${marker}»`, () => {
      expect(builtTemplate()).toContain(marker);
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
