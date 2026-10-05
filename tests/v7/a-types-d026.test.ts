/**
 * The section 2 types that D-026 (items 7, 8 and 9) and D-027 (item 2) change, in their home files
 * (contract 1.3 and 1.4: a shared type changes with the tech lead's decision, in A's file). Most of
 * these checks are made by `npm run check`: each assignment below only compiles when the field is there
 * with its decided type.
 */
import { describe, expect, it } from "vitest";
import type { CoachState } from "../../src/coach/types";

describe("the section 2 types D-026 changes", () => {
  it("CoachState lets the app open the bridge again after a P0 (item 8, DG-4)", () => {
    // 2.11 bridge rule 1: after a P0 only the app reopens; useCoach returns CoachState itself.
    const reopen: CoachState["reopen"] = () => undefined;
    expect(reopen()).toBeUndefined();
  });
});
