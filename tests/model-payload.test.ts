/**
 * Q32: the model call payloads carry no identifier and no free text. The weekly plan sends the
 * conditions as enum keys only, never the diagnosis notes typed or read from a report (which may
 * hold a name or an ID number), and never a name, email or contact detail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeekly } from "../server/weekly-ai";
import { createPlan, type Intake } from "../src/medical/plan";

const intake: Intake = {
  age: 52,
  conditions: ["stroke", "arthritis"],
  diagnosisNotes: "Ahmed Al Example, ID 1098765432, left hemiparesis after stroke 2024",
  medications: "aspirin",
  mobility: "seated",
  support: "left",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the weekly plan model call (Q32)", () => {
  it("sends conditions as enum keys and no diagnosis notes, medications or identifiers", async () => {
    const plan = createPlan(intake);
    expect(plan.status).toBe("ready");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      }),
    );
    await createWeekly(intake, plan, "test-key");
    expect(bodies).toHaveLength(1);
    const sent = JSON.parse(bodies[0]) as { messages: { content: string }[] };
    const user = sent.messages[1].content;
    const person = JSON.parse(user.slice(user.indexOf("{"), user.indexOf("\n\nSafe candidates")));
    expect(person.conditions).toEqual(["stroke", "arthritis"]);
    expect(person).not.toHaveProperty("diagnosisNotes");
    for (const secret of ["Ahmed", "1098765432", "hemiparesis", "aspirin"])
      expect(bodies[0]).not.toContain(secret);
  });
});
