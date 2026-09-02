/**
 * TIER 1 — WHICH DESIGN SYSTEM, and how the answer is reached.
 *
 * Every case here runs against a REAL directory written into scratch space: autodetection's
 * whole job is reading a project, and a faked `readFile` would have made these tests assertions
 * about the fake. Nothing is installed and nothing is executed — the manifests and sources are
 * a few lines each, which is also all a real detection reads.
 *
 * The registry is injected rather than mocked. `selectAdapter`'s logic is the feature and runs
 * for real; only the list of candidates is substituted, because the tiebreak needs two design
 * systems and this repository ships one. The production registry is asserted separately, at the
 * bottom, so "the fake behaves" cannot be mistaken for "`eds` is wired up".
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { KitAdapter } from "@smart-tools/fg-analyzer-engine";
import { pick } from "@smart-tools/fg-cli-kit";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  ADAPTERS,
  resolveAdapter,
  adapterNames,
  countKitImports,
  createProjectReportCommands,
  declaredDependencies,
  isRedirectable,
  NO_ADAPTER,
  noKitHeader,
  phases,
  requestedAdapter,
  selectAdapter,
  unknownAdapter,
  type AdapterEntry,
} from "../src/index.ts";

import { capture, ENGINE_RESULT, scratch, text } from "./harness.ts";

let dir = "";
let remove: () => Promise<void> = () => Promise.resolve();

beforeEach(async () => {
  ({ dir, remove } = await scratch());
});

afterEach(async () => {
  await remove();
});

/**
 * A `KitAdapter` with nothing in it but the two fields the selection reads.
 *
 * Typed as the real interface, so a field the selection starts depending on cannot be added
 * without this file having to answer for it.
 */
const fakeAdapter = (id: string, kitPackages: readonly string[]): KitAdapter => ({
  id,
  kitPackages,
  wrappedUpstreamScope: null,
  rules: [],
  binding: {
    iconCount: null,
    tokenColorHex: () => null,
    tokenIdOf: () => null,
    a11yAvailable: false,
    canonicalComponentFor: () => null,
    variantValues: () => null,
    componentNames: () => [],
  },
});

const alpha: AdapterEntry = {
  name: "alpha",
  version: "1.0.0",
  adapter: fakeAdapter("alpha", ["@alpha/base", "@alpha/theme"]),
};
const beta: AdapterEntry = {
  name: "beta",
  version: "2.0.0",
  adapter: fakeAdapter("beta", ["@beta/base"]),
};
const registry: readonly AdapterEntry[] = [alpha, beta];

const project = async (files: Readonly<Record<string, string>>): Promise<string> => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
};

const manifest = (dependencies: Readonly<Record<string, string>>, field = "dependencies"): string =>
  JSON.stringify({ name: "p", version: "0.0.0", [field]: dependencies }, null, 2);

const commandWith = (adapters: readonly AdapterEntry[]) => {
  const seen: { adapter: string | undefined; domains: readonly string[] | undefined }[] = [];
  const payloads: { adapter: unknown }[] = [];
  const commands = createProjectReportCommands({
    adapters,
    resolveSource: (input) =>
      Promise.resolve({ kind: "local", dir: input, cleanup: () => Promise.resolve() }),
    analyzeProject: (options) => {
      seen.push({ adapter: options.adapter?.id, domains: options.domains });
      return Promise.resolve(ENGINE_RESULT);
    },
    renderReport: (payload) => {
      payloads.push(payload);
      return "<html></html>";
    },
  });
  return { command: commands[0] as NonNullable<(typeof commands)[number]>, seen, payloads };
};

/**
 * The PRODUCTION registry, because the redirect rule (V6 audit finding #3) is a fact about the
 * two EDS entries and a fixture pair would only prove that a fixture can be redirected.
 */
const productionCommand = () => {
  const commands = createProjectReportCommands({
    resolveSource: (input) =>
      Promise.resolve({ kind: "local", dir: input, cleanup: () => Promise.resolve() }),
    analyzeProject: () => Promise.resolve(ENGINE_RESULT),
    renderReport: () => "<html></html>",
  });
  return commands[0] as NonNullable<(typeof commands)[number]>;
};

