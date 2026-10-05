/**
 * The seated side bend's earlier best reaches the range runner (D-027 item 2, W2-6): the start response
 * carries each side's best at earlier checks (POST /api/focus), and the shell gives the controller the
 * sides that have one, so the runner's limit is the best plus 15 (v1.1 4.3) and a side never measured
 * keeps the first check limit of 30.
 */
import { describe, expect, it } from "vitest";
import { leanBestOf, type StartResponse } from "../../src/features/focus/flow";

const check = (sideLeanBest?: StartResponse["sideLeanBest"]): StartResponse => ({
  id: "c1",
  kind: "retest",
  protocol: { rulesVersion: "r", items: [], deferred: [], notMeasured: [], sitBeforeStand: false },
  gait: null,
  warnings: [],
  helperRequired: [],
  helperBriefing: {},
  ...(sideLeanBest !== undefined ? { sideLeanBest } : {}),
});

describe("leanBestOf: the controller's sideLeanBest from the start response", () => {
  it("passes the sides with an earlier best, and none for a first check", () => {
    expect(leanBestOf(check({ left: 25, right: 36 }))).toEqual({ left: 25, right: 36 });
    expect(leanBestOf(check({ left: null, right: 31 }))).toEqual({ right: 31 });
    expect(leanBestOf(check({ left: null, right: null }))).toBeUndefined();
    // A response without the field (an older server) is a first check too.
    expect(leanBestOf(check())).toBeUndefined();
  });
});
