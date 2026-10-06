/**
 * Step D5: the coach on the focus check's hosts. A range block is one coach segment, split after its
 * fifth measured movement (C-6, the token route's segmentsFor); the live coach runs only with the
 * person's switch on, the live_coach consent and a network (C-5: off by default); while it runs the
 * host never asks a range question aloud (the bridge asks it when the coach is late, bridge rule 2).
 */
import { describe, expect, it } from "vitest";
import { COACH_ASK_LINES, liveCoachOn, romSegment } from "../../src/features/coach-agent/hosts";
import { LOCAL_ASK } from "../../src/features/coach-agent/bridge";
import { segmentsFor } from "../../server/modules/agent/segments";
import { buildRomProtocol, type RomProtocol, type RomProtocolItem } from "../../src/medical/rom-protocol";
import { defaults } from "../../src/app/experience";
import { entry, intake, today } from "./a-fixtures";

/** A protocol with `n` measured items in the seated block (the shoulder and elbow movements of both arms). */
function seated(n: number): RomProtocol {
  const p = buildRomProtocol({
    intake: intake({
      regions: [
        entry("shoulder", "both", ["stiffness"]),
        entry("elbow", "both", ["stiffness"]),
        entry("forearm_wrist", "both", ["stiffness"]),
      ],
    }),
    setting: "booth",
    today: today(),
  });
  let kept = 0;
  return {
    ...p,
    items: p.items.map((i) =>
      i.skipped || i.block !== "seated" || kept++ < n ? i : { ...i, skipped: "not_reached" as never },
    ),
  };
}

const measured = (p: RomProtocol, block: RomProtocolItem["block"]) =>
  p.items.filter((i) => !i.skipped && i.block === block).sort((a, b) => a.order - b.order);

describe("the range block's coach segment (C-6)", () => {
  it("is the token route's segment of each item: the first five of a block, then the rest", () => {
    const p = seated(7);
    const items = measured(p, "seated");
    expect(items.length).toBe(7);
    const server = segmentsFor(p, null).filter((s) => s.block === "rom");
    for (const item of items) {
      const seg = romSegment(p, "seated", item);
      const owner = server.find((s) => s.block === "rom" && s.items.some((x) => x === item))!;
      expect(seg).toBe(owner.segment);
    }
    expect(romSegment(p, "seated", items[4])).toBe("rom:seated:1");
    expect(romSegment(p, "seated", items[5])).toBe("rom:seated:2");
  });

  it("starts a block on its first segment before any movement", () => {
    expect(romSegment(seated(3), "seated", null)).toBe("rom:seated:1");
    expect(romSegment(seated(3), "lying", null)).toBe("rom:lying:1");
  });
});

describe("the live coach switch (C-5)", () => {
  it("is off by default and runs only with the switch, the consent, a network and the server's coach", () => {
    const on = { preference: true, consent: true, online: true, available: true };
    expect(defaults.liveCoach).toBe(false);
    expect(liveCoachOn({ ...on, preference: false })).toBe(false);
    expect(liveCoachOn({ ...on, consent: false })).toBe(false);
    expect(liveCoachOn({ ...on, online: false })).toBe(false);
    // D-030 D5-12: GET /api/agent/status says the server cannot run the coach now (switched off, no key).
    expect(liveCoachOn({ ...on, available: false })).toBe(false);
    expect(liveCoachOn(on)).toBe(true);
  });

  it("names the range questions the host leaves to the coach", () => {
    expect([...COACH_ASK_LINES].sort()).toEqual(
      Object.values(LOCAL_ASK)
        .map((a) => a.line)
        .sort(),
    );
  });
});
