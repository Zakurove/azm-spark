/**
 * The booth v2 journey routes (contract C2 and C8), with a valid booth pass only, nothing stored and
 * nothing logged:
 *
 *   POST /api/booth/report { session, kind: "image", image, lang }  the same extractReport as at home;
 *        the pass is also sent as X-Azm-Booth, so the photo's larger body cap is granted from the
 *        headers before anything is buffered; 30 reads per pass in 15 minutes.
 *   POST /api/booth/plan { session, intake }  createPlan, then the weekly plan (the model with the
 *        rules fallback); 30 per pass in 15 minutes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { planFor, storyBase } from "../src/features/booth/intake";
import { SAAD_EXTRACTION, SAAD_GOAL } from "../src/features/booth/story";
import { startApi, type Harness } from "./check-api-harness";

const MIN = 60 * 1000;
/** 2026-10-11 10:00 in Riyadh: the first booth day. */
const BOOTH_DAY = Date.UTC(2026, 9, 11, 7, 0, 0);
/** 2026-10-04: not a booth day. */
const NOT_BOOTH = Date.UTC(2026, 9, 4, 7, 0, 0);
const CODE = "482913";
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U";
const SECRET_NOTE = "Saad private note 7781";

let h: Harness;
const setTime = (t: number) => vi.setSystemTime(t);
const realFetch = globalThis.fetch;

/** The model's answers (OpenAI is never called from a test): a canned body per call, or a failure. */
let modelReply: (body: any) => Response | Promise<Response> = () => new Response("{}", { status: 500 });
const modelCalls: any[] = [];

beforeAll(async () => {
  h = await startApi();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.openai.com/")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      modelCalls.push(body);
      return modelReply(body);
    }
    return realFetch(input, init);
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await h.close();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setTime(BOOTH_DAY);
  process.env.AZM_BOOTH_CODE = CODE;
  delete process.env.OPENAI_API_KEY;
  modelCalls.length = 0;
  modelReply = () => new Response("{}", { status: 500 });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.AZM_BOOTH_CODE;
  delete process.env.OPENAI_API_KEY;
});

let ipSeq = 0;
/** A fresh staff pass of the booth day (each from its own address, so the verify limits never bite). */
async function pass(): Promise<string> {
  const r = await h.call("/booth/verify", { code: CODE }, "", "POST", {
    "x-forwarded-for": `198.51.100.${++ipSeq}`,
  });
  expect(r.data.ok).toBe(true);
  return r.data.session as string;
}

const report = (session: string, body: Record<string, unknown> = {}, header: string | null = session) =>
  h.call("/booth/report", { session, kind: "image", image: IMAGE, lang: "ar", ...body }, "", "POST", {
    ...(header === null ? {} : { "x-azm-booth": header }),
    "x-forwarded-for": "203.0.113.50",
  });

const plan = (session: string, intake: unknown) =>
  h.call("/booth/plan", { session, intake }, "", "POST", { "x-forwarded-for": "203.0.113.60" });

const saad = () => planFor(storyBase(SAAD_EXTRACTION), SAAD_GOAL.goal, SAAD_GOAL.sport).intake;

/** Every row of every table, to prove a route stored nothing. */
function snapshot(): Record<string, number> {
  const db = h.inspect();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  return Object.fromEntries(
    tables.map((t) => [
      t.name,
      Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n),
    ]),
  );
}

function consoleSpies() {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  return {
    printed: () => spies.flatMap((s) => s.mock.calls.flat().map((a) => String(a))).join("\n"),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

const extraction = (over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              document: "medical_report",
              age: 22,
              conditions: ["sci_incomplete"],
              diagnosisNotes: "Incomplete spinal cord injury at T10",
              medications: "Baclofen 10 mg",
              mobility: "wheelchair",
              support: "unknown",
              pain: [],
              restrictions: [],
              symptoms: "unknown",
              recentChange: "unknown",
              missing: ["support"],
              questions: [],
              summary: "إصابة غير كاملة في الحبل الشوكي",
              confidence: "high",
              ...over,
            }),
          },
        },
      ],
    }),
    { status: 200 },
  );

