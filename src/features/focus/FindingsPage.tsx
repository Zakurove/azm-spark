/**
 * The findings page (product v7 contract 1.2 and section 10 B4; plan «4. Findings. One clear page: the
 * range results against normal, the gait pattern, and what we will work on»): a completed focus check's
 * range results against what is typical for the person's sex and age, the body map summary, the gait
 * card slot (GaitFindingsCard, stream C) and the targets slot (TargetsSummary, stream E), with the
 * changes since the starting point on a retest. It loads its own data: GET /api/focus/profile (the
 * latest completed check, or the one named) and GET /api/auth/me (the intake, for the knee's uncertain
 * label of rom-protocol 7.4).
 *
 * The words and numbers come from findings.ts (pure); this file renders them in the focus check's
 * family (focus.css: a warm light stage, glass cards, Cairo, gold and purple, no hard borders) with the
 * page's own parts in findings.css. src/app/App.tsx opens it at /?findings=1 (with &check=<id> for one
 * check) for a signed in person, in a VITE_V7=1 build only.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { Intake } from "../../medical/plan";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import CheckIcon from "../assessment/shared/CheckIcon";
import { BodyMap } from "../body-map/BodyMap";
import { GaitFindingsCard } from "../gait/GaitFindingsCard";
import { TargetsSummary } from "../program-v7/TargetsSummary";
import { createFocusApi, type FocusApi, type FocusProfile } from "./api";
import { findingsView, type BarView, type GroupView, type RowView, type Tone } from "./findings";
import { Actions, Body, Glass, Kicker, Loading, Page, Title, TopBar } from "./parts";
import "./focus.css";
import "./findings.css";

/** Where the findings page leaves to. */
export type FindingsExit = "today" | "results" | "program" | "focus";

export interface FindingsPageProps {
  lang: Lang;
  onLanguage(): void;
  /** The completed focus check to show; null shows the latest one. */
  checkId: string | null;
  /** "program" opens the program page (ProgramPage, E); "focus" starts a focus check. */
  onExit(to: FindingsExit): void;
}

/** What the page shows: the answer, or why there is none. */
export type FindingsLoad =
  | { kind: "loading" }
  | { kind: "ready"; data: FocusProfile; intake: Intake | null }
  | { kind: "none" }
  | { kind: "intake" }
  | { kind: "error" };

/** The calls of one load: the check's findings and the intake beside them. */
export async function loadFindings(
  api: Pick<FocusApi, "profile" | "me">,
  checkId: string | null,
): Promise<FindingsLoad> {
  const [p, me] = await Promise.all([api.profile(checkId), api.me()]);
  if (!p.ok) {
    const e = p.error;
    if (e.kind === "http" && e.status === 404 && e.code === "NONE") return { kind: "none" };
    if (
      e.kind === "http" &&
      e.status === 409 &&
      (e.code === "INTAKE_UPDATE_REQUIRED" || e.code === "PLAN_REQUIRED")
    )
      return { kind: "intake" };
    return { kind: "error" };
  }
  // The intake only refines a label (7.4), so the page shows its results without it.
  return { kind: "ready", data: p.value, intake: me.ok ? me.value.intake : null };
}

export default function FindingsPage({ lang, onLanguage, checkId, onExit }: FindingsPageProps) {
  const api = useMemo(() => createFocusApi(), []);
  const [load, setLoad] = useState<FindingsLoad>({ kind: "loading" });
  const asked = useRef(0);
  const fetchFindings = useCallback(async () => {
    const n = ++asked.current;
    setLoad({ kind: "loading" });
    const next = await loadFindings(api, checkId);
    // Only the last request answers the page (a quick retry or a new check never shows an older one).
    if (n === asked.current) setLoad(next);
  }, [api, checkId]);
  useEffect(() => {
    void fetchFindings();
    return () => {
      asked.current++;
    };
  }, [fetchFindings]);
  return (
    <FindingsScreen
      lang={lang}
      load={load}
      onLanguage={onLanguage}
      onExit={onExit}
      onRetry={() => void fetchFindings()}
    />
  );
}

