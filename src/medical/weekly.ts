import library from '../exercises/library.json';
import { getDetailedDisabilityConfig } from './legacy-config';
import { Intake, Plan, types } from './plan';

/** Weekly plan layer. The rules below decide what is SAFE and the dose; an optional
 * language model may only arrange exercises from the already filtered pool and write
 * the explanation. Every model output passes through sanitizeSelection. */

export type L = { ar: string; en: string };
export interface LibraryExercise {
 id: string; name: L; description: L; category: string; muscles: string[]; equipment: string[];
 difficulty: string; minutes: number; steps: { ar: string[]; en: string[] }; tags: string[]; contraindications: string[];
}
export interface WeeklyItem { id: string; sets: number; reps?: number; holdSeconds?: number; note?: L }
export interface WeeklyDay { day: number; focus: L; warmup: WeeklyItem[]; extra: WeeklyItem[]; cooldown: WeeklyItem[] }
export interface WeeklyPlan { source: 'engine' | 'ai'; summary: L; why: L[]; tips: L[]; days: WeeklyDay[] }
export interface Selection {
 summary?: L; why?: L[]; tips?: L[];
 days: { focus?: L; warmup: string[]; extra: string[]; cooldown: string[]; notes?: { id: string; ar: string; en: string }[] }[];
}

export const LIBRARY = library as LibraryExercise[];
export const libraryById = (id: string) => LIBRARY.find(e => e.id === id);

const configsFor = (h: Intake) => h.conditions.filter(c => c !== 'none').map(c => getDetailedDisabilityConfig(types[c] ?? 'other', c));

export function eligibleExercises(h: Intake, plan: Plan): LibraryExercise[] {
 if (plan.status !== 'ready') return [];
 const configs = configsFor(h);
 const avoid = new Set(configs.flatMap(c => c.avoidCategories));
 const highFatigue = configs.some(c => ['high', 'critical'].includes(String(c.fatigueRisk)));
 const painContra = new Set(h.pain.map(p => `${p}_injury`));
 const has = (r: string) => h.restrictions.includes(r);
 return LIBRARY.filter(e => {
  const seatedOk = e.tags.includes('seated') || e.tags.includes('wheelchair_friendly');
  const text = `${e.name.en} ${e.description.en} ${e.steps.en.join(' ')}`;
  if (avoid.has(e.category) || e.difficulty === 'advanced') return false;
  if (highFatigue && e.difficulty !== 'beginner') return false;
  if (e.contraindications.some(c => painContra.has(c))) return false;
  if (h.mobility === 'wheelchair' && !(e.tags.includes('wheelchair_friendly') || (e.tags.includes('seated') && !e.tags.includes('standing')))) return false;
  if (h.mobility === 'seated' && !seatedOk) return false;
  if (h.mobility !== 'standing' && (e.tags.includes('floor_exercise') || e.tags.includes('lying_down'))) return false;
  if (e.equipment.includes('resistance_bands')) return false;
  if (e.equipment.includes('dumbbells') && !h.equipment.includes('weights')) return false;
  if (has('no_resistance') && e.equipment.length) return false;
  if (has('no_overhead') && (/overhead|above (your|the) head/i.test(text) || (/press|raise/i.test(e.name.en) && e.muscles.includes('shoulders')))) return false;
  if (has('no_weight_bearing') && (e.tags.includes('standing') || (['lower_body', 'balance'].includes(e.category) && !seatedOk))) return false;
  if (has('balance_support') && (e.tags.includes('standing') || e.contraindications.includes('severe_balance_issues') || (e.category === 'balance' && !seatedOk))) return false;
  if (h.conditions.includes('upper_limb_unilateral') && e.equipment.includes('dumbbells')) return false;
  return true;
 });
}

const WEIGHTS: Record<Intake['goal'], Record<string, number>> = {
 mobility: { flexibility: .35, balance: .2, core: .2, upper_body: .15, lower_body: .1 },
 strength: { upper_body: .35, core: .25, lower_body: .2, balance: .1, flexibility: .1 },
 habit: { flexibility: .25, upper_body: .2, core: .2, balance: .2, lower_body: .15 },
};

const FOCUS: Record<string, L> = {
 upper_body: { ar: 'قوة الجزء العلوي', en: 'Upper body strength' },
 core: { ar: 'ثبات الجذع', en: 'Core stability' },
 lower_body: { ar: 'قوة الساقين', en: 'Leg strength' },
 balance: { ar: 'التوازن والتحكم', en: 'Balance and control' },
 flexibility: { ar: 'المرونة والحركة', en: 'Flexibility and movement' },
};

