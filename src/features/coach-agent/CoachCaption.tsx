/**
 * The live coach's caption (product v7 contract 2.11 CoachState.captions; UX spec principle 4, voice
 * and captions together; stream D, step D5): one slim glass line at the top of a coached screen.
 *
 *   - connecting: «نوصل المدرّب المباشر»;
 *   - live: what the coach says while it speaks (the S0-6 captions of captions.ts), kept for 2 s after
 *     its turn, then nothing while it listens (the screen's own controls stay clear; the browser shows
 *     its own microphone mark);
 *   - local (the coach could not run): «نكمل بالأزرار على الشاشة» for 6 s, then nothing (D-036 item 1:
 *     no other voice takes over);
 *   - off: nothing.
 * No live region: the coach's voice already says it (UX spec 4.3). The dot breathes while the coach
 * speaks, and stands still with reduced motion.
 */
import { useEffect, useState } from "react";
import type { Lang } from "../../app/i18n";
import type { CoachState } from "../../coach/types";
import { tV7 } from "../../i18n/v7";
import { bidiText } from "../../i18n/rich";
import "./coach.css";

/** How long a turn's caption stays after the coach stops speaking. */
export const CAPTION_HOLD_MS = 2000;
/** How long the line says the coach could not run. */
export const LOCAL_NOTE_MS = 6000;

const t = (lang: Lang, key: string) => tV7(lang, `coach.${key}` as never);

export function CoachCaption({
  coach,
  lang,
  place = "top",
}: {
  coach: Pick<CoachState, "mode" | "speaking" | "captions">;
  lang: Lang;
  /** Where the line sits: the top of the screen, or above a screen's own bottom bar. */
  place?: "top" | "bottom";
}) {
  const [holding, setHolding] = useState(coach.speaking);
  const [localNote, setLocalNote] = useState(coach.mode === "local");
  useEffect(() => {
    if (coach.speaking) {
      setHolding(true);
      return;
    }
    const id = setTimeout(() => setHolding(false), CAPTION_HOLD_MS);
    return () => clearTimeout(id);
  }, [coach.speaking]);
  useEffect(() => {
    if (coach.mode !== "local") return;
    setLocalNote(true);
    const id = setTimeout(() => setLocalNote(false), LOCAL_NOTE_MS);
    return () => clearTimeout(id);
  }, [coach.mode]);

  const said = [...coach.captions].reverse().find((c) => c.who === "coach")?.text ?? "";
  const text =
    coach.mode === "connecting"
      ? t(lang, "status.connecting")
      : coach.mode === "local"
        ? localNote && t(lang, "status.local")
        : coach.mode === "live"
          ? holding && said
          : "";
  if (!text) return null;
  return (
    <div
      className={`coach-caption is-${place}${coach.mode === "live" ? " is-open" : ""}`}
      data-mode={coach.mode}
      data-speaking={coach.speaking ? "yes" : "no"}
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <span className="coach-caption-dot" aria-hidden="true" />
      <span className="coach-caption-text">{bidiText(lang, text)}</span>
    </div>
  );
}
