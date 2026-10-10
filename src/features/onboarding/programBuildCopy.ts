/**
 * The words of the program build animation (D-032 item 4, D-037 item 5): one short caption per beat
 * and, under it, one quieter line of what is being read or made (the camera's says how many joints were
 * measured, the person's own count, in Western digits), then «برنامجك جاهز» and Continue; while the
 * program is still being made, «نضع اللمسات الأخيرة». Arabic first with complete English. Kept beside
 * the animation (not in the v7 dictionaries), so its lazy chunk carries only these lines. No dash
 * characters, «حالتك الطبية», no diagnosis or treatment claims.
 */
import type { Lang } from "../../app/i18n";
import type { BeatId } from "./programBuildScene";

export interface BuildCopy {
  /** The status line of each beat. */
  beats: Record<BeatId, string>;
  /** The quieter line under it: what the beat reads or makes. */
  detail(id: BeatId, measured: number): string;
  /** Reduced motion, while the list is ticked. */
  building: string;
  /** The program is not ready yet when the animation reaches its end. */
  finishing: string;
  ready: string;
  continue: string;
  skip: string;
  /** The wordmark's text alternative. */
  brand: string;
}

const AR_DETAIL: Record<Exclude<BeatId, "camera">, string> = {
  history: "حالتك، ومناطق جسمك، وهدفك",
  walk: "خطواتك وإيقاع مشيك",
  historyUsed: "نعتمد على ما أخبرتنا به",
  choose: "لكل تمرين سبب واضح",
  week: "أيام التمرين وأيام الراحة",
};
const EN_DETAIL: Record<Exclude<BeatId, "camera">, string> = {
  history: "Your condition, your body areas and your goal",
  walk: "Your steps and the rhythm of your walk",
  historyUsed: "We go by what you told us",
  choose: "Each exercise with a clear reason",
  week: "Training days and rest days",
};

/** «3 مفاصل قسناها بالكاميرا»: the Arabic count with its noun's form (one and two replace the number). */
function arJoints(n: number): string {
  if (n === 1) return "مفصل واحد قسناه بالكاميرا";
  if (n === 2) return "مفصلان قسناهما بالكاميرا";
  const form = new Intl.PluralRules("ar").select(n);
  return `${n} ${form === "few" ? "مفاصل" : "مفصلًا"} قسناها بالكاميرا`;
}

const COPY: Record<Lang, BuildCopy> = {
  ar: {
    beats: {
      history: "نقرأ حالتك الطبية",
      camera: "نحلل مدى حركتك",
      walk: "نقرأ طريقة مشيك",
      historyUsed: "نبني على حالتك الطبية",
      choose: "نختار تمارينك",
      week: "نرتّب أسبوعك",
    },
    detail: (id, measured) => (id === "camera" ? arJoints(measured) : AR_DETAIL[id]),
    building: "نبني برنامجك",
    finishing: "نضع اللمسات الأخيرة",
    ready: "برنامجك جاهز",
    continue: "تابع",
    skip: "تخطَّ",
    brand: "عزم",
  },
  en: {
    beats: {
      history: "Reading your medical history",
      camera: "Analysing your range of motion",
      walk: "Reading the way you walk",
      historyUsed: "Building on your medical history",
      choose: "Choosing your exercises",
      week: "Setting your week",
    },
    detail: (id, measured) =>
      id === "camera"
        ? `${measured} ${measured === 1 ? "joint" : "joints"} measured with the camera`
        : EN_DETAIL[id],
    building: "Building your program",
    finishing: "Adding the finishing touches",
    ready: "Your program is ready",
    continue: "Continue",
    skip: "Skip",
    brand: "Azm",
  },
};

export const buildCopy = (lang: Lang): BuildCopy => COPY[lang];
