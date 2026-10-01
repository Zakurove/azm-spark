/**
 * The movement check on Today and after the intake (UX spec S01, S02, S03, H9):
 *   EntryCard          S01 in each variant (entry.ts), also compact in the My results header (S53)
 *   EarlyStartDialog   the H9 screen before an early start (scr_early_start, earlyStartButtons)
 *   NextDayQuestion    S03, ac_next_day with select then Send, the thanks or scr_after_lasting
 *   AfterIntakeOffer   S02, offered once after the intake is saved while home checks are open
 *   TodayCheckSlot     S03 above S01, from the context, the progress and the list of checks
 * Copy from t() and the check data only. One gold action per card; primaries are never disabled.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CuePlayer } from "../../app/audio";
import type { Lang } from "../../app/i18n";
import { t } from "../../i18n";
import { bidiText, tx } from "../../i18n/rich";
import { CHECK_DATA, precheckItem, screenText } from "../../movements/assessments";
import type { AfterResponse, ApiResult } from "../assessment/api";
import { TokenEndedCard, useBoothMode } from "../assessment/booth";
import { CheckDialog } from "../assessment/shared/CheckDialog";
import CheckIcon from "../assessment/shared/CheckIcon";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import { CallLink } from "../assessment/shared/CheckShell";
import { useCheckUi } from "../assessment/shared/CheckUi";
import { useOnline } from "../assessment/shared/useOnline";
import { queueNextDayAnswer, resumeAllowed } from "../assessment/useCheckFlow";
import { progressApi, useCheckData } from "./data";
import { entryState, type CheckStartOptions, type EntryState } from "./variant";
import { dayLabel, nextDueText, whenText } from "./format";
import "./progress.css";

export type { CheckStartOptions };

/** Weeks between checks in the S01 first body (RETEST_DAYS 28, H9). */
const WEEKS = Math.round(CHECK_DATA.progress.retestDays / 7);

/**
 * A start from a card: the tap unlocks audio with silence (CuePlayer.unlock) and asks for the screen
 * wake lock, then the check opens (S01, S02 interactions).
 */
export function startFromTap(start: () => void): void {
  CuePlayer.unlock();
  const lock = (navigator as Navigator & { wakeLock?: { request(kind: "screen"): Promise<unknown> } })
    .wakeLock;
  void lock?.request("screen").catch(() => undefined);
  start();
}

/* ------------------------------------------------------------ H9 early start */

export function EarlyStartDialog({ onStart, onLater }: { onStart(): void; onLater(): void }) {
  const { lang } = useCheckUi();
  const buttons = CHECK_DATA.earlyStartButtons;
  const label = (v: string) => buttons.find((b) => b.value === v)?.label[lang] ?? "";
  return (
    <CheckDialog titleId="check-early-title" onClose={onLater} initialFocus="#check-early-title">
      <div className="pg-fade check-actions">
        <h2 id="check-early-title" tabIndex={-1}>
          {t(lang, "assessment.name")}
        </h2>
        <p className="check-body">{bidiText(lang, screenText("scr_early_start", lang))}</p>
        <button type="button" className="cta" onClick={onStart}>
          {label("start")}
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          {label("later")}
        </button>
      </div>
    </CheckDialog>
  );
}

/* ------------------------------------------------------------ S01 */

export interface EntryCardProps {
  state: EntryState;
  compact?: boolean;
  offline: boolean;
  onStart(options?: CheckStartOptions): void;
  onResults?(): void;
  onOpenHealth?(): void;
  /**
   * S55b: this tab's visitor token has ended, so booth.tokenEnded shows in place of the start action
   * (a home check never runs under booth rules); its Continue opens the results.
   */
  tokenEnded?: boolean;
}

const ICON: Record<NonNullable<EntryState["variant"]>, string> = {
  blocked: "info",
  homeSoon: "info",
  locked: "pause",
  resume: "spark",
  first: "spark",
  leanRepeat: "calendar",
  due: "calendar",
  repeatOffer: "calendar",
  tooSoon: "calendar",
  upcoming: "calendar",
};