const isHold = (e: LibraryExercise) => e.category === 'flexibility' || /stretch|hold|breath/i.test(e.name.en);

export function defaultSelection(h: Intake, plan: Plan, pool: LibraryExercise[]): Selection {
 const configs = configsFor(h);
 const recommended = new Set(configs.flatMap(c => c.recommendedCategories));
 const weights = { ...WEIGHTS[h.goal] };
 for (const k of Object.keys(weights)) if (recommended.has(k)) weights[k] += .1;
 const order = Object.entries(weights).filter(([k]) => k !== 'flexibility').sort((a, b) => b[1] - a[1]).map(([k]) => k);
 const flex = pool.filter(e => e.category === 'flexibility');
 const byCat = (cat: string) => pool.filter(e => e.category === cat);
 const cursor: Record<string, number> = {};
 const next = (list: LibraryExercise[], key: string, used: Set<string>) => {
  for (let tries = 0; tries < list.length; tries++) {
   const e = list[(cursor[key] = ((cursor[key] ?? -1) + 1)) % list.length];
   if (!used.has(e.id)) { used.add(e.id); return e.id; }
  }
  return null;
 };
 const days = plan.days.map((_, d) => {
  const used = new Set<string>();
  const warmup = [next(flex, 'warm', used), next(flex, 'warm', used)].filter(Boolean) as string[];
  const rotated = [...order.slice(d % Math.max(1, order.length)), ...order.slice(0, d % Math.max(1, order.length))];
  const extra: string[] = [];
  for (const cat of rotated) {
   if (extra.length >= 3) break;
   const id = next(byCat(cat), cat, used);
   if (id) extra.push(id);
  }
  const cooldown = [next(flex, 'cool', used), next(flex, 'cool', used)].filter(Boolean) as string[];
  return { warmup, extra, cooldown };
 });
 return { days };
}

const toArabicDigits = (s: string) => s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
export function cleanText(s: unknown, lang: 'ar' | 'en', max: number): string {
 if (typeof s !== 'string') return '';
 const joiner = lang === 'ar' ? '، ' : ', ';
 let out = s.replace(/\s*[—–]\s*/g, joiner).replace(/\s+-\s+/g, joiner).replace(/\s+/g, ' ').trim();
 if (lang === 'ar') out = out.replace(/حالتك الصحية/g, 'حالتك الطبية');
 return out.slice(0, max);
}
const cleanL = (v: any, max: number): L | null => {
 const ar = cleanText(v?.ar, 'ar', max), en = cleanText(v?.en, 'en', max);
 return ar && en ? { ar, en } : null;
};

/** Never trust a model: only pool ids, bounded counts, dose from the rules. */
export function sanitizeSelection(raw: any, plan: Plan, pool: LibraryExercise[], fallback: Selection): Selection {
 const ids = new Set(pool.map(e => e.id));
 const rawDays: any[] = Array.isArray(raw?.days) ? raw.days : [];
 const days = plan.days.map((_, d) => {
  const r = rawDays[d] ?? {}, f = fallback.days[d];
  const used = new Set<string>();
  const take = (list: unknown, max: number, fb: string[]) => {
   const out = (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === 'string' && ids.has(x) && !used.has(x) && (used.add(x), true)).slice(0, max);
   return out.length ? out : fb.filter(x => !used.has(x) && (used.add(x), true)).slice(0, max);
  };
  const warmup = take(r.warmup, 2, f.warmup), extra = take(r.extra, 3, f.extra), cooldown = take(r.cooldown, 2, f.cooldown);
  const notes = (Array.isArray(r.notes) ? r.notes : []).filter((n: any) => ids.has(n?.id)).slice(0, 3)
   .map((n: any) => ({ id: n.id, ar: cleanText(n.ar, 'ar', 140), en: cleanText(n.en, 'en', 140) })).filter((n: any) => n.ar && n.en);
  return { focus: cleanL(r.focus, 40) ?? undefined, warmup, extra, cooldown, notes };
 });
 const list = (v: unknown) => (Array.isArray(v) ? v : []).map(x => cleanL(x, 170)).filter(Boolean).slice(0, 3) as L[];
 return { summary: cleanL(raw?.summary, 340) ?? undefined, why: list(raw?.why), tips: list(raw?.tips), days };
}

