import { Intake, Plan } from "../src/medical/plan";
import {
  buildWeekly,
  defaultSelection,
  eligibleExercises,
  LibraryExercise,
  libraryById,
  sanitizeSelection,
  WeeklyPlan,
} from "../src/medical/weekly";
import { EXERCISES } from "../src/exercises/defs";
import { sportById } from "../src/medical/sports";
import type { TargetedBuild } from "../src/medical/targets";

/** Weekly plan composer. The rules engine has already filtered for safety and fixed the dose;
 * the model only arranges approved exercises and writes the explanation. Any failure falls
 * back to the rules engine's own arrangement, so a plan is always produced. */

const LSTR = {
  type: "object",
  additionalProperties: false,
  required: ["ar", "en"],
  properties: { ar: { type: "string" }, en: { type: "string" } },
};

const SYSTEM_PROMPT = `You are the weekly planning layer of AZM SPARK, an AI fitness coach for adults whose medical condition changes how they should exercise. This is fitness and sport, not rehabilitation or treatment.

A deterministic medical rules engine has ALREADY removed every unsafe exercise and fixed the dose. You receive only safe candidates. Your job:
1. For each training day, choose warmup (2 ids, prefer flexibility), extra (2 or 3 ids that serve the person's goal and vary across days), and cooldown (2 ids, prefer flexibility, different from that day's warmup). Use ONLY candidate ids. Do not repeat the same extra exercise on consecutive days when alternatives exist.
2. focus: a short title for the day, 2 to 4 words, in Arabic and English.
3. notes: up to 2 short practical form cues for exercises chosen that day, tied to the person's condition (for example the affected side). Never include numbers of sets, reps, or seconds.
4. summary: two warm sentences addressed to the person, naming their medical condition and their goal, explaining how the week is shaped around them.
5. why: exactly 3 short reasons, each tied to something concrete in their profile (a restriction, a pain area, their mobility, their condition).
6. tips: exactly 3 practical tips specific to their condition (warning signs to stop, energy, temperature, consistency).
7. When the goal is "sport", the person is working toward the para sport in "sport" (name it as "name" in English and "nameAr" in Arabic), and "sport.demands" lists what that sport asks of the body. Each candidate lists the demands it builds. Choose extras that build those demands and cover every demand across the week; title each day by the demand it builds (for example قوة الدفع, Pushing power). Name the sport in the summary and in at least one why reason. Never say the person is ready for the sport, cleared to play, or that the plan guarantees anything; clubs and readiness checks come later, outside this plan.

The person's conditions are enum keys (for example stroke, ms, cerebral_palsy, sci_complete, sci_incomplete, parkinsons, arthritis, cfs_moderate, lower_limb_unilateral, upper_limb_unilateral, none); name them in plain words.

8. When "fixed" is given, a rules engine has already chosen exercises for the person's movement results: each fixed exercise belongs to one day and one block, with its reason ("why"). Keep every fixed exercise exactly where it is and never change, repeat or reword its reason. Fill only the remaining slots of each block from the candidates. In the summary, say that the week is built on the person's movement results as well as their medical condition and goal.

Language rules: Arabic is warm Modern Standard Arabic with Saudi warmth. Always write حالتك الطبية, never حالتك الصحية. English is natural, not a literal translation. Never use dash characters of any kind. Never diagnose, never promise treatment or recovery, never mention doses, never recommend medication. Speak to one person.`;

/** The fixed finding items of a targeted week as the model reads them: per day and block, with their why lines. */
function fixedFor(targeted: TargetedBuild, plan: Plan) {
  const why = new Map(targeted.items.map((i) => [i.exerciseId, i.why]));
  return plan.days.map((_, d) => {
    const day = targeted.fixed.days[d] ?? { warmup: [], extra: [], cooldown: [] };
    const block = (ids: string[]) => ids.map((id) => ({ id, why: why.get(id) }));
    return { warmup: block(day.warmup), extra: block(day.extra), cooldown: block(day.cooldown) };
  });
}

