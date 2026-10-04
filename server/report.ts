import { conditions, painOptions, restrictionOptions } from "../src/medical/plan";
import {
  AXIAL_REGIONS,
  MAX_REGION_ENTRIES,
  PROBLEM_TYPES,
  REGION_IDS,
  type ProblemType,
  type RegionId,
  type ReportRegion,
} from "../src/medical/body-map";

/** Medical-report extraction: one OpenAI call per upload, conservative by design.
 * The raw report is never stored; only sanitized intake fields return to the client.
 *
 * v7 (contract 2.2 and section 4): with AZM_V7=1 the home report reading also suggests body map
 * regions (ExtractOptions.regions, passed by POST /api/medical-report). The suggestions are shown
 * with origin "report" and applied only by the person's tap. The booth reading never asks for them. */

const MOBILITY = ["seated", "wheelchair", "standing", "bed"] as const;
const EXTRACT_FIELDS = [
  "age",
  "conditions",
  "mobility",
  "support",
  "pain",
  "restrictions",
  "symptoms",
  "recentChange",
  "medications",
] as const;

const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "intake_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "document",
        "age",
        "conditions",
        "diagnosisNotes",
        "medications",
        "mobility",
        "support",
        "pain",
        "restrictions",
        "symptoms",
        "recentChange",
        "missing",
        "questions",
        "summary",
        "confidence",
      ],
      properties: {
        document: {
          type: "string",
          enum: ["medical_report", "other_medical_document", "not_medical", "unreadable"],
        },
        age: { type: ["integer", "null"] },
        conditions: {
          type: "array",
          items: { type: "string", enum: conditions.filter((c) => c !== "none") },
        },
        diagnosisNotes: { type: "string" },
        medications: { type: "string" },
        mobility: { type: "string", enum: [...MOBILITY, "unknown"] },
        support: { type: "string", enum: ["left", "right", "unknown"] },
        pain: { type: "array", items: { type: "string", enum: [...painOptions] } },
        restrictions: { type: "array", items: { type: "string", enum: [...restrictionOptions] } },
        symptoms: { type: "string", enum: ["yes", "unknown"] },
        recentChange: { type: "string", enum: ["yes", "unknown"] },
        missing: { type: "array", items: { type: "string", enum: [...EXTRACT_FIELDS] } },
        questions: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  },
};

const SYSTEM_PROMPT = `You extract health-intake fields from a medical report for an adaptive exercise-planning app. The report may be in Arabic or English, pasted as text or photographed/scanned.

Rules:
1. Extract ONLY what the report states explicitly. Never infer, estimate, or fill gaps. If a field is not clearly stated, use "unknown" (or null / empty array) and add the field name to "missing".
2. NEVER extract or infer medical clearance to exercise. Clearance is not part of your output. A report's existence, a doctor's signature, or a rehabilitation referral is NOT clearance.
3. Map explicit diagnoses to EXACTLY these condition keys: stroke (CVA, cerebral infarction, stroke-related hemiplegia or hemiparesis); ms (multiple sclerosis); cerebral_palsy; sci_complete (spinal cord injury stated as complete / ASIA A); sci_incomplete (SCI stated as incomplete / ASIA B-D); parkinsons; lower_limb_unilateral (amputation of one lower limb); upper_limb_unilateral (amputation of one upper limb); arthritis (osteoarthritis or rheumatoid arthritis); cfs_moderate (ME/CFS); cardiac (ANY cardiac diagnosis: coronary artery disease, heart failure, arrhythmia, post-MI, valve disease). Any other explicit diagnosis (for example TBI, fibromyalgia, osteoporosis, bilateral amputation, diabetes, SCI with unstated completeness) maps to "other" AND must be named in diagnosisNotes. Never output a condition the report does not state, and never decide the patient has no conditions.
4. symptoms = "yes" only if the report explicitly documents exertional chest pain, syncope or fainting, or unusual breathlessness. recentChange = "yes" only if it explicitly documents recent deterioration, a new injury, or surgery without documented permission to resume exercise. Otherwise "unknown". Never answer for the patient.
5. pain: include a region key only for pain the report documents as current (shoulder, elbow, wrist, back, hip, knee). restrictions: include a key only for an explicit clinician instruction: no_overhead (no overhead movement), no_resistance (no resistance training), no_weight_bearing, no_exercise (exercise prohibited), balance_support (needs support or supervision for balance).
6. age: only from an explicitly stated age or birth date. mobility: only from explicit statements. A full-time wheelchair user is "wheelchair"; bedbound is "bed"; otherwise "unknown". support: "left" or "right" only when the report names an affected or weaker side.
7. diagnosisNotes: a brief, faithful summary of diagnoses and clinician instructions in the report's own terms, at most 1000 characters. medications: medication names as written, comma-separated. No commentary, no advice.
8. If the input is not a medical document or is unreadable, set "document" accordingly and leave every field empty or unknown.
9. List every unestablished field name in "missing". For genuine ambiguities, write up to 5 short clarifying questions in {{LANG}} in "questions". Write "summary" in {{LANG}}, at most 300 characters, stating plainly what was understood.`;

