/**
 * The words of the program build animation (D-032 item 4): one short caption per beat, Arabic first
 * with complete English, then «برنامجك جاهز» and Continue. Kept beside the animation (not in the v7
 * dictionaries), so its lazy chunk carries only these lines. No dash characters, «حالتك الطبية», no
 * diagnosis or treatment claims, no numbers.
 */
import type { Lang } from "../../app/i18n";
import type { BeatId } from "./programBuildScene";

export interface BuildCopy {
  /** The status line of each beat. */
  beats: Record<BeatId, string>;
  ready: string;
  continue: string;
  skip: string;
  /** The wordmark's text alternative. */
  brand: string;
}

const COPY: Record<Lang, BuildCopy> = {
  ar: {
    beats: {
      history: "نقرأ حالتك الطبية",
      camera: "نحلل حركتك بالكاميرا",
      walk: "نقرأ طريقة مشيك",
      historyUsed: "نبني على حالتك الطبية",
      engineer: "نصمم برنامجك",
    },
    ready: "برنامجك جاهز",
    continue: "تابع",
    skip: "تخطَّ",
    brand: "عزم",
  },
  en: {
    beats: {
      history: "Reading your medical history",
      camera: "Analysing your movement with the camera",
      walk: "Reading the way you walk",
      historyUsed: "Building on your medical history",
      engineer: "Engineering your program",
    },
    ready: "Your program is ready",
    continue: "Continue",
    skip: "Skip",
    brand: "Azm",
  },
};

export const buildCopy = (lang: Lang): BuildCopy => COPY[lang];
