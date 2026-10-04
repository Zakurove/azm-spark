/**
 * Report reading suggests body map regions (product v7 contract 2.2 and section 4): only with
 * AZM_V7=1 does POST /api/medical-report add `regions` to its extraction schema, its instruction and
 * its answer; the person applies a suggestion with a tap (the intake form). With the flag off the
 * route asks and answers exactly as before, and the booth reading never asks for regions.
 *
 * PUT /api/intake accepts and validates the v7 fields whether or not AZM_V7 is on (contract C-9,
 * 2.2): a valid v7 intake is stored and read back, an invalid v7 field or a broken pain mirror is
 * 400 INTAKE_INVALID, and an intake without v7 fields saves as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createApi } from "../../server/api";
import {
  extractReport,
  extractionSchema,
  reportPrompt,
  sanitizeExtraction,
  sanitizeRegions,
} from "../../server/report";
import { PROBLEM_TYPES, REGION_IDS } from "../../src/medical/body-map";
import type { Intake } from "../../src/medical/plan";

const MODEL_ANSWER = {
  document: "medical_report",
  age: 58,
  conditions: ["stroke"],
  diagnosisNotes: "Right hemiparesis.",
  medications: "",
  mobility: "standing",
  support: "right",
  pain: ["shoulder"],
  restrictions: [],
  symptoms: "unknown",
  recentChange: "unknown",
  missing: [],
  questions: [],
  summary: "Stroke with right side weakness.",
  confidence: "high",
  regions: [
    { region: "shoulder", side: "right", problems: ["weakness", "pain", "pain"] },
    { region: "neck", side: "left", problems: ["stiffness"] },
    { region: "spine", side: "axial", problems: ["pain"] },
    { region: "knee", side: "axial", problems: ["bruise", "injury"] },
    { region: "shoulder", side: "right", problems: ["stiffness"] },
  ],
};

describe("the extraction schema and instruction", () => {
  const props = (o: { regions?: boolean }) =>
    extractionSchema(o).json_schema.schema as { properties: Record<string, unknown>; required: string[] };

  it("are unchanged with the flag off", () => {
    expect(props({}).properties).not.toHaveProperty("regions");
    expect(props({}).required).not.toContain("regions");
    expect(extractionSchema({ regions: false })).toEqual(extractionSchema({}));
    expect(reportPrompt("Arabic", {})).not.toMatch(/regions/);
    expect(reportPrompt("English", {})).toContain('in English in "questions"');
  });

  it("ask for regions with the flag on, in the app's ids only", () => {
    const p = props({ regions: true });
    expect(p.required).toContain("regions");
    expect(p.properties.regions).toEqual({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["region", "side", "problems"],
        properties: {
          region: { type: "string", enum: [...REGION_IDS] },
          side: { type: "string", enum: ["left", "right", "both", "axial", "unknown"] },
          problems: { type: "array", items: { type: "string", enum: [...PROBLEM_TYPES] } },
        },
      },
    });
    const prompt = reportPrompt("Arabic", { regions: true });
    expect(prompt.startsWith(reportPrompt("Arabic", {}))).toBe(true);
    for (const id of [...REGION_IDS, ...PROBLEM_TYPES]) expect(prompt).toContain(id);
    expect(prompt).toMatch(/never infer/i);
  });
});

describe("sanitizing the suggested regions", () => {
  it("keeps only the app's regions, sides and problem types, one suggestion per region and side", () => {
    expect(sanitizeRegions(MODEL_ANSWER.regions)).toEqual([
      { region: "shoulder", side: "right", problems: ["weakness", "pain", "stiffness"] },
      { region: "neck", side: "axial", problems: ["stiffness"] },
      { region: "knee", side: "unknown", problems: ["injury"] },
    ]);
    expect(sanitizeRegions("shoulder")).toEqual([]);
    expect(sanitizeRegions([null, 3, { region: "hip" }])).toEqual([
      { region: "hip", side: "unknown", problems: [] },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({
      region: REGION_IDS[i % 8],
      side: ["left", "right", "both", "unknown"][Math.floor(i / 8)],
      problems: ["pain"],
    }));
    expect(sanitizeRegions(many).length).toBe(16);
  });

  it("adds regions to the extraction only when asked", () => {
    expect(sanitizeExtraction(MODEL_ANSWER).extracted).not.toHaveProperty("regions");
    expect(sanitizeExtraction(MODEL_ANSWER, { regions: true }).extracted.regions).toEqual(
      sanitizeRegions(MODEL_ANSWER.regions),
    );
    expect(sanitizeExtraction({}, { regions: true }).extracted.regions).toEqual([]);
  });
});

/** A fetch that answers the model call and passes every other request through. */
function stubModel(answer: unknown) {
  const real = globalThis.fetch.bind(globalThis);
  const sent: Record<string, any>[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).startsWith("https://api.openai.com/")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return real(input, init);
  });
  return { sent, spy };
}

