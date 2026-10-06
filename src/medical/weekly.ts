import { Intake, Plan } from "./plan";
import {
  CAMERA_TWINS,
  configsFor,
  LIBRARY,
  libraryById,
  libraryPool,
  type L,
  type LibraryExercise,
} from "./pool";
import { CAMERA_DEMANDS, DEMANDS, sportById, type DemandTag, type Sport } from "./sports";
import type { TargetedItem, WeeklyItemV7Fields, WeeklyPlanFindingsRef } from "./target-types";

/** Weekly plan layer. The rules below decide what is SAFE and the dose; an optional
 * language model may only arrange exercises from the already filtered pool and write
 * the explanation. Every model output passes through sanitizeSelection. */

export { LIBRARY, libraryById, type L, type LibraryExercise };
/** v7 (product v7 contract 2.10): optional targets, why line and reasons of a targeted item. */
export interface WeeklyItem extends WeeklyItemV7Fields {
  id: string;
  sets: number;
  reps?: number;
  holdSeconds?: number;
  note?: L;
  /**
   * v7 (E1-8, D-026 item 9): the hold the steps of a targeted item name with {hold_ar} and {hold_en}
   * («٣٠ ثانية», «لحظة» on the pain path), resolved when the item was built (stepsOf).
   */
  hold?: L;
}
export interface WeeklyDay {
  day: number;
  focus: L;
  warmup: WeeklyItem[];
  extra: WeeklyItem[];
  cooldown: WeeklyItem[];
}
export interface WeeklyPlan {
  source: "engine" | "ai";
  summary: L;
  why: L[];
  tips: L[];
  days: WeeklyDay[];
  /** v7: present on a targeted weekly, the focus check it was built from (product v7 contract 2.10). */
  findings?: WeeklyPlanFindingsRef;
}
export interface Selection {
  summary?: L;
  why?: L[];
  tips?: L[];
  days: {
    focus?: L;
    warmup: string[];
    extra: string[];
    cooldown: string[];
    notes?: { id: string; ar: string; en: string }[];
  }[];
}

/** The safe library exercises for a ready plan (pool.ts); none while the plan is in review. */
export function eligibleExercises(h: Intake, plan: Plan): LibraryExercise[] {
  if (plan.status !== "ready") return [];
  return libraryPool(h);
}

const WEIGHTS: Record<Exclude<Intake["goal"], "sport">, Record<string, number>> = {
  mobility: { flexibility: 0.35, balance: 0.2, core: 0.2, upper_body: 0.15, lower_body: 0.1 },
  strength: { upper_body: 0.35, core: 0.25, lower_body: 0.2, balance: 0.1, flexibility: 0.1 },
  habit: { flexibility: 0.25, upper_body: 0.2, core: 0.2, balance: 0.2, lower_body: 0.15 },
};

const FOCUS: Record<string, L> = {
  upper_body: { ar: "قوة الجزء العلوي", en: "Upper body strength" },
  core: { ar: "ثبات الجذع", en: "Core stability" },
  lower_body: { ar: "قوة الساقين", en: "Leg strength" },
  balance: { ar: "التوازن والتحكم", en: "Balance and control" },
  flexibility: { ar: "المرونة والحركة", en: "Flexibility and movement" },
};

const isHold = (e: LibraryExercise) => e.category === "flexibility" || /stretch|hold|breath/i.test(e.name.en);

/** The cards of a day's blocks: 2 to warm up, 3 of the day's exercises, 2 to cool down. */
export const BLOCK_SIZES = { warmup: 2, extra: 3, cooldown: 2 } as const;

/** The library exercises that are the same movement as a camera movement of the plan. */
export const cameraTwins = (plan: Pick<Plan, "exercises">) =>
  new Set(
    plan.exercises.flatMap((e) => [
      e.exerciseId,
      ...(CAMERA_TWINS[e.exerciseId] ? [CAMERA_TWINS[e.exerciseId]] : []),
    ]),
  );

