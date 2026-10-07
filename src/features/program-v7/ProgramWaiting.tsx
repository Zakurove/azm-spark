/**
 * D-032 item 3 (the tests come before the program): the one card Today and the Program tab show while
 * a person's program waits for the movement check, in place of the program: «برنامجك ينتظر قياس
 * حركتك» with a Start button. «سأقرر لاحقًا» on the check's own screens just leaves this card; there
 * is no program until the check. src/app/App.tsx renders it in a VITE_V7=1 build only.
 */
import { useId } from "react";
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import CheckIcon from "../assessment/shared/CheckIcon";
import "./program.css";

export interface ProgramWaitingProps {
  lang: Lang;
  /** Opens the movement check. */
  onStart(): void;
}

export default function ProgramWaiting({ lang, onStart }: ProgramWaitingProps) {
  const title = useId();
  return (
    <section
      className="pv7-link pv7-wait"
      aria-labelledby={title}
      data-program-waiting
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <span className="pv7-wait-badge" aria-hidden="true">
        <CheckIcon name="spark" size={26} />
      </span>
      <h2 id={title}>{tV7(lang, "targets.waiting.title")}</h2>
      <p>{tV7(lang, "targets.waiting.body")}</p>
      <div className="pv7-link-actions">
        <button type="button" className="is-primary" onClick={onStart} data-action="start_check">
          {tV7(lang, "targets.waiting.start")}
        </button>
      </div>
    </section>
  );
}
