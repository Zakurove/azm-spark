/**
 * S53, the nav page نتائجي · My results (UX spec S53; the name avoids "progress", O7):
 *   - the next check (S01 compact, with the H9 early start, the side lean repeat and the repeat offer);
 *   - one "How to read this" note, then per series start and now (GET /api/progress), trends only from
 *     the third check, the booth series after the home series, older lines of comparison collapsed;
 *     the Q26 heavier weight offer (C42);
 *   - the sessions block (consistency and adherence) with the workout history under it (C44), and
 *     every check, whose row opens the S52 view of that check, read only;
 *   - no footer disclaimer (D-017 item 2).
 * States: L skeleton cards; E no completed check (the CTA follows S01, hidden when blocked); Er the
 * progress failed, the next check card still renders from the context; Off the last loaded copy with
 * its date, or the offline empty state; Cam not applicable.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { CHECK_DATA } from "../../movements/assessments";
import type { ContextResponse, StoredCheck } from "../assessment/api";
import { ResultCards } from "../assessment/results/ResultCards";
import { storedCheckModel } from "../assessment/results/model";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { useCheckUi } from "../assessment/shared/CheckUi";
import { OfflineBanner } from "../assessment/shared/states";
import { resumeAllowed } from "../assessment/useCheckFlow";
import { progressApi, useCheckData } from "./data";
import { canStartFrom, entryState, type CheckStartOptions } from "./variant";
import { EntryCard, EntrySkeleton, startFromTap } from "./EntryCards";
import { dayLabel } from "./format";
import { seriesContextOf, storedResultsOf, viewsAsOf } from "./local";
import { seriesCards, type SeriesViewLike } from "./series";
import { CheckHistoryList, SessionsBlock, historyRows, sessionsOf } from "./Sessions";
import { HowToRead, SeriesCard, type HeavierOfferState } from "./ThenNow";
import "./progress.css";

export interface ResultsPageProps {
  lang: Lang;
  /** Opens the check; the options name a resume, the side lean only session or a lock release. */
  onStartCheck(options?: CheckStartOptions): void;
  onOpenProgram(): void;
  /** The signed in account (its user id): keeps the last loaded copy for offline use (0.7). */
  owner?: string;
  /** The workout history of the portal, under the sessions block (C44). */
  workouts?: ReactNode;
  /**
   * v7 (D-027 item 3): the person has a completed focus check, so a starting point already; null
   * while that is not known yet. Absent in the default build. See checksSection.
   */
  focusDone?: boolean | null;
}

/**
 * What the movement check's section of My results shows: the loading cards, the error or offline
 * card, the series cards, the empty state, or nothing ("none"). The empty state («ستظهر نتائج
 * قياساتك هنا. أجرِ قياس الحركة لتحدد نقطة بدايتك.») asks for a first check to set a starting point,
 * so with a completed focus check (D-027 item 3, change log W2-11) the section stays out, and while
 * the focus checks are not known yet (null) it waits with the loading cards rather than flash the
 * empty state. Without `focusDone` (the default build) the page is as before.
 */
export function checksSection(
  progress: "loading" | "ok" | "error" | "offline",
  empty: boolean,
  focusDone?: boolean | null,
): "loading" | "error" | "offline" | "cards" | "empty" | "none" {
  if (progress !== "ok") return progress;
  if (!empty) return "cards";
  if (focusDone === null) return "loading";
  return focusDone ? "none" : "empty";
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="check-card" aria-hidden="true">
      <div className="check-skeleton">
        {Array.from({ length: lines }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}

/** A state card inside a section (E, Er, Off): an h3 under the section's h2. */
function StateCard({
  icon,
  title,
  body,
  action,
  cream,
  alert,
}: {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; onClick(): void; primary?: boolean; icon?: string };
  cream?: boolean;
  alert?: boolean;
}) {
  return (
    <div className={`check-card${cream ? " is-cream" : ""}`} role={alert ? "alert" : undefined}>
      <span className="check-card-icon" aria-hidden="true">
        <CheckIcon name={icon} />
      </span>
      <h3 className="pg-h3">{title}</h3>
      <p className="check-body">{body}</p>
      {action && (
        <button type="button" className={action.primary ? "cta" : "ghost"} onClick={action.onClick}>
          {action.icon && <CheckIcon name={action.icon} />}
          {action.label}
        </button>
      )}
    </div>
  );
}

/** The S52 view of one earlier check, read only, from the list of checks (S53 history rows). */
function CheckDetail({
  check,
  checks,
  context,
  onBack,
}: {
  check: StoredCheck;
  checks: readonly StoredCheck[];
  context: ContextResponse | null;
  onBack(): void;
}) {
  const { lang } = useCheckUi();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => headingRef.current?.focus(), []);
  const person = context?.ctx ?? null;
  const model = storedCheckModel(check);
  let views: Map<string, SeriesViewLike> | undefined;
  if (person) {
    const results = storedResultsOf(checks, person.position, context?.setup);
    const list = viewsAsOf(results, check, seriesContextOf(person, context?.setup));
    views = new Map(list.map((v) => [`${v.testId}:${v.side}`, v]));
  }
  return (
    <section className="pg-section" aria-labelledby={titleId} data-detail={check.id}>
      <button type="button" className="check-text-button pg-back" onClick={onBack}>
        <CheckIcon name="arrow-back" />
        {t(lang, "assessment.common.back")}
      </button>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {dayLabel(lang, check.completed ?? check.started)}
      </h2>
      <p className="check-meta">
        <span className="pg-meta-part">
          {check.setting === "booth"
            ? CHECK_DATA.progress.labels.boothPoint[lang]
            : t(lang, "progress.trend.home")}
        </span>{" "}
        {check.status !== "completed" && (
          <span className="pg-meta-part">{t(lang, "progress.history.endedEarly")}</span>
        )}
      </p>
      <ResultCards model={model} views={views} level={3} />
    </section>
  );
}

