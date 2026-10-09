/**
 * The booth v2 journey's words (contract C), Arabic first with complete English. No dash characters,
 * «حالتك الطبية», person first, no treatment or diagnosis claims, no disclaimers and no time
 * estimates at the booth (D-017). Option names (conditions, goals, positions) come from the portal's
 * own copy (platform-copy.ts optionNames), so the booth and the app always say the same thing.
 */
import type { Lang } from "../../app/i18n";
import { formatNumber, pluralForm } from "../../i18n";

/** An Arabic count: the one and two forms stand alone; 3 to 10 take the plural; 11 and up the singular. */
function arCount(n: number, f: { one: string; two: string; few: string; many: string }): string {
  const form = pluralForm("ar", n);
  if (form === "one") return f.one;
  if (form === "two") return f.two;
  return `${formatNumber("ar", n)} ${form === "few" ? f.few : f.many}`;
}
const enCount = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

const ar = {
  brandLine: "عزم",
  steps: ["التقرير الطبي", "محرك عزم الطبي", "الهدف", "الكاميرا", "النتيجة", "البرنامج"],
  stepOf: (n: number) => `الخطوة ${formatNumber("ar", n)}`,
  back: "رجوع",
  next: "التالي",

  // the staff code
  codeTitle: "جناح عزم",
  codeBody: "أدخل رمز الفريق لهذا اليوم لتبدأ رحلة الجناح.",

  // home
  homeKicker: "جناح عزم",
  homeTitle: "رياضة على مقاس حالتك الطبية",
  homeBody: "من التقرير الطبي إلى أول تمرين وبرنامج أسبوعي. اختر من أين تبدأ.",
  storyDoorTag: "قصة",
  storyDoor: "قصة سعد",
  selfDoorTag: "أنت",
  selfDoor: "جرّبه بنفسك",
  selfDoorLine: "ثلاث لمسات عن حالتك، ثم حركتك أمام الكاميرا.",

  // staff menu
  staff: "قائمة الفريق",
  staffReset: "زائر جديد",
  staffLanguage: "English",
  staffVoice: "صوت المدرب",
  voiceOn: "يعمل",
  voiceOff: "متوقف",
  staffOff: "أوقف وضع الجناح",
  close: "إغلاق",

  // step 1, story
  reportTitle: "يقرأ عزم تقرير سعد",
  reportRead: "اقرأ التقرير",
  reportReading: "يقرأ عزم التقرير",
  reportNotice: "يقرأ عزم التقرير مرة واحدة، ولا يحتفظ به.",
  reportSample: "نموذج توضيحي",
  reportAlt: "تقرير سعد الطبي، نموذج توضيحي",
  readTitle: "ما قرأه عزم",
  readNote: "الأمان لا يقرّره الذكاء الاصطناعي. القواعد الطبية تقرّره في الخطوة التالية.",
  chip: {
    age: "العمر",
    condition: "الحالة",
    mobility: "الحركة",
    pain: "الألم",
    restrictions: "تعليمات الطبيب",
    medications: "الأدوية",
  },
  ageValue: (n: string) => `${n} سنة`,
  noPain: "لا ألم حالي مذكور",
  mobilityValue: {
    wheelchair: "يستخدم كرسيًا متحركًا",
    seated: "يتمرّن جالسًا",
    standing: "يتمرّن واقفًا",
    bed: "يحتاج دعمًا مستمرًا",
  } as Record<string, string>,

  // step 1, as yourself
  aboutConditionTitle: "هل لديك حالة طبية؟",
  aboutConditionBody: "اختر كل ما ينطبق عليك.",
  aboutClearance: "هل أذن لك طبيبك بممارسة الرياضة؟",
  clearance: { yes: "نعم", no: "لا", unsure: "لست متأكدًا" },
  aboutPositionTitle: "ما الوضعية الأنسب لك في التمرين؟",
  aboutPositionBody: "نضبط الحركات والكاميرا على وضعيتك.",
  positions: {
    seated: "جالسًا على كرسي",
    wheelchair: "على كرسي متحرك",
    standing: "واقفًا",
  },
  aboutSideTitle: "هل أحد جانبيك أضعف؟",
  aboutSideBody: "يقيس عزم كل جانب على مداه هو.",
  sides: { none: "لا", left: "الجانب الأيسر", right: "الجانب الأيمن" },
  photoOpen: "عندك تقرير طبي؟ صوّره",
  photoReading: "يقرأ عزم تقريرك",
  photoNotice: "يقرأ عزم تقريرك مرة واحدة ليملأ إجاباتك، ولا يحتفظ به.",
  photoRead: "قرأ عزم تقريرك وملأ ما وجده. راجعه وغيّر ما تريد.",
  photoFailed: "تعذّرت قراءة الصورة. اختر إجاباتك بلمسة.",
  tapOf: (n: string, of: string) => `${n} من ${of}`,

  // step 2
  engineTitleStory: "ما الآمن لسعد",
  engineTitleSelf: "ما الآمن لك",
  engineBody: "محرك القواعد الطبية في عزم يقرّر قبل أي ذكاء اصطناعي.",
  included: "مناسب",
  adapted: "مكيّف",
  excluded: "مستبعد",
  /** alone: no camera movement comes before it, so the line opens without «و». */
  library: (n: number, alone = false) =>
    `${alone ? "" : "و"}${arCount(n, { one: "تمرين آمن واحد", two: "تمرينان آمنان", few: "تمارين آمنة", many: "تمرينًا آمنًا" })} من مكتبة عزم`,
  restLonger: "راحة أطول بين المجموعات",
  restValue: (n: string) => `${n} ث`,
  restBase: (n: string) => `بدل ${n} ث`,
  lighterDose: "جرعة أخف",
  dose: (sets: number, reps: number) => `${formatNumber("ar", sets)} × ${formatNumber("ar", reps)}`,
  doseBase: (sets: number, reps: number) => `بدل ${formatNumber("ar", sets)} × ${formatNumber("ar", reps)}`,
  doseNote: "مجموعات × تكرارات",
  restDay: "يوم راحة بين كل جلستين",
  heat: "انتبه لحرارة المكان، وخذ رشفات ماء",
  calmPace: "إيقاع هادئ وراحة أطول",
  sameDose: "الجرعة المعتادة تناسبك",
  noneExcluded: "لا شيء مستبعد",
  notForWheelchair: "ليس لمستخدمي الكرسي المتحرك",
  notSeated: "تحتاج النهوض والوقوف",
  needsWeights: "تحتاج أوزانًا خفيفة",
  overhead: "طبيبك يوصي بتجنّب رفع الذراعين",
  painUpper: "مع ألم في الجزء العلوي نتجنّبها",
  recentRegion: "بعد جراحة أو إصابة حديثة نتجنّبها",
  limbs: "تحتاج ذراعين يتتبّعهما النموذج",
  reviewTitle: "يحتاج البرنامج مراجعة قبل البدء",
  reviewBody: "القواعد الطبية أوقفت التمرين هنا، ولا يتجاوزها الذكاء الاصطناعي.",

  // step 3
  goalTitleStory: "هدف سعد",
  goalTitleSelf: "ما هدفك؟",
  goalBody: "الهدف يرتّب أسبوعك. والقواعد تبقى كما هي.",
  sportTitle: "أي رياضة؟",

  // safety
  safetyKicker: "قبل الكاميرا",
  safetyAsk: "هل تشعر الآن بألم في الصدر أو دوخة أو توعك؟",
  safetyNo: "لا، أنا بخير",
  safetyYes: "نعم",
  stopTitle: "لنتوقف هنا",
  stopBody: "لن نبدأ الحركة الآن. أخبر أحد أعضاء فريق عزم بجانبك.",
  stopCall: "إذا كان الألم أو الدوخة شديدين، اتصل بالإسعاف على الرقم ٩٩٧.",
  stopCallButton: "اتصل بـ ٩٩٧",
  startAgain: "ابدأ من جديد",

  // the end of the set
  wellDone: "أحسنت",
  setEnded: "انتهت المجموعة",
  repsDone: (n: number) => arCount(n, { one: "تكرار واحد", two: "تكراران", few: "تكرارات", many: "تكرارًا" }),

  // step 5
  resultsKicker: "نقطة بدايتك",
  resultsTitle: "هذا مداك أنت",
  rangeLabel: "مدى حركة المرفق في ضغط الكتف",
  degrees: "درجة",
  reps: (n: number): string => (pluralForm("ar", n) === "few" ? "تكرارات" : "تكرار"),
  steady: "بثبات" as string,
  noRange: "لم نلتقط تكرارًا كاملًا هذه المرة.",
  tryAgain: "أعد المحاولة",
  toProgram: "البرنامج",
  exampleTag: "مثال",
  exampleTitle: "الفحص نفسه بعد ٤ أسابيع",
  exampleStart: "البداية",
  exampleNow: "بعد ٤ أسابيع",
  exampleChange: "التغيّر",
  exampleNote: "يقارنك عزم بنقطة بدايتك أنت فقط.",

  // step 6
  programTitleStory: "برنامج سعد الأسبوعي",
  programTitleSelf: "برنامجك الأسبوعي",
  sourceAi: "رتّبه محرك عزم بالذكاء الاصطناعي على قواعد حالتك الطبية",
  sourceEngine: "مبني على قواعد حالتك الطبية",
  writing: "يرتّب محرك عزم أسبوعك",
  camera: "بالكاميرا",
  everySession: "في كل جلسة بالكاميرا",
  registerTitle: "خذ برنامجك معك",
  registerBody: "امسح الرمز بهاتفك وأنشئ حسابك المجاني.",
  registerAlt: "رمز لإنشاء حساب في عزم",
  reviewProgram: "سجّل لتكمل حين يسمح طبيبك",

  // idle
  idleTitle: "نبدأ من جديد للزائر التالي",
  idleStay: "ما زلت هنا",
};

