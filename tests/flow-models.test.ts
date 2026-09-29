/**
 * The named flow states the E2E screenshots open (e2e/flow-models.ts): each is reached through the
 * reducer, shows the screen it is named for, survives the reload snapshot (JSON), and renders in both
 * languages within the copy rules.
 */
import { describe, expect, it } from "vitest";
import { contextResponse, FLOW_STATES, startResponse } from "../e2e/flow-models";
import { FLOW_SCREENS } from "../src/features/assessment/flow";
import { screenFor } from "../src/features/assessment/screens";
import { toSignedInContext } from "../src/features/assessment/api";
import { copyProblems, render } from "./flow-fixtures";

describe("named flow states for the screenshots", () => {
  for (const [name, s] of Object.entries(FLOW_STATES)) {
    it(`${name} shows ${s.screen}`, () => {
      const m = s.build();
      expect(m.data.config.mode).toBe(s.mode);
      expect(screenFor(m)).toBe(s.screen);
      const restored = JSON.parse(JSON.stringify(m));
      expect(screenFor(restored)).toBe(s.screen);
      for (const lang of ["ar", "en"] as const)
        expect(copyProblems(render(FLOW_SCREENS[s.screen], restored, lang)), `${name} ${lang}`).toEqual([]);
    });
  }

  it("covers every flow screen", () => {
    const shown = new Set(Object.values(FLOW_STATES).map((s) => s.screen));
    for (const id of Object.keys(FLOW_SCREENS)) expect(shown.has(id as never), id).toBe(true);
  });
});

describe("the E2E server answers", () => {
  it("builds a home context the client reads as open, with consent and the adult confirmation", () => {
    const c = toSignedInContext(contextResponse({ position: "chair" }, { consent: false }));
    expect(c.homeOpen).toBe(true);
    expect(c.consent).toBe(false);
    expect(c.ctx?.position).toBe("chair");
    expect(c.baseTests.length).toBeGreaterThan(0);
  });

  it("freezes a protocol for benign answers", () => {
    const r = startResponse({ position: "chair" }, {});
    expect(r.protocol.length).toBeGreaterThan(0);
    expect(r.status).toBe("open");
  });
});
