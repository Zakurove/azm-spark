/**
 * The program link on the Program tab (product v7 contract 1.2 "Program page links", stream E, step E3;
 * A6a's slot, D-026 item 1): the way to the program built from the findings (/?targets=1) and to the
 * findings behind it. src/app/App.tsx renders it on the Program tab of a ready plan, before the plan
 * card, in a VITE_V7=1 build only.
 *
 *   - a week built from the findings (plan.weekly.findings): «برنامجك مبني على نتائج قياسك», with
 *     «لماذا هذه التمارين؟» (the program page) and the results;
 *   - otherwise, once a completed focus check is found (GET /api/focus): the invitation to let the
 *     program follow it (the program page builds the week);
 *   - otherwise, with no completed check (D-032 item 3: a program built from the history, nothing
 *     measurable or no camera): the program is the history's, and the check can refine it later;
 *   - nothing while the checks load or when the call fails.
 */
import { useEffect, useMemo, useState } from "react";
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import type { Plan } from "../../medical/plan";
import CheckIcon from "../assessment/shared/CheckIcon";
import { createProgramApi } from "./api";
import { completedNewestFirst } from "./program";
import "./program.css";

export interface ProgramLinkProps {
  lang: Lang;
  /** The saved plan; `plan.weekly?.findings` is set when the week is built from the findings. */
  plan: Plan;
  /** Opens the program page (/?targets=1). */
  onOpenProgram(): void;
  /** Opens the findings page of the latest completed check. */
  onOpenFindings(): void;
  /** Opens the movement check (the history card's way to refine the program, D-032 item 3). */
  onStartCheck?: () => void;
}

export default function ProgramLink({
  lang,
  plan,
  onOpenProgram,
  onOpenFindings,
  onStartCheck,
}: ProgramLinkProps) {
  const built = !!plan.weekly?.findings;
  const api = useMemo(() => createProgramApi(), []);
  const [checked, setChecked] = useState<boolean | null>(null);
  useEffect(() => {
    if (built) return;
    let live = true;
    void api.checks().then((r) => {
      if (live) setChecked(r.ok && completedNewestFirst(r.value.checks).length > 0);
    });
    return () => {
      live = false;
    };
  }, [api, built]);
  if (built)
    return (
      <ProgramLinkCard
        lang={lang}
        kind="built"
        onOpenProgram={onOpenProgram}
        onOpenFindings={onOpenFindings}
      />
    );
  if (checked === null) return null;
  if (!checked)
    return onStartCheck ? (
      <ProgramLinkCard
        lang={lang}
        kind="history"
        onOpenProgram={onStartCheck}
        onOpenFindings={onOpenFindings}
      />
    ) : null;
  return (
    <ProgramLinkCard lang={lang} kind="build" onOpenProgram={onOpenProgram} onOpenFindings={onOpenFindings} />
  );
}

/** The card itself: pure, so it renders the same from a test. */
export function ProgramLinkCard({
  lang,
  kind,
  onOpenProgram,
  onOpenFindings,
}: {
  lang: Lang;
  /** history: the program is the history's; the button opens the movement check (D-032 item 3). */
  kind: "built" | "build" | "history";
  onOpenProgram(): void;
  onOpenFindings(): void;
}) {
  const built = kind === "built";
  const copy = {
    built: ["targets.link.title", "targets.link.body", "targets.link.open"],
    build: ["targets.link.buildTitle", "targets.link.buildBody", "targets.link.build"],
    history: ["targets.link.historyTitle", "targets.link.historyBody", "targets.link.historyStart"],
  } as const;
  const [title, body, action] = copy[kind];
  return (
    <section className="pv7-link" data-program-link={kind} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <h2>
        <CheckIcon name="spark" size={22} />
        <span>{tV7(lang, title)}</span>
      </h2>
      <p>{tV7(lang, body)}</p>
      <div className="pv7-link-actions">
        <button
          type="button"
          className="is-primary"
          onClick={onOpenProgram}
          data-action={kind === "history" ? "start_check" : "program"}
        >
          {tV7(lang, action)}
        </button>
        {built && (
          <button type="button" className="is-secondary" onClick={onOpenFindings} data-action="findings">
            {tV7(lang, "targets.link.findings")}
          </button>
        )}
      </div>
    </section>
  );
}