/** The sport of a sport goal, or undefined for the other goals. */
const goalSport = (h: Intake): Sport | undefined => (h.goal === "sport" ? sportById(h.sport) : undefined);

/**
 * The rules' own week for a sport goal (B4). The pool is already safe; here the sport's demands
 * weight the choice. The extras go round the sport's demands across the week (flexibility is left to
 * the warm up and cool down), each from the safe exercises that build that demand, the ones that
 * build more of the sport first. Each day is named after the first demand it builds.
 */
function sportSelection(plan: Plan, pool: LibraryExercise[], sport: Sport): Selection {
  const wants = (e: LibraryExercise) => e.demands.filter((d) => sport.demands.includes(d)).length;
  const ranked = (list: LibraryExercise[]) => [...list].sort((a, b) => wants(b) - wants(a));
  const flex = ranked(pool.filter((e) => e.category === "flexibility"));
  // The camera movements are done every training day already: the library copy of one is not repeated.
  const camera = cameraTwins(plan);
  const work = pool.filter((e) => e.category !== "flexibility" && !camera.has(e.id));
  const targets = sport.demands.filter((d) => d !== "flexibility");
  const builders = new Map(targets.map((d) => [d, ranked(work.filter((e) => e.demands.includes(d)))]));
  const helpful = ranked(work.filter((e) => wants(e) > 0));
  const cursor: Record<string, number> = {};
  /** The next exercise of a list not used today, and not an extra of the day before when another fits. */
  let yesterday = new Set<string>();
  const next = (list: LibraryExercise[], key: string, used: Set<string>) => {
    for (const avoid of [yesterday, new Set<string>()])
      for (let tries = 0; tries < list.length; tries++) {
        const e = list[(cursor[key] = (cursor[key] ?? -1) + 1) % list.length];
        if (!used.has(e.id) && !avoid.has(e.id)) {
          used.add(e.id);
          return e.id;
        }
      }
    return null;
  };
  // The demands the safe pool can build, taken in turn across the whole week, so a short week still
  // reaches each of them and each day opens on a different one.
  const buildable = targets.filter((d) => builders.get(d)!.length);
  let turn = 0;
  const days = plan.days.map(() => {
    const used = new Set<string>();
    const warmup = [next(flex, "warm", used), next(flex, "warm", used)].filter(Boolean) as string[];
    const extra: string[] = [];
    let focus: DemandTag | undefined;
    for (let tries = 0; extra.length < 3 && tries < buildable.length * 3; tries++) {
      const demand = buildable[turn++ % buildable.length];
      const id = next(builders.get(demand)!, demand, used);
      if (!id) continue;
      extra.push(id);
      focus ??= demand;
    }
    while (extra.length < 3) {
      const id = next(helpful, "helpful", used) ?? next(work, "any", used);
      if (!id) break;
      extra.push(id);
    }
    const cooldown = [next(flex, "cool", used), next(flex, "cool", used)].filter(Boolean) as string[];
    yesterday = new Set(extra);
    return { focus: focus ? DEMANDS[focus] : undefined, warmup, extra, cooldown };
  });
  return { days };
}