export function EntryCard({
  state,
  compact,
  offline,
  onStart,
  onResults,
  onOpenHealth,
  tokenEnded,
}: EntryCardProps) {
  const { lang } = useCheckUi();
  const [early, setEarly] = useState(false);
  const titleId = useId();
  const v = state.variant;
  if (!v) return null;
  const start = (options?: CheckStartOptions) => startFromTap(() => onStart(options));
  const date = (at: number | undefined) => (at === undefined ? "" : dayLabel(lang, at));
  let title = t(lang, "assessment.name");
  let body: string | null = null;
  let primary: { label: string; run(): void } | null = null;
  let secondary: { label: string; run(): void; kind: "ghost" | "text" } | null = null;
  switch (v) {
    case "blocked":
      title = t(lang, "assessment.entry.blocked.title");
      body = t(lang, "assessment.entry.blocked.body");
      if (onOpenHealth)
        secondary = { label: t(lang, "assessment.entry.blocked.link"), run: onOpenHealth, kind: "ghost" };
      break;
    case "homeSoon":
      body = t(lang, "assessment.entry.homeSoon");
      break;
    case "locked": {
      title = t(lang, "assessment.entry.locked.title");
      const when = whenText(lang, state.lock?.when);
      body = when
        ? screenText("scr_paused_today", lang).replace("{when}", when)
        : screenText("scr_paused_today", lang).split(/(?<=[.؟?])\s+/)[0];
      if (state.lock?.releasable)
        secondary = {
          label: t(lang, "assessment.entry.locked.cleared"),
          run: () => start({ release: true }),
          kind: "ghost",
        };
      break;
    }
    case "resume":
      title = t(lang, "assessment.entry.resume.title");
      body = t(lang, "assessment.entry.resume.body", {
        n: state.resume?.n ?? 1,
        total: state.resume?.total ?? 1,
      });
      primary = {
        label: t(lang, "assessment.entry.resume.cta"),
        run: () => start(state.resume ? { resume: state.resume.check } : undefined),
      };
      break;
    case "first": {
      const [from, to] = state.minutes ?? [0, 0];
      body = t(lang, "assessment.entry.first.body", {
        minutesFrom: from,
        minutesTo: to,
        unit: "min",
        weeks: WEEKS,
      });
      primary = { label: t(lang, "assessment.entry.first.cta"), run: () => start() };
      break;
    }
    case "leanRepeat":
      title = t(lang, "assessment.entry.leanRepeat.title");
      body = CHECK_DATA.progress.sideLeanSecondBaseline.offer[lang];
      primary = {
        label: t(lang, "assessment.entry.leanRepeat.cta"),
        run: () => start({ session: "side_lean_only" }),
      };
      break;
    case "due":
      title = t(lang, "assessment.entry.due.title");
      body = t(lang, "assessment.entry.due.body");
      primary = { label: t(lang, "assessment.entry.first.cta"), run: () => start() };
      break;
    case "repeatOffer":
      // Inside «بين … و…» the weekday's comma would read as a list: the range names days and months only.
      body = t(lang, "assessment.entry.repeatOffer.body", {
        from: state.dates.from === undefined ? "" : dayLabel(lang, state.dates.from, { weekday: false }),
        to: state.dates.to === undefined ? "" : dayLabel(lang, state.dates.to, { weekday: false }),
      });
      primary = { label: t(lang, "assessment.entry.repeatOffer.cta"), run: () => start() };
      break;
    case "tooSoon":
      body = t(lang, "assessment.entry.tooSoon.body", { date: date(state.dates.earliest) });
      break;
    case "upcoming":
      body = state.dates.next !== undefined ? nextDueText(lang, state.dates.next) : null;
      secondary = {
        label: t(lang, "assessment.entry.upcoming.early"),
        run: () => setEarly(true),
        kind: "text",
      };
      break;
  }
  const cream = v === "locked";
  const startable = primary !== null || v === "upcoming" || (v === "locked" && secondary !== null);
  return (
    <section
      className={`check-card pg-entry${cream ? " is-cream" : ""}${compact ? " is-compact" : ""}`}
      aria-labelledby={titleId}
      data-screen="S01"
      data-variant={v}
      role={cream ? "status" : undefined}
    >
      <div className="pg-entry-head">
        <h2 id={titleId}>{title}</h2>
        <span className="check-card-icon" aria-hidden="true">
          <CheckIcon name={ICON[v]} />
        </span>
      </div>
      {body && <p className="check-body">{bidiText(lang, body)}</p>}
      {tokenEnded && startable ? (
        <TokenEndedCard onContinue={() => onResults?.()} />
      ) : offline && startable ? (
        <p className="check-meta">{t(lang, "assessment.state.offline.startBlocked")}</p>
      ) : (
        <>
          {cream && secondary && <div className="pg-entry-divider" aria-hidden="true" />}
          {primary && (
            <button type="button" className="cta" onClick={primary.run}>
              {primary.label}
              <CheckIcon name="arrow-forward" />
            </button>
          )}
          {secondary && (
            <button
              type="button"
              className={secondary.kind === "ghost" ? "ghost" : "check-text-button"}
              onClick={secondary.run}
            >
              {secondary.label}
            </button>
          )}
        </>
      )}
      {state.endedEarlyToday && (
        <p className="pg-entry-extra check-body">
          <span>{t(lang, "assessment.entry.endedEarly")}</span>
          {onResults && (
            <button type="button" className="check-text-button" onClick={onResults}>
              {t(lang, "assessment.entry.endedEarlyLink")}
            </button>
          )}
        </p>
      )}
      {early && (
        <EarlyStartDialog
          onStart={() => {
            setEarly(false);
            start();
          }}
          onLater={() => setEarly(false)}
        />
      )}
    </section>
  );
}