describe("autodetect — the project's own dependencies decide", () => {
  it("matches an adapter whose declared package the project depends on", async () => {
    await project({ "package.json": manifest({ "@beta/base": "1.2.3", react: "18.3.1" }) });

    expect(await selectAdapter({ dir, adapters: registry })).toEqual({
      kind: "adapter",
      entry: beta,
      how: "autodetect",
    });
  });

  for (const field of ["devDependencies", "peerDependencies", "optionalDependencies"]) {
    it(`reads ${field} too — a design system is not always a runtime dependency`, async () => {
      await project({ "package.json": manifest({ "@beta/base": "1.2.3" }, field) });

      expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("adapter");
    });
  }

  it("no match → no adapter, and the run is the generic one", async () => {
    await project({ "package.json": manifest({ react: "18.3.1", "@other/kit": "1.0.0" }) });

    expect(await selectAdapter({ dir, adapters: registry })).toEqual({
      kind: "none",
      why: "no-match",
    });
  });

  it("a missing, unreadable or malformed manifest is «no match», never a throw", async () => {
    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("none");

    await project({ "package.json": "{ this is not json" });
    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("none");

    await project({ "package.json": "[]" });
    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("none");

    await project({ "package.json": JSON.stringify({ dependencies: "not-an-object" }) });
    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("none");
  });

  it("matches package NAMES exactly, not scopes — `kitPackages` is the adapter's declaration", async () => {
    await project({ "package.json": manifest({ "@beta/something-else": "1.0.0" }) });

    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("none");
  });

  it("declaredDependencies unions all four fields", async () => {
    await project({
      "package.json": JSON.stringify({
        dependencies: { a: "1" },
        devDependencies: { b: "1" },
        peerDependencies: { c: "1" },
        optionalDependencies: { d: "1" },
      }),
    });

    expect([...(await declaredDependencies(dir))].toSorted()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the tiebreak — two manifests match, the imports decide", () => {
  const both = manifest({ "@alpha/base": "1.0.0", "@beta/base": "1.0.0" });

  it("picks the design system the code actually imports", async () => {
    await project({
      "package.json": both,
      "src/App.tsx": [
        'import { Button } from "@beta/base";',
        'import { Card } from "@beta/base/card";',
        "export const App = () => <Button />;",
      ].join("\n"),
    });

    const choice = await selectAdapter({ dir, adapters: registry });
    expect(choice).toEqual({ kind: "adapter", entry: beta, how: "autodetect" });
  });

  it("picks the other one when the imports point the other way", async () => {
    await project({
      "package.json": both,
      "src/App.tsx": 'import { Button } from "@alpha/base";\nimport "@alpha/theme/dark.css";',
    });

    expect((await selectAdapter({ dir, adapters: registry })).kind).toBe("adapter");
    const choice = await selectAdapter({ dir, adapters: registry });
    expect(choice.kind === "adapter" && choice.entry.name).toBe("alpha");
  });

  it("with no imports either way the result is still deterministic, not array order", async () => {
    await project({ "package.json": both });

    // Both score 0 imports; `alpha` declares 1 of 2 packages and `beta` 1 of 1, so the
    // declared-count key breaks it before the alphabetical one is reached.
    const first = await selectAdapter({ dir, adapters: registry });
    const second = await selectAdapter({ dir, adapters: [beta, alpha] });
    expect(first).toEqual(second);
  });

  it("countKitImports counts a package and every subpath of it, in code and in CSS", async () => {
    await project({
      "src/a.ts": 'import x from "@beta/base";\nimport y from "@beta/base/button";',
      "src/a.css": '@import "@beta/base/reset.css";',
      "src/unrelated.ts": 'import z from "@beta/baseline";',
      "node_modules/pkg/index.js": 'require("@beta/base");',
    });

    // Three hits; `@beta/baseline` is a different package and `node_modules` is not walked.
    expect(await countKitImports(dir, ["@beta/base"])).toBe(3);
  });
});

describe("--ui-kit — the user's answer wins", () => {
  it("names a registered design system", () => {
    expect(requestedAdapter("beta", registry)).toEqual({
      kind: "adapter",
      entry: beta,
      how: "flag",
    });
  });

  it("`none` disables the check — a choice, distinct from «nothing matched»", () => {
    expect(requestedAdapter(NO_ADAPTER, registry)).toEqual({ kind: "none", why: "disabled" });
  });

  it("an unregistered name is a usage error carrying the value back", () => {
    expect(requestedAdapter("nope", registry)).toEqual({ kind: "unknown", value: "nope" });
  });

  it("beats autodetection, even when the manifest says otherwise", async () => {
    await project({ "package.json": manifest({ "@beta/base": "1.0.0" }) });

    const choice = await selectAdapter({ dir, requested: "alpha", adapters: registry });
    expect(choice).toEqual({ kind: "adapter", entry: alpha, how: "flag" });
  });

  it("adapterNames lists every registered spelling plus `none`", () => {
    expect(adapterNames(registry)).toEqual(["alpha", "beta", NO_ADAPTER]);
  });
});

describe("through the command", () => {
  it("an unknown --ui-kit exits 2 in both languages, BEFORE anything is resolved", async () => {
    for (const lang of ["ru", "en"] as const) {
      const { command, seen } = commandWith(registry);
      const run = capture({
        cwd: dir,
        source: dir,
        out: join(dir, "r.html"),
        lang,
        uiKit: "gamma",
      });

      expect(await command.run(run.ctx)).toBe(2);
      expect(text(run.err)).toBe(
        `${pick(unknownAdapter("gamma", adapterNames(registry)), lang)}\n`,
      );
      // Nothing ran: no clone, no scan, no stdout.
      expect(seen).toEqual([]);
      expect(text(run.out)).toBe("");
    }
  });

  it("`--ui-kit none` runs with no adapter and stamps the payload null", async () => {
    await project({ "package.json": manifest({ "@beta/base": "1.0.0" }) });
    const { command, seen, payloads } = commandWith(registry);
    const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html"), uiKit: NO_ADAPTER });

    // Exit 1 is U2 over {@link ENGINE_RESULT}'s one visible error, not a failure of the flag.
    expect(await command.run(run.ctx)).toBe(1);
    // The manifest WOULD have matched; the flag is what stopped it.
    expect(seen).toEqual([{ adapter: undefined, domains: ["a11y", "components", "icons"] }]);
    expect(payloads[0]?.adapter).toBeNull();
    // The sentence is a UI note now (U3): stdout carries the written path and nothing else.
    expect(text(run.out)).toBe(`${join(dir, "r.html")}\n`);
    // AND IT IS THE HEADER THAT SAYS IT (V5 finding #9): `--ui-kit` on the line settles the
    // design system before the run starts, so the header carries it and no note repeats it.
    expect(run.ui[0]).toBe(`header:preport · ${noKitHeader.ru}`);
    expect(run.ui.filter((line) => line.startsWith("note:"))).toEqual([]);
  });

  it("an autodetected adapter reaches the engine, its domains, and the payload stamp", async () => {
    await project({ "package.json": manifest({ "@beta/base": "1.0.0" }) });
    const withDomains: AdapterEntry = {
      ...beta,
      adapter: { ...beta.adapter, domains: ["tokens", "api"] },
    };
    const { command, seen, payloads } = commandWith([withDomains]);
    const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html") });

    expect(await command.run(run.ctx)).toBe(1);
    // The adapter's own domains join the engine's three — without this the adapter's rules
    // would be selected out by the explicit domain list this command passes.
    expect(seen).toEqual([
      { adapter: "beta", domains: ["a11y", "components", "icons", "tokens", "api"] },
    ]);
    // `version` is the DESIGN SYSTEM's provenance, not the adapter package's number — E2a moved
    // it. `beta` is a test registry entry with no corpus loader, so `resolveAdapter` answers
    // "embedded, version unknown", which renders as `? (embedded)`. The real `eds` entry has a
    // loader and says `1.13.0 (embedded)`; `parse-ui-kit.test.ts` and the tier-2 CLI suite pin
    // the populated forms.
    expect(payloads[0]?.adapter).toEqual({ name: "beta", version: "? (embedded)" });
  });

  it("the notice is a UI note in the language in play, and says how it decided", async () => {
    await project({ "package.json": manifest({ "@beta/base": "1.0.0" }) });

    for (const lang of ["ru", "en"] as const) {
      const { command } = commandWith(registry);
      const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html"), lang });

      expect(await command.run(run.ctx)).toBe(1);
      // U3: the sentence lives on the UI's stream. On a terminal it used to land ON the live
      // progress line, because it was written with a raw `ctx.stdout`.
      const notice = run.ui.find((line) => line.startsWith("note:")) ?? "";
      expect(notice).toContain("beta");
      // WHICH SNAPSHOT, not which package version — see the payload assertion above. A registry
      // entry without a corpus loader is always the embedded one, and the notice says so in the
      // language in play rather than going quiet about it.
      expect(notice).toContain(lang === "en" ? "(embedded)" : "(встроенная)");
      expect(lang === "en" ? /[А-Яа-яЁё]/u.test(notice) : true).toBe(lang !== "en");
      // AUTODETECT, so the note says so — and the header does NOT, because the design system is
      // not knowable until the project has been read (V5 findings #3 and #9). Exactly one of
      // the two states it, and here it is the note.
      expect(notice).toContain(
        lang === "en" ? "detected from the project's dependencies" : "определена по зависимостям",
      );
      const header = run.ui.find((line) => line.startsWith("header:")) ?? "";
      expect(header).toBe(`header:${lang === "en" ? "preport" : "preport"}`);
    }
  });
});

describe("the production registry", () => {
  it("holds `eds` and `eds2`, each named by the adapter's own id", () => {
    expect(ADAPTERS.map((entry) => entry.name)).toEqual(["eds", "eds2"]);
    // The name is the ADAPTER's id and not a second spelling kept in step by hand — the
    // property that makes `--ui-kit <name>` and the payload's `adapter.name` the same string.
    for (const entry of ADAPTERS) expect(entry.name).toBe(entry.adapter.id);
    expect(adapterNames()).toEqual(["eds", "eds2", NO_ADAPTER]);
  });

  it("gives the two EDS versions disjoint packages, so autodetect cannot see both", () => {
    const [first, second] = ADAPTERS;
    const overlap = (first?.adapter.kitPackages ?? []).filter((name) =>
      (second?.adapter.kitPackages ?? []).includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it("carries the adapter package's real version, injected at build time", () => {
    // `0.0.0-dev` is the un-substituted fallback: seeing it here means the `define` in
    // `vite.config.ts`/`tsdown.config.ts` stopped reaching this module.
    //
    // This number no longer reaches the notice or the payload — those carry the DESIGN SYSTEM's
    // version and provenance now (`strings.ts`'s `provenanceLabel`) — but the field is kept and
    // still checked: "which build of the adapter produced this" is a real question, and the
    // moment nothing asserts the substitution works is the moment it silently stops.
    expect(ADAPTERS[0]?.version).not.toBe("0.0.0-dev");
    expect(ADAPTERS[0]?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("resolves the eds entry against the disk, and says `embedded` when nothing is there", async () => {
    const entry = ADAPTERS[0];
    if (entry === undefined) throw new Error("no eds entry");

    // An empty override rather than the real `~/.fg/kits`: this test must say the same thing on
    // a machine that has run `--parse-ui-kit` and one that has not.
    const resolution = await resolveAdapter(entry, { FG_KITS_DIR: join(dir, "nothing-here") });

    expect(resolution.warnings).toEqual([]);
    expect(resolution.provenance).toEqual({ kind: "embedded", version: "1.13.0" });
    // The SAME object, not a rebuild: constructing four specs over four megabytes for a run with
    // no corpus is work `adapters.ts` deliberately does not do.
    expect(resolution.adapter).toBe(entry.adapter);
  });

  it("declares the packages autodetection matches on", () => {
    // Not spelled out here: the assertion is that the registry reads them off the adapter, so
    // the adapter stays the one place that says what its kit is.
    expect(ADAPTERS[0]?.adapter.kitPackages.length).toBeGreaterThan(0);
  });

  /**
   * V3 MINOR-5 — a corpus warning is the UI's line, not a raw `ctx.stderr` write.
   *
   * The old code wrote it with `ctx.stderr`, so it landed unindented in the middle of the UI's
   * own two-space-indented output and, on a terminal, on top of the live progress bar. Same
   * words, same stream in the CLI's wiring, different seam: `ctx.ui.note`.
   */
  it("routes corpus warnings through ui.warn, not ctx.stderr, with the localized text", async () => {
    const kits = join(dir, "kits", "eds");
    await mkdir(kits, { recursive: true });
    // One unreadable member is enough: an ENTIRELY absent corpus is the fresh-machine state and
    // is silent by design (`packages/fg-eds-adapter/src/corpus.ts`), so the file has to be there
    // and bad.
    await writeFile(join(kits, "tokens.json"), "{ not json", "utf8");

    // Built here rather than reusing the fixture builder above, which is scoped to the registry
    // suite: this case needs the PRODUCTION registry, because `eds` is the only entry with a
    // corpus loader and therefore the only one that can warn about a corpus at all.
    const commands = createProjectReportCommands({
      resolveSource: (input) =>
        Promise.resolve({ kind: "local", dir: input, cleanup: () => Promise.resolve() }),
      analyzeProject: () => Promise.resolve(ENGINE_RESULT),
      renderReport: () => "<html></html>",
    });
    const command = commands[0] as NonNullable<(typeof commands)[number]>;
    const run = capture({
      cwd: dir,
      source: dir,
      out: join(dir, "r.html"),
      uiKit: "eds",
      env: { FG_KITS_DIR: join(dir, "kits") },
    });

    expect(await command.run(run.ctx)).toBe(1);

    // A corpus that could not be read is a WARNING (§2.6's `!` gutter), not a note: the run
    // fell back to the embedded snapshot, which is something a user may want to act on.
    const warnings = run.ui.filter((line) => line.startsWith("warn:"));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join("\n")).toContain("eds");
    // The text is still the localized one, and it is NOT on stderr any more.
    expect(/[А-Яа-яЁё]/u.test(warnings.join("\n"))).toBe(true);
    expect(text(run.err)).toBe("");
    // The run still produced its report on the embedded snapshot — these warnings are non-fatal.
    expect(run.ui.join("\n")).toContain("(встроенная)");
  });

  /**
   * V6 AUDIT FINDING #3 — THE HEADER NAMES THE SNAPSHOT THE NUMBERS CAME FROM.
   *
   * `--ui-kit eds` on a project that declares `@sds-eng/base-exp` is redirected to `eds2`. The
   * header used to be printed before the project was on disk, so it said `eds 1.13.0
   * (встроенная)` — the wrong design system AND the wrong version — one line above the warning
   * that corrected it. A header that has to be corrected by the next line is not a header.
   */
  it("names the REDIRECTED design system in the header, not the one that was typed", async () => {
    await project({ "package.json": manifest({ "@sds-eng/base-exp": "2.0.0" }) });
    const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html"), uiKit: "eds" });

    expect(await productionCommand().run(run.ctx)).toBe(1);

    const headers = run.ui.filter((line) => line.startsWith("header:"));
    // Exactly ONE header, and it names the version the numbers were measured against.
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain("eds2 2.0.0");
    // The wrong answer, spelled out so a regression cannot pass by containing both.
    expect(headers[0]).not.toContain("eds 1.");
    // It is still the run's first LINE. The only call recorded ahead of it is the resolve
    // PHASE, whose row is written when it is sealed and therefore lands under the header
    // (`packages/cli-kit/src/ui.ts`'s `seal`/`erase`/`draw`) — verified on the real bundle,
    // which prints `fg v1.0.0 · preport · eds2 2.0.0 (встроенная)` and only then
    // `подготовка проекта 0.0s`. Nothing that carries NEWS may precede it.
    expect(run.ui.slice(0, run.ui.indexOf(headers[0] ?? ""))).toEqual([
      `phase:${phases.resolve.ru}`,
    ]);
    // And exactly one warning explains why the flag and the header differ.
    const warnings = run.ui.filter((line) => line.startsWith("warn:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("eds2");
  });

  it("leaves the header where it was for a flag that cannot be redirected", async () => {
    // `--ui-kit eds2` and `--ui-kit none` settle the answer on the line the user typed, so their
    // header is printed the moment the invocation is accepted — the ordering V5 findings #3 and
    // #4 asked for, and the one this change must not spend to fix the redirect.
    await project({ "package.json": manifest({ "@sds-eng/base-exp": "2.0.0" }) });
    const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html"), uiKit: "eds2" });

    expect(await productionCommand().run(run.ctx)).toBe(1);
    expect(run.ui[0]).toContain("eds2 2.0.0");
    expect(run.ui.filter((line) => line.startsWith("warn:"))).toEqual([]);
  });

  it("still opens with a header when the project never arrives", async () => {
    // §2.6: the header IS printed before a runtime failure, because the command had started.
    // Deferring it for a redirectable flag must not lose that.
    const commands = createProjectReportCommands({
      resolveSource: () => Promise.reject(new Error("no such directory")),
      analyzeProject: () => Promise.resolve(ENGINE_RESULT),
      renderReport: () => "<html></html>",
    });
    const command = commands[0] as NonNullable<(typeof commands)[number]>;
    const run = capture({ cwd: dir, source: dir, out: join(dir, "r.html"), uiKit: "eds" });

    expect(await command.run(run.ctx)).toBe(1);
    // Exactly one header, and it carries no design system: that is the fact this run failed to
    // establish. It is recorded AFTER `phase:подготовка проекта` because the phase is what the
    // command was doing when the project did not arrive — but the phase row is only WRITTEN
    // when it is sealed (`packages/cli-kit/src/ui.ts`'s `seal`/`erase`/`draw`), so the header is
    // still the first line of the output. Verified on the real bundle:
    // `fg v1.0.0 · preport` / `  подготовка проекта 0.0s` / `✖ путь не найден: …`.
    expect(run.ui.filter((line) => line.startsWith("header:"))).toEqual(["header:preport"]);
    expect(run.ui.indexOf("header:preport")).toBeLessThan(
      run.ui.findIndex((line) => line.startsWith("fail:") || line.startsWith("summary:")),
    );
  });

  it("knows which registered names a redirect can move", () => {
    // Derived from the redirect table, so a second rule cannot leave a second lying header.
    expect(isRedirectable("eds")).toBe(true);
    expect(isRedirectable("eds2")).toBe(false);
    expect(isRedirectable(NO_ADAPTER)).toBe(false);
  });
});
