import { CueId } from "../engine/types";

export type Lang = "ar" | "en";

export const CUE_TEXT: Record<CueId, { ar: string; en: string }> = {
  sit_tall: { ar: "عدّل جلستك", en: "Sit tall" },
  even_arms: { ar: "ارفع ذراعيك بالتساوي", en: "Raise both arms evenly" },
  slow_down: { ar: "تمهّل قليلًا", en: "Slow down" },
  fuller_range: { ar: "أكمل الحركة كاملة", en: "Complete the full movement" },
  relax_shoulders: { ar: "أرخِ كتفيك", en: "Relax your shoulders" },
  stand_fully: { ar: "قف باستقامة كاملة", en: "Stand up fully" },
  control_descent: { ar: "انزل بتحكّم", en: "Control the way down" },
  get_in_frame: { ar: "اجعل جسمك داخل الإطار", en: "Move so your body is in frame" },
  move_back: { ar: "ابتعد قليلًا عن الكاميرا", en: "Move back a little" },
  great_rep: { ar: "ممتاز", en: "Great rep" },
  halfway: { ar: "وصلت المنتصف — واصل!", en: "Halfway there — keep going!" },
  set_done: { ar: "أحسنت! انتهت المجموعة", en: "Well done! Set complete" },
  stop_rest: { ar: "توقّف الآن واسترح", en: "Stop now and rest" },
};

export const T = {
  appName: { ar: "عَزم", en: "Azm" },
  appSub: { ar: "المدرّب الذي يراك", en: "The coach that sees you" },
  chooseProfile: { ar: "عرّفنا عليك", en: "Tell us about you" },
  chooseExercise: { ar: "اختر تمرينك", en: "Choose your exercise" },
  start: { ar: "ابدأ التمرين", en: "Start training" },
  demoMode: { ar: "العرض التجريبي (بدون كاميرا)", en: "Demo mode (no camera)" },
  cameraMode: { ar: "التمرين بالكاميرا", en: "With camera" },
  profiles: {
    wheelchair: { ar: "مستخدم كرسي متحرك", en: "Wheelchair user" },
    hemiparesis_left: { ar: "ضعف في الجانب الأيسر (بعد سكتة دماغية)", en: "Left-side weakness (post-stroke)" },
    hemiparesis_right: { ar: "ضعف في الجانب الأيمن (بعد سكتة دماغية)", en: "Right-side weakness (post-stroke)" },
    standing: { ar: "بدون إعاقة حركية", en: "No mobility impairment" },
  } as Record<string, { ar: string; en: string }>,
  profileNotes: {
    wheelchair: { ar: "نُقيّم الجزء العلوي من الجسم فقط", en: "Upper body only is scored" },
    hemiparesis_left: { ar: "اختلاف الجانبين متوقّع وطبيعي", en: "Side asymmetry is expected here" },
    hemiparesis_right: { ar: "اختلاف الجانبين متوقّع وطبيعي", en: "Side asymmetry is expected here" },
    standing: { ar: "تقييم كامل للحركة", en: "Full movement scoring" },
  } as Record<string, { ar: string; en: string }>,
  reps: { ar: "تكرارات", en: "reps" },
  targetReps: { ar: "الهدف", en: "Target" },
  framingTitle: { ar: "جهّز الكاميرا", en: "Set up your camera" },
  framingOk: { ar: "ممتاز! اثبت مكانك لحظة…", en: "Great! Hold still for a moment…" },
  framingWait: { ar: "اجعل جسمك كاملًا داخل الإطار", en: "Get your whole body in frame" },
  calibTitle: { ar: "معايرة مدى حركتك", en: "Calibrating your personal range" },
  calibBody: {
    ar: "كرّر الحركة ثلاث مرات ببطء وبجهد مريح — نقيس مدى حركتك أنت، لا مدى أي شخص آخر.",
    en: "Do 3 slow reps at comfortable effort — we measure YOUR range, nobody else’s.",
  },
  calibDone: { ar: "تمت المعايرة", en: "Calibrated" },
  validReps: { ar: "صحيحة", en: "valid" },
  partialReps: { ar: "جزئية", en: "partial" },
  compReps: { ar: "تعويضية", en: "compensated" },
  stop: { ar: "إيقاف", en: "STOP" },
  rpeTitle: { ar: "قدّر جهدك من ٠ إلى ١٠", en: "How hard was that? (0–10)" },
  rpeHigh: { ar: "جهدك مرتفع — خذ راحةً كاملة قبل المواصلة", en: "High effort — take a proper rest" },
  summaryTitle: { ar: "ملخص الجلسة", en: "Session summary" },
  bestRom: { ar: "أوسع مدى وصلت إليه", en: "Best range reached" },
  ofYourRange: { ar: "مقارنةً بمداك عند المعايرة", en: "of your calibrated range" },
  again: { ar: "مرة أخرى", en: "Go again" },
  home: { ar: "الرئيسية", en: "Home" },
  privacy: { ar: "الفيديو لا يغادر جهازك — تُحفظ الأرقام فقط", en: "Video never leaves your device — only numbers are saved" },
  disclaimer: {
    ar: "عَزم مرشد تدريبي وليس جهازًا طبيًا. إذا كنت من مرضى القلب فلا تبدأ التمرين إلا بموافقة طبيبك.",
    en: "Azm is training guidance, not a medical device. Cardiac conditions require medical clearance before exercise.",
  },
  onDevice: { ar: "يعمل على جهازك", en: "Runs on your device" },
  arabicFirst: { ar: "العربية أولًا", en: "Arabic-first" },
  yourBaseline: { ar: "مداك أنت هو المعيار", en: "Your baseline is the standard" },
  legendScored: { ar: "مفاصل مُقيَّمة", en: "Scored joints" },
  legendFlag: { ar: "تنبيه", en: "Flagged" },
  legendContext: { ar: "غير مُقيَّمة", en: "Context only" },
  loadingModel: { ar: "جارٍ تجهيز تتبّع الحركة…", en: "Loading vision model…" },
  cameraError: { ar: "تعذّر تشغيل الكاميرا — جرّب العرض التجريبي", en: "Camera unavailable — try demo mode" },
  set: { ar: "المجموعة", en: "Set" },
  skip: { ar: "تخطّي", en: "Skip" },
  saveNote: { ar: "حُفظت الجلسة على هذا الجهاز", en: "Session saved on this device" },
  rpeLabel: { ar: "مستوى الجهد", en: "RPE" },
  soundOn: { ar: "الصوت: مفعّل", en: "Sound: on" },
  soundOff: { ar: "الصوت: مكتوم — التعليمات نصية", en: "Sound: off (captions)" },
};

export type Dict = typeof T;

export function fmtNum(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US").format(n);
}

export function pct(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(n);
}
