import { describe, expect, it } from "vitest";
import library from "../src/exercises/library.json";
import {
  CAMERA_DEMANDS,
  DEMANDS,
  DEMAND_TAGS,
  SPORTS,
  SPORT_IDS,
  isSportId,
  sportById,
  sportsFor,
} from "../src/medical/sports";

describe("para sports and their demands (booth v2, B1)", () => {
  it("covers the 13 para sports and the 8 demand tags of the contract", () => {
    expect([...SPORT_IDS]).toEqual([
      "wheelchair_basketball",
      "para_athletics",
      "para_powerlifting",
      "boccia",
      "wheelchair_tennis",
      "para_table_tennis",
      "sitting_volleyball",
      "para_swimming",
      "para_archery",
      "handcycling",
      "wheelchair_fencing",
      "wheelchair_rugby",
      "para_badminton",
    ]);
    expect([...DEMAND_TAGS]).toEqual([
      "shoulder_endurance",
      "pushing_power",
      "pressing_strength",
      "trunk_control",
      "trunk_rotation",
      "grip_and_arm",
      "cardio",
      "flexibility",
    ]);
    expect(SPORTS.map((s) => s.id)).toEqual([...SPORT_IDS]);
  });

  it("gives every sport an Arabic and English name, its demands, the positions it suits and an icon", () => {
    for (const s of SPORTS) {
      expect(s.name.ar).toMatch(/[؀-ۿ]/);
      expect(s.name.en).toMatch(/^[A-Z][a-z ]+$/);
      expect(s.demands.length).toBeGreaterThanOrEqual(3);
      expect(s.demands.length).toBeLessThanOrEqual(5);
      expect(new Set(s.demands).size).toBe(s.demands.length);
      for (const d of s.demands) expect(DEMAND_TAGS).toContain(d);
      expect(s.suits.length).toBeGreaterThan(0);
      for (const p of s.suits) expect(["wheelchair", "seated", "standing"]).toContain(p);
      expect(s.icon).toBeTruthy();
    }
    // Saad's sport: what the booth story says it asks of the body.
    expect(sportById("wheelchair_basketball")!.demands).toEqual(
      expect.arrayContaining(["shoulder_endurance", "pushing_power", "trunk_control"]),
    );
  });

  it("names every demand in both languages", () => {
    for (const d of DEMAND_TAGS) {
      expect(DEMANDS[d].ar).toMatch(/[؀-ۿ]/);
      expect(DEMANDS[d].en.length).toBeGreaterThan(3);
    }
  });

  it("recognises sport ids and lists the sports that suit a position first", () => {
    expect(isSportId("boccia")).toBe(true);
    expect(isSportId("football")).toBe(false);
    expect(isSportId(undefined)).toBe(false);
    const wheelchair = sportsFor("wheelchair");
    expect(wheelchair).toHaveLength(13);
    const firstOther = wheelchair.findIndex((s) => !s.suits.includes("wheelchair"));
    expect(wheelchair.slice(firstOther).every((s) => !s.suits.includes("wheelchair"))).toBe(true);
    expect(wheelchair[0].id).toBe("wheelchair_basketball");
    expect(sportsFor("").map((s) => s.id)).toEqual([...SPORT_IDS]);
  });

  it("knows what the three camera movements build", () => {
    expect(Object.keys(CAMERA_DEMANDS).sort()).toEqual([
      "seated_biceps_curl",
      "seated_shoulder_press",
      "sit_to_stand",
    ]);
    for (const tags of Object.values(CAMERA_DEMANDS)) for (const d of tags) expect(DEMAND_TAGS).toContain(d);
  });
});

describe("demand tags on the library (booth v2, B2)", () => {
  // The approved entries: the v7 drafts (status draft, contract 2.10) join these rules at their sign off.
  const LIB = (library as { id: string; category: string; demands?: string[]; status?: string }[]).filter(
    (e) => e.status !== "draft",
  );

  it("tags all 55 exercises with known demands only", () => {
    expect(LIB).toHaveLength(55);
    for (const e of LIB) {
      expect(Array.isArray(e.demands), e.id).toBe(true);
      expect(new Set(e.demands).size, e.id).toBe(e.demands!.length);
      for (const d of e.demands!) expect(DEMAND_TAGS, e.id).toContain(d);
    }
  });

  it("tags every stretch with flexibility, and gives every demand enough exercises to build it", () => {
    for (const e of LIB.filter((x) => x.category === "flexibility"))
      expect(e.demands, e.id).toContain("flexibility");
    for (const d of DEMAND_TAGS) {
      const n = LIB.filter((e) => e.demands!.includes(d)).length;
      expect(n, d).toBeGreaterThanOrEqual(2);
    }
  });
});