async function askModel(
  h: Intake,
  plan: Plan,
  pool: LibraryExercise[],
  key: string,
  fixed?: ReturnType<typeof fixedFor>,
) {
  const ids = pool.map((e) => e.id);
  const schema = {
    type: "json_schema",
    json_schema: {
      name: "weekly_plan",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "why", "tips", "days"],
        properties: {
          summary: LSTR,
          why: { type: "array", items: LSTR },
          tips: { type: "array", items: LSTR },
          days: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["focus", "warmup", "extra", "cooldown", "notes"],
              properties: {
                focus: LSTR,
                warmup: { type: "array", items: { type: "string", enum: ids } },
                extra: { type: "array", items: { type: "string", enum: ids } },
                cooldown: { type: "array", items: { type: "string", enum: ids } },
                notes: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "ar", "en"],
                    properties: {
                      id: { type: "string", enum: ids },
                      ar: { type: "string" },
                      en: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const sport = h.goal === "sport" ? sportById(h.sport) : undefined;
  // Q32: no identifier and no free text in a model call. The conditions go as enum keys only; the
  // diagnosis notes (typed, or read from a report, and able to hold a name or an ID number) and the
  // medications never leave the server.
  const profile = {
    age: h.age,
    conditions: [...h.conditions],
    mobility: h.mobility,
    affectedSide: h.support,
    painAreas: h.pain,
    restrictions: h.restrictions,
    goal: h.goal,
    sport: sport && { name: sport.name.en, nameAr: sport.name.ar, demands: sport.demands },
    trainingDays: plan.days.length,
    cameraExercisesEachDay: plan.exercises.map((e) => EXERCISES.find((x) => x.id === e.exerciseId)?.name.en),
  };
  const candidates = pool.map((e) => ({
    id: e.id,
    name: e.name.en,
    nameAr: e.name.ar,
    category: e.category,
    difficulty: e.difficulty,
    muscles: e.muscles,
    equipment: e.equipment,
    demands: e.demands,
  }));
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(50000),
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.5,
      max_tokens: 2800,
      response_format: schema,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Person:\n${JSON.stringify(profile)}\n\nSafe candidates:\n${JSON.stringify(candidates)}${
            fixed ? `\n\nFixed (keep each where it is, its why unchanged):\n${JSON.stringify(fixed)}` : ""
          }\n\nPlan exactly ${plan.days.length} training days.`,
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`ENGINE_${r.status}`);
  const data = (await r.json()) as any;
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

/**
 * The weekly plan of a ready plan. With `targeted` (v7, contract 2.10: a week the findings built), the
 * model may word the summary, the reasons and tips and arrange the goal's share, but it receives the
 * finding items with their why lines as fixed text, and sanitizeSelection keeps them in their day and
 * block with their dose and why line; without a key, or when the model fails, the rules' week stands.
 */
export async function createWeekly(
  h: Intake,
  plan: Plan,
  key?: string,
  targeted?: TargetedBuild,
): Promise<WeeklyPlan | null> {
  if (plan.status !== "ready" || !plan.days.length) return null;
  if (targeted) {
    if (!key) return targeted.weekly;
    try {
      const fixed = fixedFor(targeted, plan);
      const chosen = targeted.items.map((i) => libraryById(i.exerciseId)!).filter(Boolean);
      const raw = await askModel(h, plan, [...chosen, ...targeted.pool], key, fixed);
      const selection = sanitizeSelection(raw, plan, targeted.pool, targeted.selection, targeted.fixed);
      return {
        ...buildWeekly(h, plan, selection, "ai", targeted.items),
        findings: targeted.weekly.findings,
      };
    } catch (err) {
      console.error("AZM weekly plan model failed", err instanceof Error ? err.message : "Error");
      return targeted.weekly;
    }
  }
  const pool = eligibleExercises(h, plan);
  const fallback = defaultSelection(h, plan, pool);
  if (!key || !pool.length) return buildWeekly(h, plan, fallback, "engine");
  try {
    const raw = await askModel(h, plan, pool, key);
    return buildWeekly(h, plan, sanitizeSelection(raw, plan, pool, fallback), "ai");
  } catch (err) {
    console.error("AZM weekly plan model failed", err instanceof Error ? err.message : "Error");
    return buildWeekly(h, plan, fallback, "engine");
  }
}
