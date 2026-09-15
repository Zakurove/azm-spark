import { Intake, Plan } from '../src/medical/plan';
import { buildWeekly, defaultSelection, eligibleExercises, LibraryExercise, sanitizeSelection, WeeklyPlan } from '../src/medical/weekly';
import { optionNames } from '../src/app/platform-copy';
import { EXERCISES } from '../src/exercises/defs';

/** Weekly plan composer. The rules engine has already filtered for safety and fixed the dose;
 * the model only arranges approved exercises and writes the explanation. Any failure falls
 * back to the rules engine's own arrangement, so a plan is always produced. */

const LSTR = { type: 'object', additionalProperties: false, required: ['ar', 'en'], properties: { ar: { type: 'string' }, en: { type: 'string' } } };

const SYSTEM_PROMPT = `You are the weekly planning layer of AZM SPARK, an AI fitness coach for adults whose medical condition changes how they should exercise. This is fitness and sport, not rehabilitation or treatment.

A deterministic medical rules engine has ALREADY removed every unsafe exercise and fixed the dose. You receive only safe candidates. Your job:
1. For each training day, choose warmup (2 ids, prefer flexibility), extra (2 or 3 ids that serve the person's goal and vary across days), and cooldown (2 ids, prefer flexibility, different from that day's warmup). Use ONLY candidate ids. Do not repeat the same extra exercise on consecutive days when alternatives exist.
2. focus: a short title for the day, 2 to 4 words, in Arabic and English.
3. notes: up to 2 short practical form cues for exercises chosen that day, tied to the person's condition (for example the affected side). Never include numbers of sets, reps, or seconds.
4. summary: two warm sentences addressed to the person, naming their medical condition and their goal, explaining how the week is shaped around them.
5. why: exactly 3 short reasons, each tied to something concrete in their profile (a restriction, a pain area, their mobility, their condition).
6. tips: exactly 3 practical tips specific to their condition (warning signs to stop, energy, temperature, consistency).

Language rules: Arabic is warm Modern Standard Arabic with Saudi warmth. Always write حالتك الطبية, never حالتك الصحية. English is natural, not a literal translation. Never use dash characters of any kind. Never diagnose, never promise treatment or recovery, never mention doses, never recommend medication. Speak to one person.`;

async function askModel(h: Intake, plan: Plan, pool: LibraryExercise[], key: string) {
 const ids = pool.map(e => e.id);
 const schema = {
  type: 'json_schema',
  json_schema: {
   name: 'weekly_plan', strict: true,
   schema: {
    type: 'object', additionalProperties: false, required: ['summary', 'why', 'tips', 'days'],
    properties: {
     summary: LSTR, why: { type: 'array', items: LSTR }, tips: { type: 'array', items: LSTR },
     days: {
      type: 'array', items: {
       type: 'object', additionalProperties: false, required: ['focus', 'warmup', 'extra', 'cooldown', 'notes'],
       properties: {
        focus: LSTR,
        warmup: { type: 'array', items: { type: 'string', enum: ids } },
        extra: { type: 'array', items: { type: 'string', enum: ids } },
        cooldown: { type: 'array', items: { type: 'string', enum: ids } },
        notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'ar', 'en'], properties: { id: { type: 'string', enum: ids }, ar: { type: 'string' }, en: { type: 'string' } } } },
       },
      },
     },
    },
   },
  },
 };
 const profile = {
  age: h.age,
  conditions: h.conditions.map(c => ({ en: optionNames[c]?.en ?? c, ar: optionNames[c]?.ar ?? c })),
  diagnosisNotes: h.diagnosisNotes.slice(0, 700),
  mobility: h.mobility, affectedSide: h.support, painAreas: h.pain, restrictions: h.restrictions, goal: h.goal,
  trainingDays: plan.days.length,
  cameraExercisesEachDay: plan.exercises.map(e => EXERCISES.find(x => x.id === e.exerciseId)?.name.en),
 };
 const candidates = pool.map(e => ({ id: e.id, name: e.name.en, nameAr: e.name.ar, category: e.category, difficulty: e.difficulty, muscles: e.muscles, equipment: e.equipment }));
 const r = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(50000),
  body: JSON.stringify({
   model: 'gpt-4o', temperature: 0.5, max_tokens: 2800, response_format: schema,
   messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Person:\n${JSON.stringify(profile)}\n\nSafe candidates:\n${JSON.stringify(candidates)}\n\nPlan exactly ${plan.days.length} training days.` },
   ],
  }),
 });
 if (!r.ok) throw new Error(`ENGINE_${r.status}`);
 const data = await r.json() as any;
 return JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
}

export async function createWeekly(h: Intake, plan: Plan, key?: string): Promise<WeeklyPlan | null> {
 if (plan.status !== 'ready' || !plan.days.length) return null;
 const pool = eligibleExercises(h, plan);
 const fallback = defaultSelection(h, plan, pool);
 if (!key || !pool.length) return buildWeekly(h, plan, fallback, 'engine');
 try {
  const raw = await askModel(h, plan, pool, key);
  return buildWeekly(h, plan, sanitizeSelection(raw, plan, pool, fallback), 'ai');
 } catch (err) {
  console.error('AZM weekly plan model failed', err instanceof Error ? err.message : 'Error');
  return buildWeekly(h, plan, fallback, 'engine');
 }
}