export function defaultSelection(h: Intake, plan: Plan, pool: LibraryExercise[]): Selection {
  const sport = goalSport(h);
  if (sport) return sportSelection(plan, pool, sport);
  const configs = configsFor(h);
  const recommended = new Set(configs.flatMap((c) => c.recommendedCategories));
  const weights = { ...WEIGHTS[h.goal === "sport" ? "strength" : h.goal] };
  for (const k of Object.keys(weights)) if (recommended.has(k)) weights[k] += 0.1;
  const order = Object.entries(weights)
    .filter(([k]) => k !== "flexibility")
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  const flex = pool.filter((e) => e.category === "flexibility");
  const byCat = (cat: string) => pool.filter((e) => e.category === cat);
  const cursor: Record<string, number> = {};
  const next = (list: LibraryExercise[], key: string, used: Set<string>) => {
    for (let tries = 0; tries < list.length; tries++) {
      const e = list[(cursor[key] = (cursor[key] ?? -1) + 1) % list.length];
      if (!used.has(e.id)) {
        used.add(e.id);
        return e.id;
      }
    }
    return null;
  };
  const days = plan.days.map((_, d) => {
    const used = new Set<string>();
    const warmup = [next(flex, "warm", used), next(flex, "warm", used)].filter(Boolean) as string[];
    const rotated = [
      ...order.slice(d % Math.max(1, order.length)),
      ...order.slice(0, d % Math.max(1, order.length)),
    ];
    const extra: string[] = [];
    for (const cat of rotated) {
      if (extra.length >= 3) break;
      const id = next(byCat(cat), cat, used);
      if (id) extra.push(id);
    }
    const cooldown = [next(flex, "cool", used), next(flex, "cool", used)].filter(Boolean) as string[];
    return { warmup, extra, cooldown };
  });
  return { days };
}

const toArabicDigits = (s: string) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
export function cleanText(s: unknown, lang: "ar" | "en", max: number): string {
  if (typeof s !== "string") return "";
  const joiner = lang === "ar" ? "، " : ", ";
  let out = s
    .replace(/\s*[—–]\s*/g, joiner)
    .replace(/\s+-\s+/g, joiner)
    .replace(/\s+/g, " ")
    .trim();
  if (lang === "ar") out = out.replace(/حالتك الصحية/g, "حالتك الطبية");
  return out.slice(0, max);
}
const cleanL = (v: any, max: number): L | null => {
  const ar = cleanText(v?.ar, "ar", max),
    en = cleanText(v?.en, "en", max);
  return ar && en ? { ar, en } : null;
};

/** Never trust a model: only pool ids, bounded counts, dose from the rules. */
export function sanitizeSelection(
  raw: any,
  plan: Plan,
  pool: LibraryExercise[],
  fallback: Selection,
  /**
   * v7 (contract 2.10): the items the findings fixed, kept first in their day and block whatever the
   * model asks; the model fills the rest of each block from the pool.
   */
  fixed?: Selection,
): Selection {
  const ids = new Set(pool.map((e) => e.id));
  const rawDays: any[] = Array.isArray(raw?.days) ? raw.days : [];
  const days = plan.days.map((_, d) => {
    const r = rawDays[d] ?? {},
      f = fallback.days[d];
    const keep = fixed?.days[d] ?? { warmup: [], extra: [], cooldown: [] };
    const used = new Set<string>([...keep.warmup, ...keep.extra, ...keep.cooldown]);
    const take = (list: unknown, max: number, fb: string[]) => {
      const out = (Array.isArray(list) ? list : [])
        .filter(
          (x): x is string => typeof x === "string" && ids.has(x) && !used.has(x) && (used.add(x), true),
        )
        .slice(0, max);
      return out.length ? out : fb.filter((x) => !used.has(x) && (used.add(x), true)).slice(0, max);
    };
    const block = (k: "warmup" | "extra" | "cooldown", list: unknown) => [
      ...keep[k],
      ...take(list, Math.max(0, BLOCK_SIZES[k] - keep[k].length), f[k]),
    ];
    const warmup = block("warmup", r.warmup),
      extra = block("extra", r.extra),
      cooldown = block("cooldown", r.cooldown);
    const day = new Set([...warmup, ...extra, ...cooldown]);
    const notes = (Array.isArray(r.notes) ? r.notes : [])
      .filter((n: any) => ids.has(n?.id) || (fixed !== undefined && day.has(n?.id)))
      .slice(0, 3)
      .map((n: any) => ({ id: n.id, ar: cleanText(n.ar, "ar", 140), en: cleanText(n.en, "en", 140) }))
      .filter((n: any) => n.ar && n.en);
    return { focus: cleanL(r.focus, 40) ?? undefined, warmup, extra, cooldown, notes };
  });
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => cleanL(x, 170))
      .filter(Boolean)
      .slice(0, 3) as L[];
  return {
    summary: cleanL(raw?.summary, 340) ?? undefined,
    why: list(raw?.why),
    tips: list(raw?.tips),
    days,
  };
}

