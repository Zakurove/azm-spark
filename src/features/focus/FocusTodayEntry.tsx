import { useEffect, useId, useState } from "react";
import type { Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import type { Intake, Plan } from "../../medical/plan";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { loadCompleted } from "./FindingsLink";
import "../progress/progress.css";

export interface FocusTodayEntryProps {
  lang: Lang;
  owner: string;
  intake: Intake;
  plan: Plan;
  onStart(): void;
  onOpenFindings(checkId: string | null): void;
  onOpenResults(): void;
  onOpenHealth(): void;
}

/**
 * The focus check's card on Today (VITE_V7 builds): what the check does, a start button, and the
 * latest results once a check is complete. The check itself decides whether it can run here
 * (home closed, a booth pass, the 48 hour rule) and says so on its own first screen.
 */
export default function FocusTodayEntry({ lang, owner, onStart, onOpenFindings }: FocusTodayEntryProps) {
  const titleId = useId();
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadCompleted().then((list) => {
      if (live) setLatest(list[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, [owner]);
  return (
    <CheckRoot ui={{ lang }} page={false} className="check-slot">
      <section className="check-card pg-entry" aria-labelledby={titleId} data-block="focus-entry">
        <div className="pg-entry-head">
          <h2 id={titleId}>{tV7(lang, "rom.shell.name")}</h2>
          <span className="check-card-icon" aria-hidden="true">
            <CheckIcon name="spark" />
          </span>
        </div>
        <p className="check-body">{tV7(lang, "rom.today.body")}</p>
        <button type="button" className="cta" onClick={onStart}>
          {tV7(lang, "rom.findings.startCheck")}
          <CheckIcon name="arrow-forward" />
        </button>
        {latest && (
          <button type="button" className="ghost" onClick={() => onOpenFindings(latest)}>
            {tV7(lang, "rom.today.results")}
          </button>
        )}
      </section>
    </CheckRoot>
  );
}