/** The page for one state of its load: pure, so it renders the same from a test. */
export function FindingsScreen({
  lang,
  load,
  onLanguage,
  onExit,
  onRetry,
}: {
  lang: Lang;
  load: FindingsLoad;
  onLanguage(): void;
  onExit(to: FindingsExit): void;
  onRetry(): void;
}) {
  const top = (
    <TopBar
      lang={lang}
      onLanguage={onLanguage}
      onLeave={() => onExit("today")}
      leaveLabel={tV7(lang, "rom.findings.close")}
    />
  );
  const today = {
    label: t(lang, "assessment.common.backToToday"),
    onClick: () => onExit("today"),
    kind: "secondary" as const,
    name: "today",
  };
  let screen: string;
  let content;
  switch (load.kind) {
    case "loading":
      screen = "findings_loading";
      content = <Loading text={tV7(lang, "rom.findings.loading")} />;
      break;
    case "none":
      screen = "findings_none";
      content = (
        <div className="fx-findings-empty">
          <Glass className="fx-card fx-hero">
            <span className="fx-badge is-violet" aria-hidden="true">
              <CheckIcon name="arm-side" size={28} />
            </span>
            <Title>{tV7(lang, "rom.findings.noneTitle")}</Title>
            <Body lang={lang} text={tV7(lang, "rom.findings.noneBody")} />
          </Glass>
          <Actions
            items={[
              today,
              {
                label: tV7(lang, "rom.findings.startCheck"),
                onClick: () => onExit("focus"),
                name: "start",
                icon: "play",
              },
            ]}
          />
        </div>
      );
      break;
    case "intake":
      screen = "findings_intake";
      content = (
        <div className="fx-findings-empty">
          <Glass className="fx-card fx-hero">
            <span className="fx-badge is-violet" aria-hidden="true">
              <CheckIcon name="people" size={28} />
            </span>
            <Title>{tV7(lang, "rom.closed.intakeTitle")}</Title>
            <Body lang={lang} text={tV7(lang, "rom.closed.intakeBody")} />
          </Glass>
          <Actions items={[today]} />
        </div>
      );
      break;
    case "error":
      screen = "findings_error";
      content = (
        <div className="fx-findings-empty">
          <Glass className="fx-card">
            <Title>{t(lang, "assessment.state.error.title")}</Title>
            <Body lang={lang} text={tV7(lang, "rom.findings.loadError")} />
          </Glass>
          <Actions
            items={[
              today,
              { label: t(lang, "assessment.common.retry"), onClick: onRetry, name: "retry", icon: "refresh" },
            ]}
          />
        </div>
      );
      break;
    case "ready":
      screen = "findings";
      content = <FindingsBody lang={lang} data={load.data} intake={load.intake} onExit={onExit} />;
      break;
  }
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page lang={lang} top={top} screen={screen} wide={load.kind === "ready"}>
        {content}
      </Page>
    </CheckRoot>
  );
}

