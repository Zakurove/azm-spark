/**
 * The booth demo's words (/demo): Arabic first, complete English, no dash characters, Western digits.
 */
import type { Lang } from "../../app/i18n";

const COPY = {
  ar: {
    kicker: "عرض تجريبي",
    title: "جرّب عزم بلا تسجيل",
    persona: "ملف جاهز: رجل، 45 سنة، ألم وتيبّس في الكتف اليمنى، يمشي دون أداة مساعدة.",
    visitor: "زائر",
    newVisitor: "زائر جديد",
    newVisitorHint: "كل زائر يبدأ من جديد بملف نظيف.",
    starting: "نجهّز العرض التجريبي",
    failed: "تعذّر بدء العرض التجريبي. تحقق من الاتصال ثم حاول مرة أخرى.",
    busy: "كثرت محاولات البدء من هذا الجهاز. انتظر قليلًا ثم حاول مرة أخرى.",
    retry: "حاول مرة أخرى",
    back: "عودة إلى العرض التجريبي",
    partsLabel: "أجزاء العرض التجريبي",
    parts: {
      journey: {
        title: "الرحلة كاملة",
        line: "النموذج الصحي، ثم مدى الحركة والمشي، ثم بناء البرنامج.",
      },
      range: {
        title: "مدى الحركة",
        line: "اختر حركة وقِسها بالكاميرا مباشرة.",
      },
      walk: {
        title: "المشي",
        line: "عبور الصورة جانبيًا، ثم نحو الهاتف وإيابًا.",
      },
      exercises: {
        title: "التمارين",
        line: "ضغط الكتف وغيره مع المدرب، دون حفظ.",
      },
    },
    range: {
      title: "اختر حركة",
      intro: "تقيسها الكاميرا مع الهيكل والمؤشر. لا يُحفظ شيء.",
      side: "الجهة",
      right: "اليمنى",
      left: "اليسرى",
      common: "الأكثر استخدامًا",
      more: "حركات أخرى",
    },
    walkKicker: "عرض تجريبي: لا يُحفظ شيء",
  },
  en: {
    kicker: "Demo",
    title: "Try Azm, no sign up",
    persona:
      "A ready profile: a man of 45 with pain and stiffness in the right shoulder, who walks without an aid.",
    visitor: "Visitor",
    newVisitor: "New visitor",
    newVisitorHint: "Each visitor starts fresh, with a clean profile.",
    starting: "Getting the demo ready",
    failed: "The demo could not start. Check the connection, then try again.",
    busy: "Too many starts from this device. Wait a little, then try again.",
    retry: "Try again",
    back: "Back to the demo",
    partsLabel: "Parts of the demo",
    parts: {
      journey: {
        title: "Full journey",
        line: "The health form, then range of motion and the walk, then the program build.",
      },
      range: {
        title: "Range of motion",
        line: "Pick a movement and measure it with the camera right away.",
      },
      walk: {
        title: "Walk",
        line: "Across the picture side on, then toward the phone and back.",
      },
      exercises: {
        title: "Exercises",
        line: "The shoulder press and more with the coach, nothing saved.",
      },
    },
    range: {
      title: "Pick a movement",
      intro: "The camera measures it with the skeleton and the meter. Nothing is saved.",
      side: "Side",
      right: "Right",
      left: "Left",
      common: "Most used",
      more: "More movements",
    },
    walkKicker: "Demo: nothing is saved",
  },
} as const;

export type DemoCopy = (typeof COPY)["ar"] | (typeof COPY)["en"];

export const demoCopy = (lang: Lang): DemoCopy => COPY[lang];
