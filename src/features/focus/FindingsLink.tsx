/**
 * The findings link on the My results tab (product v7 contract 1.3, stream B; D-026 item 1): the
 * person's completed focus checks, newest first, each opening its findings page. It loads its own data
 * (GET /api/focus) and renders nothing before it arrives, when the call fails, or when no focus check
 * is completed yet (the way into a check is the Today page's).
 *
 * It wears the My results tab's own rows (progress.css: the section, its heading and the history
 * rows), so it reads as one more list of that page. src/app/App.tsx renders it at the top of My
 * results, in a VITE_V7=1 build only.
 */
import { useEffect, useId, useState } from "react";
import { fmtDate, type Lang } from "../../app/i18n";
import { tV7 } from "../../i18n/v7";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { createFocusApi, type FocusCheckSummary } from "./api";
import "../progress/progress.css";

export interface FindingsLinkProps {
  lang: Lang;
  /** The signed in person's id: the owner of the check's waiting calls, as in the v1 check. */
  owner: string;
  /** Opens the findings of a completed check, or of the latest with null (/?findings=1). */
  onOpenFindings(checkId: string | null): void;
  /** Opens the focus check (/?focus=1). */
  onStart(): void;
}

/** The completed checks, newest first (GET /api/focus lists every check, newest first). */
export function completedChecks(checks: readonly FocusCheckSummary[]): FocusCheckSummary[] {
  return checks
    .filter((c) => c.status === "completed" && c.completed !== null)
    .sort((a, b) => b.completed! - a.completed!);
}

export default function FindingsLink({ lang, owner, onOpenFindings }: FindingsLinkProps) {
  const [checks, setChecks] = useState<FocusCheckSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    void createFocusApi()
      .checks()
      .then((r) => {
        if (live) setChecks(r.ok ? completedChecks(r.value.checks) : []);
      });
    return () => {
      live = false;
    };
  }, [owner]);
  if (!checks || checks.length === 0) return null;
  return <FindingsLinkList lang={lang} checks={checks} onOpenFindings={onOpenFindings} />;
}

/** The list itself: one row per completed check, the earliest marked as the starting point. */
export function FindingsLinkList({
  lang,
  checks,
  onOpenFindings,
}: {
  lang: Lang;
  checks: readonly FocusCheckSummary[];
  onOpenFindings(checkId: string | null): void;
}) {
  const headingId = useId();
  const day = (at: number) =>
    fmtDate(at, lang, { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
  return (
    <CheckRoot ui={{ lang }} page={false} className="check-results-page">
      <section className="pg-section" aria-labelledby={headingId} data-block="focus-findings">
        <h2 id={headingId}>{tV7(lang, "rom.findings.title")}</h2>
        <ul className="pg-history">
          {checks.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className="pg-history-row"
                data-focus-check={c.id}
                onClick={() => onOpenFindings(c.id)}
              >
                <span className="pg-history-text">
                  <span className="pg-meta-part">{day(c.completed!)}</span>{" "}
                  <span className="pg-meta-part">{tV7(lang, "rom.shell.name")}</span>{" "}
                  {i === checks.length - 1 && checks.length > 1 && (
                    <span className="pg-meta-part">{tV7(lang, "rom.findings.startPoint")}</span>
                  )}
                </span>
                <CheckIcon name="arrow-forward" size={20} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </CheckRoot>
  );
}