/** What a reading asks the model for beyond the v1 fields. */
export interface ExtractOptions {
  /** The v7 body map suggestions (AZM_V7=1 on the home report route only). */
  regions?: boolean;
}

const REGION_SIDES = ["left", "right", "both", "axial", "unknown"] as const;
const REGIONS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["region", "side", "problems"],
    properties: {
      region: { type: "string", enum: [...REGION_IDS] },
      side: { type: "string", enum: [...REGION_SIDES] },
      problems: { type: "array", items: { type: "string", enum: [...PROBLEM_TYPES] } },
    },
  },
};

/** The response format of a reading: the v1 schema, plus the regions when asked. */
export function extractionSchema(opts: ExtractOptions = {}): typeof SCHEMA {
  if (!opts.regions) return SCHEMA;
  const schema = SCHEMA.json_schema.schema;
  return {
    ...SCHEMA,
    json_schema: {
      ...SCHEMA.json_schema,
      schema: {
        ...schema,
        required: [...schema.required, "regions"],
        properties: { ...schema.properties, regions: REGIONS_SCHEMA } as typeof schema.properties,
      },
    },
  };
}

const REGIONS_RULE = `10. regions: the body regions the report documents as currently affected, one item per region and side, with exactly these region ids: neck; back_trunk (the back, the trunk or the spine); shoulder; elbow; forearm_wrist (the forearm, the wrist or the hand); hip; knee; ankle_foot (the ankle or the foot). An arm named as a whole gives shoulder, elbow and forearm_wrist; a leg named as a whole gives hip, knee and ankle_foot. side: left or right when the report names the side, both when it names both sides, axial for neck and back_trunk, otherwise unknown. problems: only the types the report documents for that region: weakness (weakness or paralysis), injury (a joint, ligament or tendon injury), pain, stiffness (stiffness or a contracture), after_surgery (an operation on that region), limb_loss (an amputation, given on the joint just above it: knee for a below knee amputation, hip for an above knee one, elbow for a below elbow one, shoulder for an above elbow one). List a region only when the report names that body part or limb, and never infer a region from a diagnosis alone. These are suggestions the person confirms.`;

/** The system instruction of a reading: the v1 rules, plus the regions rule when asked. */
export function reportPrompt(lang: "Arabic" | "English", opts: ExtractOptions = {}): string {
  const base = SYSTEM_PROMPT.replaceAll("{{LANG}}", lang);
  return opts.regions ? `${base}\n${REGIONS_RULE}` : base;
}

export interface Extraction {
  document: string;
  extracted: {
    age: number | null;
    conditions: string[];
    diagnosisNotes: string;
    medications: string;
    mobility: string;
    support: string;
    pain: string[];
    restrictions: string[];
    symptoms: string;
    recentChange: string;
    /** v7, only when the reading asked for regions (ExtractOptions.regions). */
    regions?: ReportRegion[];
  };
  missing: string[];
  questions: string[];
  summary: string;
  confidence: string;
}

/**
 * The suggested regions, re-validated: the app's region ids and problem types only, an axial side
 * for the neck and the back or trunk, an unknown side for a limb given none, one suggestion per
 * region and side (problem types merged), at most 16.
 */