/**
 * An exercise's steps for one weekly item: a targeted item's hold in place of the {hold_ar} and
 * {hold_en} its steps name (E1-8; selectForTargets resolves it from the dose profile and the age, «لحظة»
 * on the pain path). Other steps are shown as they are.
 */
export function stepsOf(
  e: Pick<LibraryExercise, "steps">,
  item: Pick<WeeklyItem, "hold">,
  lang: "ar" | "en",
): string[] {
  const hold = item.hold?.[lang];
  return hold ? e.steps[lang].map((s) => s.replaceAll(`{hold_${lang}}`, hold)) : e.steps[lang];
}

/**
 * An exercise serves a result of the check, which its link opens: a range finding, a pattern of the
 * walk or a support finding of the walk (E2-4). A region default, the wheelchair shoulder care and the
 * arthritis add on come from the history.
 */
export function servesResult(reasons: readonly { kind: string }[] | undefined): boolean {
  return (reasons ?? []).some((r) => r.kind === "rom" || r.kind === "gait" || r.kind === "gait_finding");
}

/** Arabic counted days: the singular, the dual, then the plural of 3 to 10 and the singular accusative from 11. */
function arabicDays(n: number): string {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

/**
 * The summary of a weekly plan as shown. A plan stored before F-6 (v5.0 and early 6.0) keeps the
 * rules text «خطة من ١ أيام» or «خطة من ٢ أيام» until it is rebuilt; it reads with the singular or
 * the dual, as new plans do (R-13). Any other summary is shown as it is.
 */
export function summaryText(summary: L, lang: "ar" | "en"): string {
  if (lang !== "ar") return summary.en;
  return summary.ar.replace(
    /^خطة من ([١٢]) أيام /,
    (_, n: string) => `خطة من ${arabicDays(n === "١" ? 1 : 2)} `,
  );
}

/**
 * The weekly plan of a selection: the rules' dose for each item, or, for the items the findings chose
 * (v7, contract 2.10: `targeted`), the dose of their profile with their why line, targets and reasons
 * as selectForTargets built them; no model output reaches those.
 */
export function buildWeekly(
  h: Intake,
  plan: Plan,
  selection: Selection,
  source: "engine" | "ai",
  targeted: readonly TargetedItem[] = [],
): WeeklyPlan {
  const chosen = new Map(targeted.map((t) => [t.exerciseId, t]));
  const configs = configsFor(h);
  const highFatigue = configs.some((c) => ["high", "critical"].includes(String(c.fatigueRisk)));
  const base = plan.exercises[0];
  const sets = Math.max(1, Math.min(base?.sets ?? 2, 3)),
    reps = Math.max(4, Math.min(base?.reps ?? 8, 12));
  const hold = highFatigue ? 15 : 25;
  const item = (
    id: string,
    slot: "warmup" | "extra" | "cooldown",
    notes?: { id: string; ar: string; en: string }[],
  ): WeeklyItem => {
    const e = libraryById(id)!;
    const note = notes?.find((n) => n.id === id);
    const target = chosen.get(id);
    const dose: WeeklyItem = target
      ? { ...target.dose }
      : isHold(e)
        ? {
            id,
            sets: slot === "extra" ? Math.min(sets, 2) : 1,
            holdSeconds: slot === "cooldown" ? hold + 5 : hold,
          }
        : { id, sets: slot === "extra" ? sets : 1, reps: slot === "extra" ? reps : Math.min(reps, 8) };
    return note ? { ...dose, note: { ar: note.ar, en: note.en } } : dose;
  };
  const days: WeeklyDay[] = plan.days.map((day, d) => {
    const s = selection.days[d];
    const extras = s.extra.map((id) => libraryById(id)!).filter(Boolean);
    const dominant = extras[0]?.category ?? "flexibility";
    return {
      day,
      focus: s.focus ?? FOCUS[dominant] ?? FOCUS.flexibility,
      warmup: s.warmup.map((id) => item(id, "warmup", s.notes)),
      extra: s.extra.map((id) => item(id, "extra", s.notes)),
      cooldown: s.cooldown.map((id) => item(id, "cooldown", s.notes)),
    };
  });
  const n = plan.days.length;
  const sport = goalSport(h);
  const sportName = sport && { ar: sport.name.ar, en: sport.name.en.toLowerCase() };
  // Booth v2 (D): without a camera movement, each day is guided cards from the warm up to the cool down.
  const camera = plan.exercises.length > 0;
  const middle = {
    ar: sportName
      ? camera
        ? "ثم تمرين بالكاميرا يعدّ ويصحّح، ثم تمارين تبني ما تحتاجه هذه الرياضة"
        : "ثم تمارين موجّهة خطوة بخطوة تبني ما تحتاجه هذه الرياضة"
      : camera
        ? "ثم تمرين بالكاميرا يعدّ ويصحّح، ثم تمارين مختارة من مكتبة عزم"
        : "ثم تمارين موجّهة خطوة بخطوة من مكتبة عزم",
    en: sportName
      ? camera
        ? "moves into a camera session that counts and corrects, adds exercises that build what this sport asks of you"
        : "moves through guided exercises that build what this sport asks of you"
      : camera
        ? "moves into a camera session that counts and corrects, adds exercises chosen from the Azm library"
        : "moves through guided exercises chosen from the Azm library",
  };
  const summary: L =
    selection.summary ??
    (targeted.length
      ? {
          // v7: a week built from the findings (contract 2.10).
          ar: toArabicDigits(
            `خطة من ${arabicDays(n)} في الأسبوع، مبنية على حالتك الطبية ونتائج قياس حركتك. في كل يوم تمارين اخترناها لنتائجك، ولكل منها سبب واضح، ${
              sportName ? `وبقية الجلسة تبني ما تحتاجه ${sportName.ar}.` : "وبقية الجلسة لهدفك."
            }`,
          ),
          en: `A ${n} day weekly plan built on your medical condition and your movement results. Each day holds exercises chosen for your results, each with a clear reason, and the rest of the session ${
            sportName ? `builds what ${sportName.en} asks of you.` : "follows your goal."
          }`,
        }
      : {
          ar: toArabicDigits(
            sportName
              ? `خطة من ${arabicDays(n)} في الأسبوع، مبنية على حالتك الطبية ومتّجهة نحو ${sportName.ar}. كل يوم يبدأ بإحماء، ${middle.ar}، وينتهي بتهدئة.`
              : `خطة من ${arabicDays(n)} في الأسبوع، مبنية على حالتك الطبية. كل يوم يبدأ بإحماء، ${middle.ar}، وينتهي بتهدئة.`,
          ),
          en: sportName
            ? `A ${n} day weekly plan built on your medical condition and aimed at ${sportName.en}. Each day opens with a warm up, ${middle.en}, and closes with a cool down.`
            : `A ${n} day weekly plan built on your medical condition. Each day opens with a warm up, ${middle.en}, and closes with a cool down.`,
        });
  const why: L[] = selection.why?.length
    ? selection.why
    : [
        ...(targeted.length
          ? [
              {
                ar: "اخترنا لكل نتيجة تحتاج عملًا تمارين آمنة لحالتك الطبية، ولكل تمرين منها سطر يقول لماذا أضفناه.",
                en: "For each result that needs work, we chose exercises that are safe for your medical condition, and each one says why we added it.",
              },
            ]
          : []),
        {
          ar: "استبعدنا كل تمرين لا يناسب وضعيتك أو ألمك أو تعليمات طبيبك.",
          en: "Every exercise that conflicts with your position, pain, or clinician instructions was removed.",
        },
        ...(sport && sportName
          ? [
              {
                ar: `ومن التمارين الآمنة اخترنا ما يبني متطلبات ${sportName.ar}: ${listOf(
                  sport.demands.slice(0, 3).map((d) => DEMANDS[d].ar),
                  "ar",
                )}.`,
                en: `From the safe exercises, we chose those that build what ${sportName.en} asks for: ${listOf(
                  sport.demands.slice(0, 3).map((d) => DEMANDS[d].en.toLowerCase()),
                  "en",
                )}.`,
              },
            ]
          : []),
        {
          ar: "المجموعات والتكرارات محسوبة بقواعد حالتك الطبية، ولا تتجاوزها أي خطة.",
          en: "Sets and repetitions come from the rules for your medical condition, and no plan exceeds them.",
        },
        ...(sport
          ? []
          : [
              {
                ar: "نوّعنا التمارين بين الأيام حتى تتحرك عضلات مختلفة وتأخذ كل منها وقتها للراحة.",
                en: "Exercises vary across days so different muscles work and each gets time to recover.",
              },
            ]),
      ];
  const tips: L[] = selection.tips?.length
    ? selection.tips
    : [
        {
          ar: "توقّف فورًا إن شعرت بألم حاد أو دوخة أو ضيق في التنفس.",
          en: "Stop straight away if you feel sharp pain, dizziness, or shortness of breath.",
        },
        ...(configs.some((c) => c.thermoregulationWarning)
          ? [
              {
                ar: "تمرّن في مكان معتدل الحرارة، واشرب الماء قبل الجلسة وبعدها.",
                en: "Train somewhere cool and drink water before and after each session.",
              },
            ]
          : [
              {
                ar: "اشرب الماء قبل الجلسة وبعدها، وجهّز كرسيك ومساحتك مسبقًا.",
                en: "Drink water before and after, and set up your chair and space in advance.",
              },
            ]),
        {
          ar: "الانتظام أهم من الشدة، فجلسة قصيرة كل موعد أنفع من جلسة طويلة متقطعة.",
          en: "Consistency beats intensity. A short session on every planned day does more than one long session now and then.",
        },
      ];
  return { source, summary, why, tips, days };
}

/** "a, b and c" in English; «أ، وب، وج» in Arabic. */
function listOf(items: string[], lang: "ar" | "en"): string {
  if (lang === "ar") return items.join("، و");
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export interface PathStep {
  demand: DemandTag;
  /** The exercises of this week that build the demand: the camera movements first, then the library. */
  exercises: { id: string; camera: boolean }[];
}

/**
 * The sport path (B5): each demand of the sport with the exercises of this week that build it. The
 * camera movements are known from the plan; the library exercises come with the weekly plan (null
 * while it is being written, so the camera movements show alone).
 */
export function sportPath(sport: Sport, plan: Plan, weekly: WeeklyPlan | null | undefined): PathStep[] {
  const camera = cameraTwins(plan);
  const week = [
    ...new Set(
      (weekly?.days ?? []).flatMap((d) => [...d.extra, ...d.warmup, ...d.cooldown].map((i) => i.id)),
    ),
  ].filter((id) => !camera.has(id));
  return sport.demands.map((demand) => ({
    demand,
    exercises: [
      ...plan.exercises
        .filter((e) => (CAMERA_DEMANDS[e.exerciseId] ?? []).includes(demand))
        .map((e) => ({ id: e.exerciseId, camera: true })),
      ...week.filter((id) => libraryById(id)?.demands.includes(demand)).map((id) => ({ id, camera: false })),
    ],
  }));
}

export function engineWeekly(h: Intake, plan: Plan): WeeklyPlan | null {
  if (plan.status !== "ready" || !plan.days.length) return null;
  const pool = eligibleExercises(h, plan);
  return buildWeekly(h, plan, defaultSelection(h, plan, pool), "engine");
}