type Copy = typeof ar;

const en: Copy = {
  brandLine: "Azm",
  steps: ["Medical report", "Medical engine", "Goal", "Camera", "Result", "Program"],
  stepOf: (n: number) => `Step ${n}`,
  back: "Back",
  next: "Next",

  codeTitle: "The Azm booth",
  codeBody: "Enter today's staff code to start the booth journey.",

  homeKicker: "The Azm booth",
  homeTitle: "Sport that fits your medical condition",
  homeBody: "From a medical report to a first set and a weekly program. Choose where to begin.",
  storyDoorTag: "A story",
  storyDoor: "Saad's story",
  selfDoorTag: "You",
  selfDoor: "Try it as yourself",
  selfDoorLine: "Three taps about you, then your own movement on camera.",

  staff: "Staff menu",
  staffReset: "New visitor",
  staffLanguage: "العربية",
  staffVoice: "Coach voice",
  voiceOn: "On",
  voiceOff: "Off",
  staffOff: "Turn off booth mode",
  close: "Close",

  reportTitle: "Azm reads Saad's report",
  reportRead: "Read the report",
  reportReading: "Azm is reading the report",
  reportNotice: "Azm reads the report once, and does not keep it.",
  reportSample: "Sample",
  reportAlt: "Saad's medical report, a sample",
  readTitle: "What Azm read",
  readNote: "AI never decides safety. The medical rules decide it in the next step.",
  chip: {
    age: "Age",
    condition: "Condition",
    mobility: "Mobility",
    pain: "Pain",
    restrictions: "Doctor's advice",
    medications: "Medications",
  },
  ageValue: (n: string) => `${n} years`,
  noPain: "No current pain noted",
  mobilityValue: {
    wheelchair: "Uses a wheelchair",
    seated: "Exercises seated",
    standing: "Exercises standing",
    bed: "Needs continuous support",
  },

  aboutConditionTitle: "Do you have a medical condition?",
  aboutConditionBody: "Choose all that apply to you.",
  aboutClearance: "Has your doctor cleared you to exercise?",
  clearance: { yes: "Yes", no: "No", unsure: "Not sure" },
  aboutPositionTitle: "Which position suits you best for exercise?",
  aboutPositionBody: "The movements and the camera follow your position.",
  positions: {
    seated: "Seated on a chair",
    wheelchair: "In a wheelchair",
    standing: "Standing",
  },
  aboutSideTitle: "Is one side weaker?",
  aboutSideBody: "Azm measures each side against its own range.",
  sides: { none: "No", left: "Left side", right: "Right side" },
  photoOpen: "Have a medical report? Take a photo",
  photoReading: "Azm is reading your report",
  photoNotice: "Azm reads your report once to fill in your answers, and does not keep it.",
  photoRead: "Azm read your report and filled in what it found. Check it and change anything.",
  photoFailed: "The photo could not be read. Choose your answers with a tap.",
  tapOf: (n: string, of: string) => `${n} of ${of}`,

  engineTitleStory: "What is safe for Saad",
  engineTitleSelf: "What is safe for you",
  engineBody: "The Azm medical rules engine decides, before any AI.",
  included: "Included",
  adapted: "Adapted",
  excluded: "Left out",
  library: (n: number, alone = false) =>
    `${alone ? "" : "and "}${enCount(n, "safe exercise", "safe exercises")} from the Azm library`,
  restLonger: "Longer rest between sets",
  restValue: (n: string) => `${n} s`,
  restBase: (n: string) => `instead of ${n} s`,
  lighterDose: "A lighter dose",
  dose: (sets: number, reps: number) => `${sets} × ${reps}`,
  doseBase: (sets: number, reps: number) => `instead of ${sets} × ${reps}`,
  doseNote: "sets × reps",
  restDay: "A rest day between sessions",
  heat: "Mind the room temperature, and sip water",
  calmPace: "A calm pace and longer rests",
  sameDose: "The usual dose suits you",
  noneExcluded: "Nothing left out",
  notForWheelchair: "Not for wheelchair users",
  notSeated: "Needs rising and standing",
  needsWeights: "Needs light weights",
  overhead: "Your doctor advises no overhead lifting",
  painUpper: "Avoided with upper body pain",
  recentRegion: "Avoided after a recent surgery or injury",
  limbs: "Needs two arms the model can track",
  reviewTitle: "The program needs a review before starting",
  reviewBody: "The medical rules stopped training here, and AI never overrides them.",

  goalTitleStory: "Saad's goal",
  goalTitleSelf: "What is your goal?",
  goalBody: "Your goal shapes your week. The rules stay the same.",
  sportTitle: "Which sport?",

  safetyKicker: "Before the camera",
  safetyAsk: "Do you feel chest pain, dizziness or unwell right now?",
  safetyNo: "No, I feel fine",
  safetyYes: "Yes",
  stopTitle: "Let's stop here",
  stopBody: "We will not start moving now. Tell a member of the Azm team beside you.",
  stopCall: "If the pain or dizziness is strong, call an ambulance on 997.",
  stopCallButton: "Call 997",
  startAgain: "Start again",

  wellDone: "Well done",
  setEnded: "The set has ended",
  repsDone: (n: number) => enCount(n, "rep", "reps"),

  resultsKicker: "Your starting point",
  resultsTitle: "This is your own range",
  rangeLabel: "Elbow range in the shoulder press",
  degrees: "degrees",
  reps: (n: number) => (n === 1 ? "rep" : "reps"),
  steady: "steady",
  noRange: "We did not catch a full rep this time.",
  tryAgain: "Try again",
  toProgram: "The program",
  exampleTag: "Example",
  exampleTitle: "The same check 4 weeks later",
  exampleStart: "Start",
  exampleNow: "4 weeks later",
  exampleChange: "Change",
  exampleNote: "Azm compares you with your own starting point only.",

  programTitleStory: "Saad's weekly program",
  programTitleSelf: "Your weekly program",
  sourceAi: "Arranged by the Azm AI engine on the rules for your medical condition",
  sourceEngine: "Built on the rules for your medical condition",
  writing: "The Azm engine is arranging your week",
  camera: "Camera",
  everySession: "Every session, with the camera",
  registerTitle: "Take your program with you",
  registerBody: "Scan the code with your phone and create your free account.",
  registerAlt: "A code to create an Azm account",
  reviewProgram: "Register to continue once your doctor agrees",

  idleTitle: "Starting again for the next visitor",
  idleStay: "I am still here",
};

export const boothCopy = (lang: Lang): Copy => (lang === "ar" ? ar : en);
export type BoothCopy = Copy;
