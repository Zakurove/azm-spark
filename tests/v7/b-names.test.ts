/**
 * Wave 2 fix (copy review): the Arabic side word follows the region's own gender. القدم is feminine and
 * the side word follows it in «الكاحل والقدم», so the ankle and foot take the feminine word, as the
 * intake's «القدم اليمنى» does. Every limb region on both sides is pinned.
 */
import { describe, expect, it } from "vitest";
import { sideRegion } from "../../src/features/focus/names";

describe("sideRegion: the region and the side as the person reads them", () => {
  it("names the six limb regions on both sides in Arabic", () => {
    const ar = (region: Parameters<typeof sideRegion>[0]["region"], side: "right" | "left") =>
      sideRegion({ region, side }, "ar");
    expect([ar("shoulder", "right"), ar("shoulder", "left")]).toEqual(["الكتف الأيمن", "الكتف الأيسر"]);
    expect([ar("elbow", "right"), ar("elbow", "left")]).toEqual(["المرفق الأيمن", "المرفق الأيسر"]);
    expect([ar("forearm_wrist", "right"), ar("forearm_wrist", "left")]).toEqual([
      "الساعد والرسغ الأيمن",
      "الساعد والرسغ الأيسر",
    ]);
    expect([ar("hip", "right"), ar("hip", "left")]).toEqual(["الورك الأيمن", "الورك الأيسر"]);
    expect([ar("knee", "right"), ar("knee", "left")]).toEqual(["الركبة اليمنى", "الركبة اليسرى"]);
    expect([ar("ankle_foot", "right"), ar("ankle_foot", "left")]).toEqual([
      "الكاحل والقدم اليمنى",
      "الكاحل والقدم اليسرى",
    ]);
  });

  it("names them in English with the side first, and the neck and back without a side", () => {
    expect(sideRegion({ region: "ankle_foot", side: "right" }, "en")).toBe("Right ankle and foot");
    expect(sideRegion({ region: "neck", side: "none" }, "ar")).toBe("الرقبة");
  });
});
