import { Lang } from "./i18n";

/**
 * Copy of the camera screen (booth v2, contract A7): the trial, the workouts and the booth. Arabic
 * first, complete English, no dash characters, no times.
 */
const ar = {
  demo: "عرض توضيحي",
  sound: "الصوت",
  soundOn: "الصوت يعمل. اضغط لإيقافه",
  soundOff: "الصوت متوقف. اضغط لتشغيله",
  framingTitle: "اجعل جسمك العلوي داخل الإطار",
  framingTitleRise: "اجعل جسمك كاملًا والكرسي داخل الإطار",
  framingBody: "اجلس مقابل الكاميرا، على بعد مترين تقريبًا.",
  framingBodySide: "وجّه جانبك إلى الكاميرا، على بعد مترين تقريبًا.",
  framingBodyRise: "ضع الكرسي بزاوية من الكاميرا، على بعد مترين إلى ثلاثة.",
  startTitle: "خذ وضعية البداية",
  start: {
    seated_shoulder_press: "يداك عند مستوى كتفيك، ومرفقاك مثنيّان.",
    seated_biceps_curl: "ذراعك ممدودة إلى جانبك، وجانبك إلى الكاميرا.",
    sit_to_stand: "اجلس على الكرسي، وقدماك على الأرض.",
  } as Record<string, string>,
  startHold: "ممتاز، اثبت هكذا",
  measureTitle: "نقيس مداك",
  measureBody: "كرّر الحركة مرتين براحة، بإيقاعك.",
  measured: "تكرارات القياس",
  of: "من",
  yourTop: "قمّتك",
  reps: "تكرار",
  setLabel: "المجموعة",
  messages: {
    move_closer: "اقترب قليلًا من الكاميرا",
    move_back: "ابتعد قليلًا عن الكاميرا",
    get_in_frame: "عُد إلى داخل الإطار",
    range_ready: "مداك جاهز، لنبدأ",
  } as Record<string, string>,
  rangeMeasure: "مدى المرفق",
  hipMeasure: "ارتفاع الورك",
};

const en: typeof ar = {
  demo: "Demo",
  sound: "Sound",
  soundOn: "Sound is on. Tap to turn it off",
  soundOff: "Sound is off. Tap to turn it on",
  framingTitle: "Fit your upper body in the outline",
  framingTitleRise: "Fit your whole body and the chair in the outline",
  framingBody: "Sit facing the camera, about two meters away.",
  framingBodySide: "Turn your side to the camera, about two meters away.",
  framingBodyRise: "Set the chair at an angle to the camera, two to three meters away.",
  startTitle: "Get into the start position",
  start: {
    seated_shoulder_press: "Hands at shoulder height, elbows bent.",
    seated_biceps_curl: "Arm hanging by your side, your side to the camera.",
    sit_to_stand: "Sit on the chair, feet flat on the floor.",
  },
  startHold: "Perfect, hold it there",
  measureTitle: "Measuring your range",
  measureBody: "Two comfortable reps, at your own pace.",
  measured: "Measuring reps",
  of: "of",
  yourTop: "Your top",
  reps: "reps",
  setLabel: "Set",
  messages: {
    move_closer: "Move a little closer",
    move_back: "Move back a little",
    get_in_frame: "Come back into the frame",
    range_ready: "Your range is ready. Let’s begin",
  },
  rangeMeasure: "Elbow range",
  hipMeasure: "Hip rise",
};

export const sessionCopy = (l: Lang) => (l === "ar" ? ar : en);