/** The results: the check and its body map beside the joints, the walk, the targets and the other joints. */
export function FindingsBody({
  lang,
  data,
  intake,
  onExit,
}: {
  lang: Lang;
  data: FocusProfile;
  intake: Intake | null;
  onExit(to: FindingsExit): void;
}) {
  const view = useMemo(() => findingsView(data, intake, lang), [data, intake, lang]);
  const rangeId = useId();
  const walkId = useId();
  const othersId = useId();
  return (
    <div className="fx-findings">
      <div className="fx-findings-aside">
        <Glass className="fx-card fx-findings-hero">
          <Kicker>{tV7(lang, "rom.shell.name")}</Kicker>
          <Title>{tV7(lang, "rom.findings.title")}</Title>
          <p className="fx-meta">
            <CheckIcon name="calendar" size={20} />
            <span>{tV7(lang, "rom.findings.when", { date: view.date })}</span>
          </p>
          <Body lang={lang} text={tV7(lang, "rom.findings.intro")} muted />
        </Glass>
        {view.groups.length > 0 && (
          <Glass className="fx-card fx-findings-map">
            <h2 className="fx-h2">{tV7(lang, "rom.findings.mapTitle")}</h2>
            <BodyMap lang={lang} mode="summary" colours={data.bodyMap} notes={view.mapNotes} />
            {view.legend.length > 0 && (
              <ul className="fx-legend">
                {view.legend.map((l) => (
                  <li key={l.tone} data-tone={l.tone}>
                    <i className={`fx-dot is-${l.tone}`} aria-hidden="true" />
                    <span>{l.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Glass>
        )}
      </div>
      <div className="fx-findings-main">
        {view.groups.length > 0 && (
          <section className="fx-findings-range" aria-labelledby={rangeId}>
            <h2 id={rangeId} className="fx-h2 fx-findings-heading">
              {tV7(lang, "rom.findings.rangeTitle")}
            </h2>
            {view.changes && (
              <p className="fx-findings-lead">{bidiText(lang, tV7(lang, "rom.findings.changesNote"))}</p>
            )}
            <ul className="fx-bar-key" aria-hidden="true">
              <li>
                <i className="is-band" />
                <span>{tV7(lang, "rom.findings.keyBand")}</span>
              </li>
              <li>
                <i className="is-typical" />
                <span>{tV7(lang, "rom.findings.keyTypical")}</span>
              </li>
              {view.changes && (
                <li>
                  <i className="is-first" />
                  <span>{tV7(lang, "rom.findings.keyFirst")}</span>
                </li>
              )}
              <li>
                <i className="is-value" />
                <span>{tV7(lang, "rom.findings.keyValue")}</span>
              </li>
            </ul>
            {view.groups.map((g) => (
              <GroupCard key={g.cell} lang={lang} group={g} />
            ))}
          </section>
        )}
        {data.gait && (
          <div className="fx-findings-slot" data-slot="gait">
            <GaitFindingsCard gait={data.gait} lang={lang} />
          </div>
        )}
        {view.walk.length > 0 && (
          <Glass className="fx-card fx-findings-walk">
            <h2 id={walkId} className="fx-h2">
              {tV7(lang, "rom.findings.walkTitle")}
            </h2>
            <ul className="fx-walk" aria-labelledby={walkId}>
              {view.walk.map((w) => (
                <li key={w.metric} data-metric={w.metric}>
                  <span className="fx-walk-label">{w.label}</span>
                  <b>{bidiText(lang, w.values)}</b>
                  {w.same && <span className="fx-pill">{tV7(lang, "rom.findings.change.same")}</span>}
                </li>
              ))}
            </ul>
          </Glass>
        )}
        {view.checkId && (
          <div className="fx-findings-slot" data-slot="targets">
            <TargetsSummary lang={lang} checkId={view.checkId} onOpenProgram={() => onExit("program")} />
          </div>
        )}
        {view.others.length > 0 && (
          <Glass className="fx-card fx-findings-others">
            <h2 id={othersId} className="fx-h2">
              {tV7(lang, "rom.findings.othersTitle")}
            </h2>
            <Body lang={lang} text={tV7(lang, "rom.findings.othersBody")} muted />
            <ul className="fx-others" aria-labelledby={othersId}>
              {view.others.map((o) => (
                <li key={o} className="fx-pill">
                  {o}
                </li>
              ))}
            </ul>
          </Glass>
        )}
        <Actions
          items={[
            {
              label: tV7(lang, "rom.findings.results"),
              onClick: () => onExit("results"),
              kind: "secondary",
              name: "results",
            },
            {
              label: t(lang, "assessment.common.backToToday"),
              onClick: () => onExit("today"),
              kind: "secondary",
              name: "today",
            },
          ]}
        />
      </div>
    </div>
  );
}

/** One body map cell of the history: its joint, its colour and its movements. */
function GroupCard({ lang, group }: { lang: Lang; group: GroupView }) {
  const id = useId();
  return (
    <Glass className="fx-card fx-group">
      <header className="fx-group-head" data-cell={group.cell}>
        {group.tone && <i className={`fx-dot is-${group.tone}`} aria-hidden="true" />}
        <h3 id={id} className="fx-group-title">
          {group.title}
        </h3>
      </header>
      <ul className="fx-rows" aria-labelledby={id}>
        {group.rows.map((r) => (
          <Row key={r.key} lang={lang} row={r} />
        ))}
        {group.unmeasured && (
          <li className="fx-row fx-unmeasured" data-tone="grey">
            <div className="fx-row-head">
              <ul className="fx-unmeasured-names">
                {group.unmeasured.names.map((n) => (
                  <li key={n}>
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
              <span className="fx-tag is-grey">{group.unmeasured.label}</span>
            </div>
            <p className="fx-row-line">{bidiText(lang, group.unmeasured.line)}</p>
          </li>
        )}
      </ul>
      {group.findings.map((f) => (
        <p key={f} className="fx-row-finding fx-group-finding">
          {bidiText(lang, f)}
        </p>
      ))}
    </Glass>
  );
}

/** One movement: its name and label, the value against the typical value, its lines and its change. */
function Row({ lang, row }: { lang: Lang; row: RowView }) {
  return (
    <li
      className="fx-row"
      data-movement={row.movementId}
      data-side={row.side}
      data-finding={row.findingId}
      data-tone={row.label?.tone ?? "none"}
    >
      <div className="fx-row-head">
        <span className="fx-row-name">
          <b>{row.name}</b>
          {row.direction && <small>{row.direction}</small>}
        </span>
        {row.label && <span className={`fx-tag is-${row.label.tone}`}>{row.label.text}</span>}
      </div>
      {row.value !== null && (
        <div className="fx-row-value">
          <span className="fx-row-number">
            <b dir="ltr">{row.value}</b>
            {row.caption && <small>{row.caption}</small>}
          </span>
          {row.typical && (
            <span className="fx-row-typical">
              <span>{tV7(lang, "rom.result.typical")}</span>
              <b dir="ltr">{row.typical}</b>
            </span>
          )}
        </div>
      )}
      {row.bar && <Bar bar={row.bar} tone={row.label?.tone ?? "grey"} />}
      {row.line && <p className="fx-row-line">{bidiText(lang, row.line)}</p>}
      {row.notes.length > 0 && (
        <div className="fx-chips">
          {row.notes.map((n) => (
            <span key={n} className="fx-pill">
              {n}
            </span>
          ))}
        </div>
      )}
      {row.change && (
        <p className={`fx-change is-${row.change.direction}`} data-change={row.change.direction}>
          <b>{row.change.text}</b>
          <span>{bidiText(lang, row.change.values)}</span>
        </p>
      )}
      {row.finding && <p className="fx-row-finding">{bidiText(lang, row.finding)}</p>}
      {row.more.map((m) => (
        <p key={m} className="fx-note">
          <CheckIcon name="info" size={20} />
          <span>{bidiText(lang, m)}</span>
        </p>
      ))}
    </li>
  );
}

/**
 * The value on its scale: the within normal band in gold, the typical mark, the starting point (a
 * hollow ring) and today's value. It starts at the reading side, as the dial does; the numbers and
 * lines say the same in words, so it is hidden from screen readers.
 */
function Bar({ bar, tone }: { bar: BarView; tone: Tone }) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / bar.max) * 100)).toFixed(2)}%`;
  const span = (from: number, to: number) =>
    `${Math.max(0, Math.min(100, ((to - from) / bar.max) * 100)).toFixed(2)}%`;
  return (
    <div className="fx-bar" data-tone={tone} aria-hidden="true">
      <span className="fx-bar-track" />
      {bar.band && (
        <span
          className="fx-bar-band"
          style={{ insetInlineStart: pct(bar.band[0]), width: span(bar.band[0], bar.band[1]) }}
        />
      )}
      {bar.typical !== null && (
        <span className="fx-bar-typical" style={{ insetInlineStart: pct(bar.typical) }} />
      )}
      {bar.first !== null && <span className="fx-bar-first" style={{ insetInlineStart: pct(bar.first) }} />}
      <span className="fx-bar-value" style={{ insetInlineStart: pct(bar.value) }} />
    </div>
  );
}
