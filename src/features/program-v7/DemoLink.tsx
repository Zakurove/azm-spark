/**
 * The way to the demo exercises (D-037 item 6): a light card with «عرض تمارين تجريبية», on the program
 * page shown after the build animation (ProgramPage.tsx) and on the Program tab the person reaches from
 * it (src/app/App.tsx, VITE_V7=1 builds only). It opens the list of the exercises the camera follows
 * (DemoExercises.tsx). The Program tab's link card family (program.css .pv7-link).
 */
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import CheckIcon from "../assessment/shared/CheckIcon";
import "./program.css";

export function DemoLink({ lang, onOpen }: { lang: Lang; onOpen(): void }) {
  return (
    <section
      className="pv7-link pv7-demo-link"
      data-demo-link=""
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <h2>
        <CheckIcon name="camera" size={22} />
        <span>{tV7(lang, "targets.demo.linkTitle")}</span>
      </h2>
      <p>{tV7(lang, "targets.demo.linkBody")}</p>
      <div className="pv7-link-actions">
        <button type="button" className="is-secondary" onClick={onOpen} data-action="demos">
          {tV7(lang, "targets.demo.button")}
        </button>
      </div>
    </section>
  );
}

export default DemoLink;
