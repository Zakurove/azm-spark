/**
 * Step A6 (product v7 contract 1.3, 8.4, 8.8 and section 9; D-024 item 5; Gate A review 2 item 5;
 * A2-1, A5-12): the entries App.tsx plants so that no stream edits it later.
 *
 *   - /?e2eSmoke=<name>: G's real model smoke page (src/features/smoke/SmokePage.tsx), VITE_E2E builds
 *     only; /?perf=1: G's performance overlay (src/features/smoke/PerfOverlay.tsx) over any page,
 *     VITE_E2E builds only. Each lazy import tests the env written inline.
 *   - Lazy link slots, VITE_V7 builds only: B's Today entry (src/features/focus/FocusTodayEntry.tsx)
 *     and My results link (src/features/focus/FindingsLink.tsx), E's Program link
 *     (src/features/program-v7/ProgramLink.tsx).
 *   - The contract rule (A2-1, A5-12): every lazy import of a v7 module tests
 *     `import.meta.env.VITE_V7 === "1"` written inline, never an imported constant, so a default
 *     build emits no chunk for it (tests/v7/a-bundle.test.ts checks the builds).
 *
 * The placeholders render nothing with their final props; their owners fill them.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import SmokePage, { type SmokePageProps } from "../../src/features/smoke/SmokePage";
import PerfOverlay from "../../src/features/smoke/PerfOverlay";
import FocusTodayEntry, { type FocusTodayEntryProps } from "../../src/features/focus/FocusTodayEntry";
import FindingsLink, { type FindingsLinkProps } from "../../src/features/focus/FindingsLink";
import ProgramLink, { type ProgramLinkProps } from "../../src/features/program-v7/ProgramLink";
import { createPlan, type Intake } from "../../src/medical/plan";
import { E2E_ONLY, filesUnder, V7_ONLY } from "./a-v7-paths";

const ROOT = join(__dirname, "../..");
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");

const INTAKE: Intake = {
  age: 58,
  conditions: ["stroke"],
  diagnosisNotes: "",
  medications: "",
  mobility: "standing",
  support: "right",
  pain: [],
  restrictions: [],
  symptoms: "no",
  recentChange: "no",
  clearance: "yes",
  equipment: ["chair"],
  goal: "habit",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: true,
};

describe("the smoke page and the performance overlay (G)", () => {
  it("are lazy entries of VITE_E2E builds only, the env test written inline", () => {
    const app = source("src/app/App.tsx");
    for (const page of ["SmokePage", "PerfOverlay"])
      expect(app).toMatch(
        new RegExp(
          `const ${page} =\\s+import\\.meta\\.env\\.VITE_E2E === "1" \\? lazy\\(\\(\\) => import\\("\\.\\./features/smoke/${page}"\\)\\) : null;`,
        ),
      );
    // The smoke page opens at ?e2eSmoke=<name>; the overlay at ?perf=1, over every page.
    expect(app).toMatch(/const smokeEntry = SmokePage \? qs\.get\("e2eSmoke"\) : null;/);
    expect(app).toMatch(/<SmokePage name=\{smokeEntry\} lang=\{lang\} onLanguage=\{toggleLanguage\} \/>/);
    expect(app).toMatch(/const perfEntry = !!PerfOverlay && qs\.get\("perf"\) === "1";/);
    expect(app).toMatch(/export default function App\(\) \{\n\s+return PerfOverlay && perfEntry \?/);
    // Nothing else imports them: a VITE_E2E branch of App.tsx is the only way in.
    for (const file of filesUnder(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (E2E_ONLY.test(rel) || rel === "src/app/App.tsx") continue;
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      expect(readFileSync(file, "utf8"), rel).not.toMatch(/features\/smoke\/|from "\.\.\/smoke\//);
    }
  });

  it("are placeholders that render nothing, with their final props", () => {
    const props: SmokePageProps = { name: "rom/knee_flexion/right", lang: "ar", onLanguage: vi.fn() };
    expect(renderToStaticMarkup(createElement(SmokePage, props))).toBe("");
    expect(renderToStaticMarkup(createElement(PerfOverlay))).toBe("");
  });
});

describe("the lazy link slots for B and E", () => {
  const SLOTS: [string, string][] = [
    ["FocusTodayEntry", "../features/focus/FocusTodayEntry"],
    ["FindingsLink", "../features/focus/FindingsLink"],
    ["ProgramLink", "../features/program-v7/ProgramLink"],
  ];

  it("are lazy entries of VITE_V7 builds only, the env test written inline", () => {
    const app = source("src/app/App.tsx");
    for (const [name, path] of SLOTS)
      expect(app).toMatch(
        new RegExp(
          `const ${name} =\\s+import\\.meta\\.env\\.VITE_V7 === "1" \\? lazy\\(\\(\\) => import\\("${path}"\\)\\) : null;`,
        ),
      );
    // Each renders only in a VITE_V7 build, inside its own Suspense boundary (LazyPart).
    for (const [name] of SLOTS)
      expect(app).toMatch(new RegExp(`${name} &&[^(]*\\(\\s+<LazyPart lang=\\{lang\\}>\\s+<${name}\\b`));
  });

  it("render with their final props: Today shows the focus check card, the two links wait for data", () => {
    const today: FocusTodayEntryProps = {
      lang: "ar",
      owner: "u1",
      intake: INTAKE,
      plan: createPlan(INTAKE),
      onStart: vi.fn(),
      onOpenFindings: vi.fn(),
      onOpenResults: vi.fn(),
      onOpenHealth: vi.fn(),
    };
    const results: FindingsLinkProps = { lang: "en", owner: "u1", onOpenFindings: vi.fn(), onStart: vi.fn() };
    const program: ProgramLinkProps = {
      lang: "ar",
      plan: createPlan(INTAKE),
      onOpenProgram: vi.fn(),
      onOpenFindings: vi.fn(),
    };
    const card = renderToStaticMarkup(createElement(FocusTodayEntry, today));
    expect(card).toContain("قياس الحركة المركّز");
    expect(card).toContain("ابدأ القياس");
    expect(card).not.toContain("نتائج آخر قياس");
    expect(renderToStaticMarkup(createElement(FindingsLink, results))).toBe("");
    expect(renderToStaticMarkup(createElement(ProgramLink, program))).toBe("");
  });
});

describe("the inline VITE_V7 test of every lazy v7 import (A2-1, A5-12)", () => {
  it("guards each dynamic import of a v7 module outside v7 code with the env test written inline", () => {
    const found: string[] = [];
    for (const file of filesUnder(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (!/\.(ts|tsx)$/.test(rel) || V7_ONLY.test(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/import\("(\.[^"]+)"\)/g)) {
        const target = relative(ROOT, join(file, "..", m[1]));
        if (!V7_ONLY.test(target) && !V7_ONLY.test(`${target}.tsx`) && !V7_ONLY.test(`${target}.ts`))
          continue;
        found.push(`${rel} -> ${target}`);
        const before = text.slice(Math.max(0, m.index! - 80), m.index);
        expect(before, `${rel} -> ${target}`).toMatch(
          /import\.meta\.env\.VITE_V7 === "1"\s*\?\s*lazy\(\(\) =>\s*$/,
        );
      }
    }
    // The rule is not vacuous: App.tsx's pages and slots and IntakeForm's step are found.
    expect(found).toEqual(
      expect.arrayContaining([
        "src/app/App.tsx -> src/features/focus/FocusApp",
        "src/app/App.tsx -> src/features/focus/FocusTodayEntry",
        "src/app/App.tsx -> src/features/program-v7/ProgramLink",
        "src/app/IntakeForm.tsx -> src/app/IntakeV7",
      ]),
    );
  });

  it("never tests the imported V7_UI for a lazy import", () => {
    // Comments may name the pattern; the code may not.
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const file of filesUnder(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      expect(code(readFileSync(file, "utf8")), rel).not.toMatch(/V7_UI\s*\?\s*lazy\(/);
    }
  });
});
