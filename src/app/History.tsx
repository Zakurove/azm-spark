import { useState } from "react";
import { Lang, fmtDate, fmtNum, T } from "./i18n";
import type { SavedSession } from "./product";
import { ui, insight } from "./experience";
import { EXERCISES } from "../exercises/defs";
import RepReview from "./RepReview";
import Icon from "./Icon";
export function sessionCsv(records: SavedSession[]) {
  const rows = [
    [
      "date",
      "exercise",
      "completed_reps",
      "without_flags",
      "with_flags",
      "shorter_range",
      "best_range_pct",
      "effort_0_10",
    ],
    ...records.map((r) => [
      new Date(r.endedAt).toISOString(),
      r.exerciseId,
      r.reps.valid + r.reps.compensated,
      r.reps.valid,
      r.reps.compensated,
      r.reps.partial,
      r.romPct ?? "",
      r.rpe ?? "",
    ]),
  ];
  return rows.map((row) => row.join(",")).join("\r\n");
}
/**
 * The workout history (C44): one list under the sessions block of My results, each session opening
 * its details, with the download of the session numbers. Nothing shows before the first session (the
 * sessions block above says so and links to the program).
 */
export default function History({ lang, records }: { lang: Lang; records: SavedSession[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const x = ui(lang);
  if (records.length === 0) return null;
  const download = () => {
    const url = URL.createObjectURL(new Blob([sessionCsv(records)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "azm-sessions.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="history-page" data-block="workouts">
      <div className="history-title">
        <h3>{x.recent}</h3>
        <button className="ghost" onClick={download}>
          <Icon name="download" size={18} />
          {x.export}
        </button>
      </div>
      <div className="history-list">
        {records.map((r, i) => (
          <div className="history-record" key={`${r.endedAt}-${i}`}>
            <button
              className="history-record-button"
              aria-expanded={expanded === i}
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <span className="history-symbol">
                <Icon name="check" />
              </span>
              <span className="history-record-title">
                <strong>{EXERCISES.find((e) => e.id === r.exerciseId)?.name[lang]}</strong>
                <small>
                  {fmtDate(r.endedAt, lang, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </small>
              </span>
              <span>
                <b>{fmtNum(r.reps.valid + r.reps.compensated, lang)}</b>
                <small>{x.completed}</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            {expanded === i && (
              <div className="history-detail">
                <p>{insight(r.reps, lang)}</p>
                <div className="record-metrics">
                  <span>
                    {T.validReps[lang]}: {fmtNum(r.reps.valid, lang)}
                  </span>
                  <span>
                    {T.compReps[lang]}: {fmtNum(r.reps.compensated, lang)}
                  </span>
                  <span>
                    {T.partialReps[lang]}: {fmtNum(r.reps.partial, lang)}
                  </span>
                  <span>
                    {T.rpeLabel[lang]}: {r.rpe == null ? "·" : fmtNum(r.rpe, lang)}
                  </span>
                </div>
                {r.moments && <RepReview reps={r.moments} lang={lang} />}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="micro history-export-note">{x.exportNote}</p>
    </section>
  );
}