export function buildWeekly(h: Intake, plan: Plan, selection: Selection, source: 'engine' | 'ai'): WeeklyPlan {
 const configs = configsFor(h);
 const highFatigue = configs.some(c => ['high', 'critical'].includes(String(c.fatigueRisk)));
 const base = plan.exercises[0];
 const sets = Math.max(1, Math.min(base?.sets ?? 2, 3)), reps = Math.max(4, Math.min(base?.reps ?? 8, 12));
 const hold = highFatigue ? 15 : 25;
 const item = (id: string, slot: 'warmup' | 'extra' | 'cooldown', notes?: { id: string; ar: string; en: string }[]): WeeklyItem => {
  const e = libraryById(id)!;
  const note = notes?.find(n => n.id === id);
  const dose: WeeklyItem = isHold(e)
   ? { id, sets: slot === 'extra' ? Math.min(sets, 2) : 1, holdSeconds: slot === 'cooldown' ? hold + 5 : hold }
   : { id, sets: slot === 'extra' ? sets : 1, reps: slot === 'extra' ? reps : Math.min(reps, 8) };
  return note ? { ...dose, note: { ar: note.ar, en: note.en } } : dose;
 };
 const days: WeeklyDay[] = plan.days.map((day, d) => {
  const s = selection.days[d];
  const extras = s.extra.map(id => libraryById(id)!).filter(Boolean);
  const dominant = extras[0]?.category ?? 'flexibility';
  return {
   day, focus: s.focus ?? FOCUS[dominant] ?? FOCUS.flexibility,
   warmup: s.warmup.map(id => item(id, 'warmup', s.notes)),
   extra: s.extra.map(id => item(id, 'extra', s.notes)),
   cooldown: s.cooldown.map(id => item(id, 'cooldown', s.notes)),
  };
 });
 const n = plan.days.length;
 const summary: L = selection.summary ?? {
  ar: toArabicDigits(`خطة من ${n} أيام في الأسبوع، مبنية على حالتك الطبية. كل يوم يبدأ بإحماء، ثم تمرين بالكاميرا يعدّ ويصحّح، ثم تمارين مختارة من مكتبة عزم، وينتهي بتهدئة.`),
  en: `A ${n} day weekly plan built on your medical condition. Each day opens with a warm up, moves into a camera session that counts and corrects, adds exercises chosen from the Azm library, and closes with a cool down.`,
 };
 const why: L[] = selection.why?.length ? selection.why : [
  { ar: 'استبعدنا كل تمرين لا يناسب وضعيتك أو ألمك أو تعليمات طبيبك.', en: 'Every exercise that conflicts with your position, pain, or clinician instructions was removed.' },
  { ar: 'المجموعات والتكرارات محسوبة بقواعد حالتك الطبية، ولا تتجاوزها أي خطة.', en: 'Sets and repetitions come from the rules for your medical condition, and no plan exceeds them.' },
  { ar: 'نوّعنا التمارين بين الأيام حتى تتحرك عضلات مختلفة وتأخذ كل منها وقتها للراحة.', en: 'Exercises vary across days so different muscles work and each gets time to recover.' },
 ];
 const tips: L[] = selection.tips?.length ? selection.tips : [
  { ar: 'توقّف فورًا إن شعرت بألم حاد أو دوخة أو ضيق في التنفس.', en: 'Stop straight away if you feel sharp pain, dizziness, or shortness of breath.' },
  ...(configs.some(c => c.thermoregulationWarning) ? [{ ar: 'تمرّن في مكان معتدل الحرارة، واشرب الماء قبل الجلسة وبعدها.', en: 'Train somewhere cool and drink water before and after each session.' }] : [{ ar: 'اشرب الماء قبل الجلسة وبعدها، وجهّز كرسيك ومساحتك مسبقًا.', en: 'Drink water before and after, and set up your chair and space in advance.' }]),
  { ar: 'الانتظام أهم من الشدة، فجلسة قصيرة كل موعد أنفع من جلسة طويلة متقطعة.', en: 'Consistency beats intensity. A short session on every planned day does more than one long session now and then.' },
 ];
 return { source, summary, why, tips, days };
}

export function engineWeekly(h: Intake, plan: Plan): WeeklyPlan | null {
 if (plan.status !== 'ready' || !plan.days.length) return null;
 const pool = eligibleExercises(h, plan);
 return buildWeekly(h, plan, defaultSelection(h, plan, pool), 'engine');
}