export function ResultsPage({
  lang,
  onStartCheck,
  onOpenProgram,
  owner,
  workouts,
  focusDone,
}: ResultsPageProps) {
  const { data, reload, online } = useCheckData(owner);
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, "heavier" | "same">>({});
  const lastOpened = useRef<string | null>(null);
  const headingId = useId();
  const sessionsId = useId();
  const historyId = useId();

  const context = data.context.status === "ok" ? data.context.value : null;
  const progress = data.progress.status === "ok" ? data.progress.value : null;
  const checks = data.checks.status === "ok" ? data.checks.value : null;
  const person = context?.ctx ?? null;
  const entry = context ? entryState({ context, progress, checks, now, resumeAllowed }) : null;
  const cards = progress
    ? seriesCards(progress.tests as SeriesViewLike[], {
        support: person?.support,
        position: person?.position,
      })
    : [];
  const history = checks ? historyRows(checks) : [];
  const empty = progress !== null && cards.length === 0 && history.length === 0;
  const startable = entry !== null && canStartFrom(entry.variant) && online;
  const detail = open && checks ? checks.find((c) => c.id === open) : undefined;

  // Focus goes back to the row that opened a check.
  useEffect(() => {
    if (open || !lastOpened.current) return;
    document.querySelector<HTMLElement>(`[data-check="${lastOpened.current}"]`)?.focus();
    lastOpened.current = null;
  }, [open]);

  const heavier = (view: SeriesViewLike): HeavierOfferState | undefined =>
    view.loadStep && view.setting === "home"
      ? {
          chosen: chosen[view.seriesKey] ?? null,
          onChoose: (c) => {
            setChosen((x) => ({ ...x, [view.seriesKey]: c }));
            // Kept for the next check of that arm (POST /api/progress/load-step, Q26).
            if (view.side === "left" || view.side === "right") void progressApi().postLoadStep(view.side, c);
          },
        }
      : undefined;

  const showEntry = entry?.variant && !(empty && startable);
  const section = checksSection(data.progress.status, empty, focusDone);
  let checksBody;
  if (section === "loading") {
    checksBody = (
      <>
        <SkeletonCard />
        <SkeletonCard />
        <p className="check-visually-hidden" role="status">
          {t(lang, "progress.loading")}
        </p>
      </>
    );
  } else if (section === "error") {
    checksBody = (
      <StateCard
        icon="info"
        cream
        alert
        title={t(lang, "progress.error.title")}
        body={t(lang, "progress.error.body")}
        action={{
          label: t(lang, "assessment.common.retry"),
          onClick: () => void reload(),
          primary: true,
          icon: "refresh",
        }}
      />
    );
  } else if (section === "offline") {
    checksBody = (
      <StateCard
        icon="wifi-off"
        title={t(lang, "progress.empty.title")}
        body={t(lang, "progress.offline.none")}
      />
    );
  } else if (section === "empty") {
    checksBody = (
      <StateCard
        icon="chart"
        title={t(lang, "progress.empty.title")}
        body={t(lang, "progress.empty.body")}
        action={
          startable
            ? {
                label: t(lang, "progress.empty.cta"),
                onClick: () => startFromTap(() => onStartCheck()),
                primary: true,
              }
            : undefined
        }
      />
    );
  } else if (section === "cards") {
    checksBody = (
      <>
        <HowToRead />
        <ul className="pg-cards">
          {cards.map((c) => (
            <li key={c.key}>
              <SeriesCard
                view={c.view}
                earlier={c.earlier}
                boothPoints={c.boothPoints}
                heavierOffer={heavier(c.view)}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <CheckRoot ui={{ lang, online, screenKey: "S53" }} page={false} className="check-results-page">
      <OfflineBanner />
      {!online && data.loadedAt !== null && (
        <p className="check-meta" data-last-loaded="">
          {bidiText(
            lang,
            t(lang, "assessment.state.offline.lastLoaded", {
              date: dayLabel(lang, data.loadedAt, { weekday: false }),
            }),
          )}
        </p>
      )}
      {detail && checks ? (
        <CheckDetail
          check={detail}
          checks={checks}
          context={context}
          onBack={() => {
            lastOpened.current = detail.id;
            setOpen(null);
          }}
        />
      ) : (
        <>
          {data.context.status === "loading" && <EntrySkeleton />}
          {showEntry && entry && <EntryCard compact state={entry} offline={!online} onStart={onStartCheck} />}
          {section !== "none" && (
            <section className="pg-section" data-screen="S53" aria-labelledby={headingId}>
              <h2 id={headingId}>{t(lang, "progress.checks.heading")}</h2>
              {checksBody}
            </section>
          )}
          <section className="pg-section" aria-labelledby={sessionsId} data-block="sessions">
            <h2 id={sessionsId}>{t(lang, "progress.sessions.heading")}</h2>
            {data.progress.status === "loading" ? (
              <SkeletonCard lines={2} />
            ) : progress ? (
              <SessionsBlock data={sessionsOf(progress)} onOpenProgram={onOpenProgram} />
            ) : null}
            {workouts}
          </section>
          {history.length > 0 && (
            <section className="pg-section" aria-labelledby={historyId} data-block="history">
              <h2 id={historyId}>{t(lang, "progress.history.heading")}</h2>
              <CheckHistoryList checks={history} onOpen={(id) => setOpen(id)} />
            </section>
          )}
        </>
      )}
    </CheckRoot>
  );
}
