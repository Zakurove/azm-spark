import type { Lang } from "./i18n";

/**
 * The words of the guided cards (booth v2, contract D): the cards of a session (GuidedCard.tsx), the
 * camera part's opening screen between them, and the card details of the weekly plan. Arabic first,
 * complete English; the numbers are filled in by the screens.
 */
type Num = (n: number) => string;
/** «٨ تكرارات», «مجموعتان × ٨ تكرارات», «٣ مجموعات × ١٠ تكرارات». */
const arReps = (sets: number, reps: number, f: Num) => {
  const r = `${f(reps)} ${reps >= 3 && reps <= 10 ? "تكرارات" : "تكرارًا"}`;
  if (sets === 1) return r;
  return `${sets === 2 ? "مجموعتان" : `${f(sets)} مجموعات`} × ${r}`;
};
const enReps = (sets: number, reps: number, f: Num) =>
  sets === 1 ? `${f(reps)} reps` : `${f(sets)} sets × ${f(reps)} reps`;

const ar = {
  slot: { warmup: "الإحماء", extra: "تمارين اليوم", cooldown: "التهدئة" },
  /** "{n} of {total}" in the top bar. */
  progress: (n: string, total: string) => `${n} من ${total}`,
  progressLabel: (n: string, total: string) => `التمرين ${n} من ${total} في جلستك`,
  steps: "الخطوات",
  setOf: (n: string, total: string) => `المجموعة ${n} من ${total}`,
  start: "ابدأ",
  pause: "إيقاف مؤقت",
  resume: "تابع",
  seconds: "ثانية",
  holdHint: "اثبت بهدوء وتنفّس",
  of: (total: string) => `من ${total}`,
  tapHint: "اضغط الدائرة بعد كل تكرار",
  tapLabel: (n: string, total: string) => `احسب تكرارًا، ${n} من ${total}`,
  rest: "راحة",
  restNext: (n: string) => `ثم المجموعة ${n}`,
  setDone: (n: string) => `أحسنت، انتهت المجموعة ${n}`,
  allDone: "أحسنت، انتهى التمرين",
  done: "تم",
  saving: "جارٍ الحفظ…",
  saveError: "تعذّر الحفظ. حاول مجددًا.",
  skipExercise: "تخطَّ هذا التمرين",
  exit: "العودة للبرنامج",
  equipment: { resistance_bands: "شريط مقاومة", dumbbells: "دمبل" } as Record<string, string>,
  timer: "مؤقّت",
  counter: "عدّاد",
  /** The camera part's opening screen, after the warm up cards. */
  cameraKicker: "التمرين بالكاميرا",
  cameraBody: "ضع الهاتف حيث يراك، ثم ابدأ. يعدّ عزم تكراراتك ويرشدك في حركتك.",
  cameraDose: (sets: number, reps: number, f: Num) => arReps(sets, reps, f),
  /** The weekly plan: how an item is done in the session; My results: a card done. */
  guided: "بطاقة موجّهة",
  heldSeconds: "ثوانٍ من الثبات",
  repsDone: "تكرارات مكتملة",
  setsDone: "المجموعات",
  doseHold: (sets: number, seconds: number, f: Num) =>
    sets === 1 ? `${f(seconds)} ثانية` : `${sets === 2 ? "مرتان" : `${f(sets)} مرات`} × ${f(seconds)} ثانية`,
  doseReps: (sets: number, reps: number, f: Num) => arReps(sets, reps, f),
};

type GuidedCopy = typeof ar;

const en: GuidedCopy = {
  slot: { warmup: "Warm up", extra: "Today’s exercises", cooldown: "Cool down" },
  progress: (n, total) => `${n} of ${total}`,
  progressLabel: (n, total) => `Exercise ${n} of ${total} in your session`,
  steps: "Steps",
  setOf: (n, total) => `Set ${n} of ${total}`,
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  seconds: "seconds",
  holdHint: "Hold gently and breathe",
  of: (total) => `of ${total}`,
  tapHint: "Tap the circle after each rep",
  tapLabel: (n, total) => `Count a rep, ${n} of ${total}`,
  rest: "Rest",
  restNext: (n) => `Then set ${n}`,
  setDone: (n) => `Well done, set ${n} is done`,
  allDone: "Well done, that exercise is done",
  done: "Done",
  saving: "Saving…",
  saveError: "Could not save. Please try again.",
  skipExercise: "Skip this exercise",
  exit: "Back to program",
  equipment: { resistance_bands: "Resistance band", dumbbells: "Dumbbells" },
  timer: "Timer",
  counter: "Counter",
  cameraKicker: "Camera session",
  cameraBody:
    "Place your phone where it can see you, then start. Azm counts your reps and guides your movement.",
  cameraDose: enReps,
  guided: "Guided card",
  heldSeconds: "Seconds held",
  repsDone: "Completed reps",
  setsDone: "Sets",
  doseHold: (sets, seconds, f) => (sets === 1 ? `${f(seconds)} sec` : `${f(sets)} × ${f(seconds)} sec`),
  doseReps: enReps,
};

export const guidedCopy = (lang: Lang): GuidedCopy => (lang === "ar" ? ar : en);