describe("extractReport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the v1 request and answers without regions by default (the booth reading)", async () => {
    const { sent } = stubModel(MODEL_ANSWER);
    const r = await extractReport({ kind: "text", text: "report", lang: "ar" }, "test-key");
    expect(sent[0].response_format).toEqual(extractionSchema({}));
    expect(sent[0].messages[0].content).toBe(reportPrompt("Arabic", {}));
    expect(r.extracted).not.toHaveProperty("regions");
  });

  it("asks for and returns the regions when asked", async () => {
    const { sent } = stubModel(MODEL_ANSWER);
    const r = await extractReport({ kind: "text", text: "report", lang: "en" }, "test-key", {
      regions: true,
    });
    expect(sent[0].response_format).toEqual(extractionSchema({ regions: true }));
    expect(sent[0].messages[0].content).toBe(reportPrompt("English", { regions: true }));
    expect(r.extracted.regions).toEqual(sanitizeRegions(MODEL_ANSWER.regions));
  });
});

describe("the routes", () => {
  let server: Server;
  let service: ReturnType<typeof createApi>;
  let origin = "";
  let headers: Record<string, string> = {};
  const prev = { key: process.env.OPENAI_API_KEY, v7: process.env.AZM_V7 };

  beforeAll(async () => {
    service = createApi(":memory:");
    server = createServer((req, res) => void service.handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    headers = { origin, "Content-Type": "application/json", "X-Azm-Request": "1" };
    const reg = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Body Map",
        email: "body-map@example.test",
        password: "test-password-7702",
        adultConfirmed: true,
      }),
    });
    headers.cookie = reg.headers.get("set-cookie")!.split(";")[0];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (prev.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev.key;
    if (prev.v7 === undefined) delete process.env.AZM_V7;
    else process.env.AZM_V7 = prev.v7;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    service.close();
  });

  const read = (body: Record<string, unknown>) =>
    fetch(`${origin}/api/medical-report`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "text", text: "تقرير", lang: "ar", reportConsent: true, ...body }),
    });

  it("POST /api/medical-report asks for regions only with AZM_V7=1", async () => {
    process.env.OPENAI_API_KEY = "test-key-never-used";
    for (const flag of [undefined, "0", "1"]) {
      if (flag === undefined) delete process.env.AZM_V7;
      else process.env.AZM_V7 = flag;
      vi.restoreAllMocks();
      const { sent } = stubModel(MODEL_ANSWER);
      const r = await read({});
      expect(r.status).toBe(200);
      const body = (await r.json()) as { extracted: Record<string, unknown> };
      const on = flag === "1";
      expect(sent[0].response_format).toEqual(extractionSchema({ regions: on }));
      if (on) expect(body.extracted.regions).toEqual(sanitizeRegions(MODEL_ANSWER.regions));
      else expect(body.extracted).not.toHaveProperty("regions");
    }
  });

  const intake: Intake = {
    age: 58,
    conditions: ["stroke"],
    diagnosisNotes: "",
    medications: "",
    mobility: "standing",
    support: "right",
    pain: ["shoulder"],
    restrictions: [],
    symptoms: "no",
    recentChange: "no",
    clearance: "yes",
    equipment: [],
    goal: "mobility",
    days: [0, 2, 4],
    time: "09:00",
    sessionMinutes: 30,
    consent: true,
    sex: "male",
    regions: [
      { region: "shoulder", side: "right", problems: ["weakness", "pain"], origin: "condition" },
      { region: "knee", side: "right", problems: ["weakness"], origin: "condition" },
    ],
    walking: { status: "with_aid", aid: "cane" },
    heightCm: 172,
    romFlags: { osteoporosis: false, neckCaution: false, sitUnsupported: "yes" },
  };
  const put = (body: unknown) =>
    fetch(`${origin}/api/intake`, { method: "PUT", headers, body: JSON.stringify(body) });

  it("PUT /api/intake stores the v7 fields with the flag on or off", async () => {
    for (const flag of [undefined, "1"]) {
      if (flag === undefined) delete process.env.AZM_V7;
      else process.env.AZM_V7 = flag;
      const r = await put(intake);
      expect(r.status).toBe(200);
      expect(((await r.json()) as { intake: Intake }).intake).toEqual(intake);
      const me = (await (await fetch(`${origin}/api/auth/me`, { headers })).json()) as { intake: Intake };
      expect(me.intake).toEqual(intake);
    }
  });

  it("PUT /api/intake rejects an invalid v7 field and a broken pain mirror, with the flag on or off", async () => {
    for (const flag of [undefined, "1"]) {
      if (flag === undefined) delete process.env.AZM_V7;
      else process.env.AZM_V7 = flag;
      for (const bad of [
        { ...intake, sex: "x" },
        { ...intake, walking: { status: "with_aid" } },
        { ...intake, heightCm: 300 },
        { ...intake, regions: [{ region: "knee", side: "both", problems: [], origin: "person" }] },
        { ...intake, pain: [] },
        { ...intake, mobility: "bed" },
      ]) {
        const r = await put(bad);
        expect(r.status).toBe(400);
        expect(await r.json()).toEqual({ error: "INTAKE_INVALID" });
      }
    }
  });

  it("PUT /api/intake saves an intake without v7 fields as before", async () => {
    const v1: Record<string, unknown> = { ...intake };
    for (const k of ["sex", "regions", "walking", "heightCm", "romFlags"]) delete v1[k];
    const r = await put(v1);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { intake: unknown }).intake).toEqual(v1);
  });
});