describe("POST /api/booth/report", () => {
  it("refuses without a valid booth pass, before reading the body", async () => {
    // No header at all: refused from the headers, even with a body far over the default cap.
    const big = await h.call(
      "/booth/report",
      { session: "a".repeat(64), kind: "image", image: IMAGE + "A".repeat(200_000) },
      "",
      "POST",
    );
    expect(big.status).toBe(401);
    expect(big.data).toEqual({ error: "BOOTH_REQUIRED" });
    // A pass the server never issued.
    expect((await report("b".repeat(64))).status).toBe(401);
    // A real pass in the header but none in the body.
    const s = await pass();
    expect((await report("c".repeat(64), {}, s)).status).toBe(401);
    // Outside the booth days a pass no longer holds.
    setTime(NOT_BOOTH);
    expect((await report(s)).status).toBe(401);
  });

  it("reads the report with the pass: the same extraction as at home, sanitized", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    modelReply = () => extraction({ conditions: ["sci_incomplete", "made_up"], mobility: "hoverboard" });
    const s = await pass();
    const before = snapshot();
    const r = await report(s, { lang: "en" });
    expect(r.status).toBe(200);
    expect(r.data.document).toBe("medical_report");
    expect(r.data.extracted.conditions).toEqual(["sci_incomplete"]);
    expect(r.data.extracted.mobility).toBe("unknown");
    expect(r.data.extracted).not.toHaveProperty("clearance");
    // One model call, carrying the image, in English.
    expect(modelCalls).toHaveLength(1);
    expect(JSON.stringify(modelCalls[0])).toContain(IMAGE);
    expect(modelCalls[0].messages[0].content).toContain("in English");
    // Nothing stored: not the image, not a consent row, not a count.
    expect(snapshot()).toEqual(before);
  });

  it("takes a photo larger than the default cap with the pass, and refuses one over 6 MB", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    modelReply = () => extraction();
    const s = await pass();
    const photo = IMAGE + "A".repeat(400_000);
    expect((await report(s, { image: photo })).status).toBe(200);
    const huge = "data:image/jpeg;base64," + "A".repeat(6 * 1024 * 1024 + 10);
    expect((await report(s, { image: huge })).status).toBe(413);
  });

  it("refuses bodies that do not fit", async () => {
    const s = await pass();
    for (const body of [
      { kind: "text", text: "تقرير" },
      { image: "https://example.com/report.jpg" },
      { image: "data:text/html;base64,aGVsbG8=" },
      { lang: "fr" },
      { extra: 1 },
    ]) {
      const r = await report(s, body);
      expect(r.status).toBe(400);
      expect(r.data).toEqual({ error: "REPORT_INVALID" });
    }
  });

  it("answers 503 without a reading engine and 502 when the engine fails, and logs nothing", async () => {
    const s = await pass();
    const out = consoleSpies();
    try {
      const none = await report(s);
      expect(none.status).toBe(503);
      expect(none.data).toEqual({ error: "EXTRACTION_UNAVAILABLE" });
      process.env.OPENAI_API_KEY = "test-key";
      modelReply = () => new Response("down", { status: 500 });
      const failed = await report(s);
      expect(failed.status).toBe(502);
      expect(failed.data).toEqual({ error: "ENGINE_FAILED" });
      modelReply = () => extraction({ diagnosisNotes: SECRET_NOTE });
      expect((await report(s)).status).toBe(200);
      expect(out.printed()).toBe("");
    } finally {
      out.restore();
    }
  });

  it("allows 30 reads per pass in 15 minutes; another pass keeps its own", async () => {
    const s = await pass();
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await report(s)).status);
    expect(codes.slice(0, 30).every((c) => c === 503)).toBe(true);
    expect(codes[30]).toBe(429);
    expect((await report(await pass())).status).toBe(503);
    setTime(BOOTH_DAY + 15 * MIN + 1000);
    expect((await report(s)).status).toBe(503);
  });
});

describe("POST /api/booth/plan", () => {
  it("refuses without a valid booth pass", async () => {
    expect((await plan("a".repeat(64), saad())).status).toBe(401);
    expect((await plan(undefined as unknown as string, saad())).data).toEqual({ error: "BOOTH_REQUIRED" });
  });

  it("refuses an intake that does not validate", async () => {
    const s = await pass();
    for (const intake of [null, {}, { ...saad(), age: 12 }, { ...saad(), goal: "sport", sport: "chess" }]) {
      const r = await plan(s, intake);
      expect(r.status).toBe(400);
      expect(r.data).toEqual({ error: "INTAKE_INVALID" });
    }
    const extra = await h.call("/booth/plan", { session: s, intake: saad(), user: "x" }, "", "POST");
    expect(extra.status).toBe(400);
  });

  it("answers the plan and the rules' weekly plan without a model, storing nothing", async () => {
    const s = await pass();
    const before = snapshot();
    const r = await plan(s, saad());
    expect(r.status).toBe(200);
    expect(r.data.plan.status).toBe("ready");
    expect(r.data.plan.exclusions).toEqual([{ exerciseId: "sit_to_stand", reason: "standing" }]);
    expect(r.data.weekly.source).toBe("engine");
    expect(r.data.weekly.days).toHaveLength(3);
    expect(modelCalls).toHaveLength(0);
    expect(snapshot()).toEqual(before);
  });

  it("asks the model to arrange the week when it can, naming the sport, never the notes", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    modelReply = () => new Response("down", { status: 500 });
    const s = await pass();
    const intake = { ...saad(), diagnosisNotes: SECRET_NOTE, medications: SECRET_NOTE };
    const out = consoleSpies();
    try {
      const r = await plan(s, intake);
      // The model failed: the rules' week stands.
      expect(r.status).toBe(200);
      expect(r.data.weekly.source).toBe("engine");
      expect(modelCalls).toHaveLength(1);
      const sent = JSON.stringify(modelCalls[0]);
      expect(sent).toContain("Wheelchair basketball");
      expect(sent).not.toContain(SECRET_NOTE);
      expect(out.printed()).not.toContain(SECRET_NOTE);
    } finally {
      out.restore();
    }
  });

  it("answers a plan in review with no weekly plan: the rules said no", async () => {
    const s = await pass();
    const r = await plan(s, { ...saad(), clearance: "no" });
    expect(r.status).toBe(200);
    expect(r.data.plan.status).toBe("review");
    expect(r.data.plan.reasons).toContain("clearance");
    expect(r.data.weekly).toBeNull();
  });

  it("allows 30 plans per pass in 15 minutes", async () => {
    const s = await pass();
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await plan(s, saad())).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
