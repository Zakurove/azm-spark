export type Lang = "ar" | "en";

export const T = {
  appName: { ar: "عَزم", en: "Azm" },
  appSub: { ar: "حركتك، بإيقاعك", en: "Movement at your own pace" },
  chooseProfile: { ar: "عرّفنا عليك", en: "Tell us about you" },
  chooseExercise: { ar: "اختر تمرينك", en: "Choose your exercise" },
  start: { ar: "ابدأ التمرين", en: "Start training" },
  demoMode: { ar: "العرض التجريبي (بدون كاميرا)", en: "Demo mode (no camera)" },
  cameraMode: { ar: "التمرين بالكاميرا", en: "With camera" },
  profiles: {
    wheelchair: { ar: "مستخدم كرسي متحرك", en: "Wheelchair user" },
    hemiparesis_left: {
      ar: "ضعف في الجانب الأيسر (بعد سكتة دماغية)",
      en: "Left side weakness (after a stroke)",
    },
    hemiparesis_right: {
      ar: "ضعف في الجانب الأيمن (بعد سكتة دماغية)",
      en: "Right side weakness (after a stroke)",
    },
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
    ar: "كرّر الحركة ثلاث مرات ببطء وبجهد مريح. نقيس مدى حركتك أنت، لا مدى أي شخص آخر.",
    en: "Do 3 slow reps at a comfortable effort. We measure your own range, nobody else’s.",
  },
  calibDone: { ar: "تمت المعايرة", en: "Calibrated" },
  validReps: { ar: "دون ملاحظة", en: "without flags" },
  partialReps: { ar: "مدى أقصر", en: "shorter range" },
  compReps: { ar: "مع ملاحظة", en: "with movement flags" },
  rpeTitle: { ar: "قدّر جهدك من 0 إلى 10", en: "How hard was that, from 0 to 10?" },
  rpeHigh: { ar: "جهدك مرتفع، خذ راحةً كاملة قبل المواصلة", en: "High effort. Take a proper rest." },
  summaryTitle: { ar: "ملخص الجلسة", en: "Session summary" },
  bestRom: { ar: "أوسع مدى وصلت إليه", en: "Best range reached" },
  ofYourRange: { ar: "مقارنةً بمداك عند المعايرة", en: "of your calibrated range" },
  again: { ar: "مرة أخرى", en: "Go again" },
  home: { ar: "الرئيسية", en: "Home" },
  privacy: {
    ar: "الفيديو لا يغادر جهازك، وتُحفظ الأرقام فقط",
    en: "Video never leaves your device. Only numbers are saved",
  },
  onDevice: { ar: "يعمل على جهازك", en: "Runs on your device" },
  arabicFirst: { ar: "العربية أولًا", en: "Arabic first" },
  yourBaseline: { ar: "مداك أنت هو المعيار", en: "Your baseline is the standard" },
  legendScored: { ar: "مفاصل مُقيَّمة", en: "Scored joints" },
  legendFlag: { ar: "تنبيه", en: "Flagged" },
  legendContext: { ar: "غير مُقيَّمة", en: "Context only" },
  loadingModel: { ar: "جارٍ تجهيز تتبّع الحركة…", en: "Loading vision model…" },
  cameraError: { ar: "تعذّر تشغيل الكاميرا، جرّب العرض التجريبي", en: "Camera unavailable. Try demo mode" },
  set: { ar: "المجموعة", en: "Set" },
  skip: { ar: "تخطّي", en: "Skip" },
  saveNote: { ar: "حُفظت المجموعة في حسابك", en: "Set saved to your account" },
  rpeLabel: { ar: "مستوى الجهد", en: "RPE" },
  soundOn: { ar: "الصوت: مفعّل", en: "Sound: on" },
  soundOff: { ar: "الصوت: مكتوم، والتعليمات نصية", en: "Sound: off (captions)" },
};

export type Dict = typeof T;

/**
 * The locale of every Arabic number and date (D-036 item 3): Arabic words with Western digits 0 to 9
 * and "." as the decimal mark (the latn numbering system), replacing council Q30's Arabic Indic digits.
 * Build every Arabic Intl formatter with it, never with plain "ar" or "ar-SA".
 */
export const AR_LOCALE = "ar-SA-u-nu-latn";

/**
 * Western digits for any text (D-036 item 3): Arabic Indic (U+0660 to U+0669) and Extended Arabic
 * Indic or Persian (U+06F0 to U+06F9) digits become 0 to 9, the Arabic decimal mark ٫ between two
 * digits becomes "." and the Arabic thousands mark ٬ between two digits becomes ",". Text stored or
 * written before D-036 (old weekly summaries, a model's Arabic) reads in the same digits as the page.
 */
export function westernDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(\d)\u066b(?=\d)/g, "$1.")
    .replace(/(\d)\u066c(?=\d)/g, "$1,");
}

/** A number for display: Western digits in both languages (D-036), grouped («1,234.5» · "1,234.5"). */
export function fmtNum(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? AR_LOCALE : "en-US").format(n);
}

/**
 * A date or time for display. Every date uses the Gregorian calendar (Q30): on some browsers ar-SA
 * defaults to the Umm al-Qura calendar, which would show Hijri dates on one screen and Gregorian ones
 * on another. Arabic month names come with the Arabic locale and the digits are Western (D-036):
 * «الأحد، 4 أكتوبر 2026».
 */
export function fmtDate(value: Date | number, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(lang === "ar" ? AR_LOCALE : "en-GB", {
    ...options,
    calendar: "gregory",
  }).format(value);
}

export function pct(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "ar" ? AR_LOCALE : "en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * A session time "HH:MM" as the check writes clock times: 12 hour, no leading zero, with the same
 * am and pm words («9:00 صباحًا» · "9:00 am"), Western digits in both languages (D-036), whatever digits
 * the time was written in. Anything else is shown as it is, with any Arabic Indic digits made Western
 * in Arabic.
 */
export const fmtTime = (t: string, l: Lang) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(westernDigits(t));
  if (!m) return l === "ar" ? westernDigits(t) : t;
  const h = Number(m[1]) % 24;
  const suffix = h < 12 ? { ar: "صباحًا", en: "am" } : { ar: "مساءً", en: "pm" };
  return `${h % 12 || 12}:${m[2]} ${suffix[l]}`;
};
