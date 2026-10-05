/**
 * What the program works on, on the findings page (product v7 contract 2.10 and section 10 E3; plan
 * «4. Findings. One clear page: the range results against normal, the gait pattern, and what we will work
 * on»): the exercises the findings of this check chose, each with its one reason, and a way to the whole
 * program. The findings page (B4) renders it in its targets slot.
 *
 * It shows the program's own choice, never a list the program does not hold: the week stored from this
 * check (GET /api/auth/me), or, when this check is the person's latest completed one and the week does
 * not follow it yet, the week POST /api/program/targets builds from it (the program follows the latest
 * findings, as the Program page does). For an earlier check it renders nothing: the program follows the
 * latest check. Nothing shows while it fails either; the findings stand on their own.
 */
import { useEffect, useId, useMemo, useState } from "react";
import type { Lang } from "../../app/i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { WeeklyPlan } from "../../medical/weekly";
import { Actions, Glass } from "../focus/parts";
import { createProgramApi, type ProgramApi } from "./api";
import { completedNewestFirst, programItems } from "./program";
import "../focus/focus.css";
import "./program.css";

export interface TargetsSummaryProps {
  lang: Lang;
  /** The completed focus check whose findings the targets come from. */
  checkId: string;
  /** Opens the program page. */
  onOpenProgram(): void;
}

/** The exercises the summary names: the first of the week, the program page holds them all. */
export const SUMMARY_ITEMS = 3;

export type SummaryLoad = { kind: "loading" } | { kind: "ready"; weekly: WeeklyPlan } | { kind: "none" };

/** The week of this check: as stored, or built when this check is the latest completed one. */
export async function loadSummary(
  api: Pick<ProgramApi, "me" | "checks" | "targets">,
  checkId: string,
): Promise<SummaryLoad> {
  const me = await api.me();
  const stored = me.ok ? me.value.plan?.weekly : undefined;
  if (stored?.findings?.checkId === checkId) return { kind: "ready", weekly: stored };
  const checks = await api.checks();
  if (!checks.ok || completedNewestFirst(checks.value.checks)[0]?.id !== checkId) return { kind: "none" };
  const built = await api.targets();
  return built.ok && built.value.weekly.findings?.checkId === checkId
    ? { kind: "ready", weekly: built.value.weekly }
    : { kind: "none" };
}

export function TargetsSummary({ lang, checkId, onOpenProgram }: TargetsSummaryProps) {
  const api = useMemo(() => createProgramApi(), []);
  const [load, setLoad] = useState<SummaryLoad>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    setLoad({ kind: "loading" });
    void loadSummary(api, checkId).then((next) => {
      if (live) setLoad(next);
    });
    return () => {
      live = false;
    };
  }, [api, checkId]);
  return <TargetsSummaryView lang={lang} load={load} onOpenProgram={onOpenProgram} />;
}

/** The summary for one state of its load: pure, so it renders the same from a test. */
export function TargetsSummaryView({
  lang,
  load,
  onOpenProgram,
}: {
  lang: Lang;
  load: SummaryLoad;
  onOpenProgram(): void;
}) {
  const headingId = useId();
  const items = useMemo(() => (load.kind === "ready" ? programItems(load.weekly, lang) : []), [load, lang]);
  if (load.kind === "none" || (load.kind === "ready" && items.length === 0)) return null;
  // The findings page's own focus root holds it (its tokens and direction).
  return (
    <Glass className="fx-card pv7-summary">
      <h2 id={headingId} className="fx-h2 pv7-summary-title">
        {tV7(lang, "targets.summary.title")}
      </h2>
      {load.kind === "loading" ? (
        <p className="fx-meta" role="status">
          <span className="fx-spinner" aria-hidden="true" />
          <span>{tV7(lang, "targets.summary.loading")}</span>
        </p>
      ) : (
        <>
          <p className="fx-body is-muted">{tV7(lang, "targets.summary.body")}</p>
          <ul className="pv7-summary-list" aria-labelledby={headingId}>
            {items.slice(0, SUMMARY_ITEMS).map((item) => (
              <li key={item.id} data-exercise={item.id}>
                <b>{item.name}</b>
                <span>{bidiText(lang, item.why)}</span>
              </li>
            ))}
          </ul>
          <Actions
            items={[
              {
                label: tV7(lang, "targets.summary.open"),
                onClick: onOpenProgram,
                name: "program",
                kind: "secondary",
              },
            ]}
          />
        </>
      )}
    </Glass>
  );
}