export function sanitizeRegions(v: unknown): ReportRegion[] {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, ReportRegion>();
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!(REGION_IDS as readonly unknown[]).includes(r.region)) continue;
    const region = r.region as RegionId;
    const given = (REGION_SIDES as readonly unknown[]).includes(r.side)
      ? (r.side as ReportRegion["side"])
      : "unknown";
    const side = AXIAL_REGIONS.includes(region) ? "axial" : given === "axial" ? "unknown" : given;
    const problems = Array.isArray(r.problems) ? r.problems : [];
    const key = `${region}:${side}`;
    const merged = new Set<unknown>([...(out.get(key)?.problems ?? []), ...problems]);
    if (!out.has(key) && out.size >= MAX_REGION_ENTRIES) continue;
    // A limb loss belongs to an arm or a leg, never to the neck or the back.
    const problemsOf = PROBLEM_TYPES.filter(
      (p): p is ProblemType => merged.has(p) && !(p === "limb_loss" && side === "axial"),
    );
    out.set(key, { region, side, problems: problemsOf });
  }
  return [...out.values()];
}

/** Never trust model output: re-validate every value against the app's own enums. */
export function sanitizeExtraction(raw: any, opts: ExtractOptions = {}): Extraction {
  const list = (v: unknown, allowed: readonly string[]) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x) => typeof x === "string" && x !== "none" && allowed.includes(x)))]
      : [];
  const pick = (v: unknown, allowed: readonly string[], fallback: string) =>
    typeof v === "string" && allowed.includes(v) ? v : fallback;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const age = Number.isInteger(raw?.age) && raw.age >= 18 && raw.age <= 100 ? raw.age : null;
  return {
    document: pick(
      raw?.document,
      ["medical_report", "other_medical_document", "not_medical", "unreadable"],
      "unreadable",
    ),
    extracted: {
      age,
      conditions: list(raw?.conditions, conditions),
      diagnosisNotes: text(raw?.diagnosisNotes, 1200),
      medications: text(raw?.medications, 1200),
      mobility: pick(raw?.mobility, [...MOBILITY], "unknown"),
      support: pick(raw?.support, ["left", "right"], "unknown"),
      pain: list(raw?.pain, painOptions),
      restrictions: list(raw?.restrictions, restrictionOptions),
      symptoms: pick(raw?.symptoms, ["yes"], "unknown"),
      recentChange: pick(raw?.recentChange, ["yes"], "unknown"),
      ...(opts.regions ? { regions: sanitizeRegions(raw?.regions) } : {}),
    },
    missing: list(raw?.missing, EXTRACT_FIELDS),
    questions: Array.isArray(raw?.questions)
      ? raw.questions
          .filter((q: unknown) => typeof q === "string")
          .slice(0, 5)
          .map((q: string) => q.slice(0, 200))
      : [],
    summary: text(raw?.summary, 300),
    confidence: pick(raw?.confidence, ["low", "medium", "high"], "low"),
  };
}

export function validReportBody(
  body: any,
): body is { kind: "text" | "image"; text?: string; image?: string; lang?: "ar" | "en" } {
  if (!body || typeof body !== "object") return false;
  if (body.lang !== undefined && !["ar", "en"].includes(body.lang)) return false;
  if (body.kind === "text")
    return typeof body.text === "string" && body.text.trim().length >= 1 && body.text.length <= 20000;
  if (body.kind === "image") {
    if (
      typeof body.image !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)
    )
      return false;
    const base64 = body.image.slice(body.image.indexOf(",") + 1);
    return base64.length * 0.75 <= 4 * 1024 * 1024;
  }
  return false;
}

export async function extractReport(
  body: { kind: "text" | "image"; text?: string; image?: string; lang?: "ar" | "en" },
  key: string,
  opts: ExtractOptions = {},
): Promise<Extraction> {
  const lang = body.lang === "en" ? "English" : "Arabic";
  const user =
    body.kind === "text"
      ? [{ type: "text", text: `Report text:\n${body.text}` }]
      : [
          { type: "text", text: "Extract intake fields from this medical report image." },
          { type: "image_url", image_url: { url: body.image, detail: "high" } },
        ];
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      // Up to 16 suggested regions need room beside the v1 fields.
      max_tokens: opts.regions ? 1600 : 1200,
      response_format: extractionSchema(opts),
      messages: [
        { role: "system", content: reportPrompt(lang, opts) },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ENGINE_${r.status}`);
  const data = (await r.json()) as any;
  return sanitizeExtraction(JSON.parse(data.choices?.[0]?.message?.content ?? "{}"), opts);
}
