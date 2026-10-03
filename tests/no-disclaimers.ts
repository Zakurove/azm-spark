/**
 * D-017 item 2: the disclaimers Azm no longer shows, in both languages: the "not intended for medical
 * purposes" label, the boundary paragraph («لا يشخّص»), the results footer (see your doctor), the
 * "this is a trial, nothing is saved" notes, the repeated video line inside the check and the portal
 * and landing footnotes. A screen that shows one of them fails. The consent screen (S12) keeps its
 * video point and is not read with this list. Not disclaimers, so not listed: the workout trial
 * session's sign up line and the program's notes on the person's own answers (self reported
 * clearance). The wording rule (no treatment or diagnosis claims) stays in check-copy.test.ts and
 * movement-data.test.ts.
 */
import type { Lang } from "../src/app/i18n";

export const DISCLAIMERS: Record<Lang, readonly string[]> = {
  ar: [
    "غير مخصص للأغراض الطبية",
    "لا يشخّص",
    "لا يُشخّص",
    "فراجع طبيبك أو فريق رعايتك",
    "هذه تجربة، ولا يُحفظ شيء",
    "لا يُحفظ شيء في هذه التجربة",
    "يبقى الفيديو",
    "ليس جهازًا طبيًا",
  ],
  en: [
    "Not intended for medical purposes",
    "does not diagnose",
    "check with your doctor or care team",
    "This is a trial and nothing is saved",
    "Nothing is saved in this trial",
    "The video stays",
    "not a medical device",
    "not a clinic",
  ],
};

/** The disclaimers found in a text (empty when none). */
export function disclaimersIn(lang: Lang, text: string): string[] {
  return DISCLAIMERS[lang].filter((d) => text.includes(d));
}