/** The S01 card while the context loads: a 120 px skeleton, never a spinner in the middle of Today. */
export function EntrySkeleton() {
  const { lang } = useCheckUi();
  return (
    <section className="check-card pg-entry pg-entry-skeleton" data-screen="S01" aria-busy="true">
      <div className="check-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p className="check-visually-hidden" role="status">
        {t(lang, "assessment.state.loading.default")}
      </p>
    </section>
  );
}

/** S01 Er: the context could not load; the rest of Today still works. */
export function EntryError({ onRetry }: { onRetry(): void }) {
  const { lang } = useCheckUi();
  const titleId = useId();
  return (
    <section
      className="check-card is-cream pg-entry"
      data-screen="S01"
      data-variant="error"
      aria-labelledby={titleId}
    >
      <div className="pg-entry-head">
        <h2 id={titleId}>{t(lang, "assessment.name")}</h2>
        <span className="check-card-icon" aria-hidden="true">
          <CheckIcon name="info" />
        </span>
      </div>
      <p className="check-body" role="alert">
        {t(lang, "assessment.entry.error")}
      </p>
      <button type="button" className="ghost" onClick={onRetry}>
        <CheckIcon name="refresh" />
        {t(lang, "assessment.common.retry")}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------ S03 */

export type NextDayAnswer = "usual" | "settled" | "lasting";

export interface NextDayQuestionProps {
  lang: Lang;
  /**
   * Resolves when the answer is saved, or with "queued" when it waits for the connection (offline);
   * rejects on a server error.
   */
  onSend(value: NextDayAnswer): Promise<void | "queued">;
  onNotNow(): void;
}

/** What this session already answered (S03 shows its thanks for the rest of the session). */
let answeredThisSession: { value: NextDayAnswer; queued: boolean } | null = null;
/** "I will answer later": hidden until the next app open inside the window. */
let laterThisSession = false;

/** Resets the session memory of S03 (tests). */
export function resetNextDaySession(): void {
  answeredThisSession = null;
  laterThisSession = false;
}

export function nextDayHidden(): boolean {
  return laterThisSession && answeredThisSession === null;
}

/**
 * S03 (ac_next_day): on Today at arm's length, so select, then Send. fieldset and legend; each row
 * a button with aria-pressed. After sending, the thanks (or scr_after_lasting with the 937 call) for
 * the rest of the session, as a status. Offline the answer waits and "Not saved yet" shows.
 */
export function NextDayQuestion({ lang, onSend, onNotNow }: NextDayQuestionProps) {
  const ui = useCheckUi();
  const item = precheckItem("ac_next_day");
  const [value, setValue] = useState<NextDayAnswer | null>(answeredThisSession?.value ?? null);
  const [phase, setPhase] = useState<"ask" | "sending" | "error" | "sent">(
    answeredThisSession ? "sent" : "ask",
  );
  const [queued, setQueued] = useState(answeredThisSession?.queued ?? false);
  const [tried, setTried] = useState(false);
  const legendId = useId();
  const hintId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (phase === "sent") statusRef.current?.focus();
  }, [phase]);

  if (phase === "sent" && value) {
    const lasting = value === "lasting";
    return (
      <section className="check-card pg-next-day" data-screen="S03" data-sent={value}>
        <p className="check-body" role="status" tabIndex={-1} ref={statusRef}>
          {bidiText(
            lang,
            lasting ? screenText("scr_after_lasting", lang) : t(lang, "assessment.after.thanks"),
          )}
        </p>
        {lasting && <CallLink number="937" label={t(lang, "assessment.common.call937")} />}
        {queued && <span className="check-chip">{t(lang, "assessment.common.notSavedYet")}</span>}
      </section>
    );
  }
  const send = async () => {
    if (!value) {
      setTried(true);
      groupRef.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    setPhase("sending");
    try {
      const queuedNow = (await onSend(value)) === "queued" || !ui.online;
      answeredThisSession = { value, queued: queuedNow };
      setQueued(queuedNow);
      setPhase("sent");
    } catch {
      setPhase("error");
    }
  };
  return (
    <section className="check-card pg-next-day" data-screen="S03">
      <fieldset>
        <legend id={legendId}>
          <h2>{bidiText(lang, item.ask[lang])}</h2>
        </legend>
        {tried && !value && (
          <p id={hintId} className="check-field-error">
            {t(lang, "assessment.common.chooseToContinue")}
          </p>
        )}
        <div
          className="check-answers"
          role="group"
          aria-labelledby={legendId}
          aria-describedby={tried && !value ? hintId : undefined}
          ref={groupRef}
        >
          {(item.options ?? []).map((o) => (
            <button
              key={String(o.value)}
              type="button"
              className="check-answer"
              aria-pressed={value === o.value}
              data-mode="select"
              onClick={() => setValue(o.value as NextDayAnswer)}
            >
              <span className="check-answer-mark" aria-hidden="true">
                <CheckIcon name="check" size={18} />
              </span>
              <span className="check-answer-text">{bidiText(lang, o.label[lang])}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {phase === "error" && (
        <p className="check-field-error" role="alert">
          {t(lang, "assessment.state.error.body")}
        </p>
      )}
      <button type="button" className="cta" onClick={send} aria-busy={phase === "sending" || undefined}>
        {phase === "error" ? t(lang, "assessment.common.retry") : t(lang, "assessment.after.send")}
      </button>
      <button
        type="button"
        className="check-text-button"
        onClick={() => {
          laterThisSession = true;
          onNotNow();
        }}
      >
        {t(lang, "assessment.after.notNow")}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------ S02 */

export interface AfterIntakeOfferProps {
  lang: Lang;
  /** Estimated minutes of the base selection (estimateMinutes, S27). */
  minutes: [number, number];
  onStart(): void;
  onLater(): void;
  /** Where focus goes when the offer closes (5.1): the Program page h1, since the intake is gone. */
  returnFocus?: () => HTMLElement | null;
}

/** S02: offered once after the intake is saved, only while home checks are open. */
export function AfterIntakeOffer({ lang, minutes, onStart, onLater, returnFocus }: AfterIntakeOfferProps) {
  const { online } = useOnline();
  return (
    <CheckRoot ui={{ lang, online }} page={false}>
      <CheckDialog
        titleId="check-after-intake-title"
        onClose={onLater}
        initialFocus="#check-after-intake-title"
        returnFocus={returnFocus}
      >
        <div className="pg-fade check-actions" data-screen="S02">
          <h2 id="check-after-intake-title" tabIndex={-1}>
            {t(lang, "assessment.afterIntake.title")}
          </h2>
          <p className="check-body">
            {tx(lang, "assessment.afterIntake.body", {
              minutesFrom: minutes[0],
              minutesTo: minutes[1],
              unit: "min",
            })}
          </p>
          {online ? (
            <button type="button" className="cta" onClick={() => startFromTap(onStart)}>
              {t(lang, "assessment.afterIntake.start")}
            </button>
          ) : (
            <p className="check-field-error" role="status">
              {t(lang, "assessment.state.offline.startBlocked")}
            </p>
          )}
          <button type="button" className="ghost" onClick={onLater}>
            {t(lang, "assessment.afterIntake.later")}
          </button>
        </div>
      </CheckDialog>
    </CheckRoot>
  );
}

/* ------------------------------------------------------------ the Today slot */

export interface TodayCheckSlotProps {
  lang: Lang;
  /** This tab is in verified booth mode (S01 homeSoon does not apply). */
  booth: boolean;
  /**
   * Opens the check (CheckApp, signed in). The options name a resume (O6), the side lean only session
   * (Q12 (2)) or the care team release of a lock; App.tsx passes them to CheckApp.
   */
  onStart(options?: CheckStartOptions): void;
  /** Opens the results page (S53). */
  onOpenResults(): void;
  /** Opens the health profile (S01 blocked). */
  onOpenHealth(): void;
  /** The signed in account (its user id): keeps the last loaded copy for offline use (0.7). */
  owner?: string;
}

/**
 * A next day answer: sent now, or (offline) kept in this account's outbox (resultQueue.ts, type
 * after), which survives a reload and sends it when the connection returns or the app opens again.
 */
async function sendAfter(value: NextDayAnswer, owner?: string): Promise<void | "queued"> {
  const r: ApiResult<AfterResponse> = await progressApi().postAfter(value);
  if (r.ok) return;
  if (r.error.kind === "http") throw new Error(r.error.code);
  if (owner) await queueNextDayAnswer(owner, value);
  else {
    // No account to keep it for (tests): it waits for the connection while the page is open.
    const retry = () => {
      window.removeEventListener("online", retry);
      void progressApi().postAfter(value);
    };
    window.addEventListener("online", retry);
  }
  return "queued";
}

/**
 * The Today slot: S03 (the next day question, when due) above the S01 entry card. It loads GET
 * /api/assessments/context, GET /api/progress and GET /api/assessments and picks the S01 variant.
 */
export function TodayCheckSlot({
  lang,
  booth,
  onStart,
  onOpenResults,
  onOpenHealth,
  owner,
}: TodayCheckSlotProps) {
  const { data, reload, online } = useCheckData(owner);
  const { tokenEnded } = useBoothMode();
  const [laterNow, setLaterNow] = useState(nextDayHidden());
  const [now] = useState(() => Date.now());
  const ctx = data.context;
  let body: ReactNode = null;
  let followUp = false;
  if (ctx.status === "loading") body = <EntrySkeleton />;
  else if (ctx.status === "error" && ctx.code === "PLAN_REQUIRED") body = null;
  else if (ctx.status !== "ok") body = <EntryError onRetry={() => void reload()} />;
  else {
    const state = entryState({
      context: ctx.value,
      progress: data.progress.status === "ok" ? data.progress.value : null,
      checks: data.checks.status === "ok" ? data.checks.value : null,
      booth,
      now,
      resumeAllowed,
    });
    followUp = state.followUp || answeredThisSession !== null;
    body = (
      <EntryCard
        state={state}
        offline={!online}
        onStart={onStart}
        onResults={onOpenResults}
        onOpenHealth={onOpenHealth}
        tokenEnded={tokenEnded}
      />
    );
  }
  return (
    <CheckRoot ui={{ lang, booth, online }} page={false} className="check-slot">
      {followUp && !laterNow && (
        <NextDayQuestion lang={lang} onSend={(v) => sendAfter(v, owner)} onNotNow={() => setLaterNow(true)} />
      )}
      {body}
    </CheckRoot>
  );
}
