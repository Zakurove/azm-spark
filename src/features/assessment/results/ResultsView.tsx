/**
 * S50 to S52, one ResultsView in three variants (UX spec S50 to S52):
 *   S50 guest       «نتائجك اليوم»: nothing saved, the register block with its QR (booth), new visitor
 *   S51 first       «نقطة بدايتك»: the first result of each series, then the next step
 *   S52 re-test     «نتائجك الآن»: then and now per series from compareSeries, once the server has saved
 *                   the check (GET /api/progress); until then the values of today, marked not saved yet
 * An ended early check shows the ended early header. check_done plays on entry for a completed check,
 * 800 ms after focus reaches the h1, and is captioned. S49 always comes first (the flow).
 *
 * States: L saving while the completion runs (values render at once); E nothing measured (every card
 * not measured, the lead becomes results.noneMeasured); Er the save failed (chip and Try again); Off
 * values with the chip and state.offline.savedLater (the banner); Cam not applicable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CuePlayer } from "../../../app/audio";
import { t } from "../../../i18n";
import { bidiText, tx } from "../../../i18n/rich";
import { CHECK_DATA, cueLine } from "../../../movements/assessments";
import { RETEST_DAYS, REPEAT_OFFER_DAYS } from "../../../medical/assessment";
import { dayLabel, nextDueText } from "../../progress/format";
import { todaysViews, type SeriesViewLike } from "../../progress/series";
import type { HeavierOfferState } from "../../progress/ThenNow";
import "../../progress/progress.css";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { ErrorState } from "../shared/states";
import { ScreenIdChip } from "../shared/ScreenStub";
import { resultsModel, type ResultsModel } from "./model";
import { QrCode } from "./QrCode";
import { ResultCards } from "./ResultCards";
import "./results.css";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = Math.round(RETEST_DAYS / 7);

export type SaveState = "saved" | "saving" | "pending" | "error";

/**
 * Where the save of a signed in check stands (UX spec 0.7, S50 to S52 states): saving while the
 * completion or a result is being handed to the outbox; pending while calls wait offline; error when
 * the server refused or could not be reached while online (or the session ended); saved otherwise.
 */
export function saveStateOf(o: {
  guest: boolean;
  effectsPending: boolean;
  waiting: boolean;
  auth: boolean;
  online: boolean;
}): SaveState {
  if (o.guest) return "saved";
  if (o.effectsPending) return "saving";
  if (o.auth) return "error";
  if (o.waiting) return o.online ? "error" : "pending";
  return "saved";
}

/**
 * Try again of a save: the outbox of the check (useCheckFlow) sends what waits whenever the page is
 * shown again, so the same signal asks it to send now.
 */
// SPEC-GAP: retry-save. Screens get no call to flush the outbox; the page shown signal is the one
// useCheckFlow listens to (see the foundation requests: a retrySave in the screen props).
export function requestOutboxFlush(): void {
  if (typeof document !== "undefined") document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * The register link of the booth QR (S50, S57): the public site's sign up, never this visit's data.
 * `app=1` opens the account page App.tsx has today; `register=1` names the sign up (UX spec S50).
 */
// SPEC-GAP: register-entry. App.tsx opens the account page from ?app=1 and has no ?register=1 entry
// yet; the link carries both, so it works now and opens the sign up once App reads register=1 (see
// the foundation requests).
export function registerLink(origin: string): { url: string; short: string } {
  const u = new URL("/?app=1&register=1", origin);
  return { url: u.toString(), short: u.host };
}

function useEntryCue(play: boolean) {
  const ui = useCheckUi();
  const soundOn = ui.sound.on;
  const lang = ui.lang;
  const show = useRef(ui.showCaption);
  show.current = ui.showCaption;
  const clear = useRef(ui.clearCaption);
  clear.current = ui.clearCaption;
  useEffect(() => {
    if (!play) return;
    const line = cueLine("check_done");
    const text = lang === "ar" ? line.ar : line.en;
    let player: CuePlayer | null = null;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const shown = (speaking: boolean) => {
        show.current(text, "info", speaking);
        hide = setTimeout(() => clear.current(), 6000);
      };
      if (!soundOn || typeof Audio === "undefined") return shown(false);
      player = new CuePlayer(lang);
      void player.line("check_done", "info").then(shown, () => shown(false));
    }, 800);
    return () => {
      clearTimeout(timer);
      clearTimeout(hide);
      player?.stop();
    };
    // Once per entry (focus moves to the h1 first, then the line).
  }, [play]);
}

export function ResultsScreen({ model, dispatch, api }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const d = model.data;
  const r: ResultsModel = useMemo(
    () => resultsModel(model),
    [d.protocol, d.outcomes, d.base, d.config.mode, d.checkKind],
  );
  const guest = r.mode === "guest";
  const [now] = useState(() => Date.now());
  const effectsPending = model.effects.some((e) => e.type === "complete" || e.type === "result");
  const save = saveStateOf({
    guest,
    effectsPending,
    waiting: ui.savedLater,
    auth: ui.saveAuth,
    online: ui.online,
  });
  useEntryCue(!r.endedEarly && r.cards.length + r.notToday.length + r.notPart.length > 0);

  // S52: the comparisons of today's series from the server once the check is saved.
  const [views, setViews] = useState<Map<string, SeriesViewLike> | null>(null);
  const measuredKey = r.measured.map((m) => `${m.testId}:${m.side}`).join(",");
  const canCompare = r.mode === "retest" && r.measured.length > 0 && save === "saved" && ui.online;
  useEffect(() => {
    if (!canCompare) return;
    let active = true;
    void api.getProgress().then((res) => {
      if (active && res.ok) setViews(todaysViews(res.value.tests as SeriesViewLike[], r.measured, d.setting));
    });
    return () => {
      active = false;
    };
  }, [canCompare, measuredKey]);

  // Q26: the heavier weight offer (home, arm curl), chosen per series on this screen.
  const [chosen, setChosen] = useState<Record<string, "heavier" | "same">>({});
  const heavier = (view: SeriesViewLike): HeavierOfferState | undefined =>
    view.loadStep && !guest
      ? {
          chosen: chosen[view.seriesKey] ?? null,
          onChoose: (c) => setChosen((x) => ({ ...x, [view.seriesKey]: c })),
        }
      : undefined;

  const title = r.endedEarly
    ? t(lang, "assessment.results.endedEarlyTitle")
    : guest
      ? t(lang, "assessment.guest.resultsTitle")
      : r.mode === "retest"
        ? t(lang, "assessment.results.nowTitle")
        : t(lang, "assessment.results.startTitle");
  const lead = !r.anyMeasured
    ? t(lang, "assessment.results.noneMeasured")
    : r.endedEarly
      ? t(lang, "assessment.results.endedEarlyBody")
      : guest
        ? t(lang, "assessment.guest.notSaved")
        : r.mode === "first"
          ? CHECK_DATA.boundary.firstResult[lang]
          : null;
  const screen = guest ? "S50" : r.mode === "retest" ? "S52" : "S51";
  const b = CHECK_DATA.boundary;
  const booth = d.config.booth;
  const repeat = [...(views?.values() ?? [])].some((v) => v.repeatOffer);
  const home = d.setting === "home";
  const sideLeanOnly = d.config.session === "side_lean_only";

  return (
    <CheckShell
      brand
      sound
      footer={
        guest
          ? booth
            ? {
                secondary: {
                  label: t(lang, "assessment.guest.newVisitor"),
                  onClick: () => dispatch({ type: "NEW_VISITOR" }),
                },
              }
            : undefined
          : {
              primary: {
                label: t(lang, "assessment.common.backToToday"),
                onClick: () => dispatch({ type: "EXIT" }),
              },
              secondary: {
                label: t(lang, "assessment.results.seeOverTime"),
                onClick: () => dispatch({ type: "PROGRESS" }),
              },
            }
      }
    >
      <div className="rs-head" data-screen={screen} data-save={save}>
        <div className="rs-head-row">
          <h1>{title}</h1>
          {(save === "pending" || save === "error") && (
            <span className="check-chip" data-chip="notSaved">
              {t(lang, "assessment.common.notSavedYet")}
            </span>
          )}
        </div>
        {lead && <p className="pg-lead">{bidiText(lang, lead)}</p>}
        {guest && !r.anyMeasured && <p className="check-meta">{t(lang, "assessment.guest.notSaved")}</p>}
        {save === "saving" && (
          <p className="check-meta" role="status">
            {t(lang, "assessment.state.loading.saving")}
          </p>
        )}
        {save === "error" && (
          <ErrorState
            title={t(lang, "assessment.state.error.title")}
            body={t(lang, "assessment.state.error.body")}
            onRetry={requestOutboxFlush}
          />
        )}
        <ScreenIdChip id={screen} />
      </div>

      <ResultCards model={r} views={views ?? undefined} heavier={heavier} />

      {!guest && (
        <section className="rs-next" aria-labelledby="rs-next-title">
          <h2 id="rs-next-title">{t(lang, "assessment.results.nextHeading")}</h2>
          {home && !r.endedEarly && !sideLeanOnly && (
            <p className="check-body">{bidiText(lang, nextDueText(lang, now + RETEST_DAYS * DAY_MS))}</p>
          )}
          {repeat && (
            <p className="check-body">
              {tx(lang, "assessment.entry.repeatOffer.body", {
                from: dayLabel(lang, now + REPEAT_OFFER_DAYS[0] * DAY_MS),
                to: dayLabel(lang, now + REPEAT_OFFER_DAYS[1] * DAY_MS),
              })}
            </p>
          )}
          <p className="check-body">{t(lang, "assessment.results.keepProgram")}</p>
        </section>
      )}

      {guest && <KeepBlock homeOpen={d.config.homeOpen} booth={booth} />}

      <footer className="check-results-footer">
        <p className="check-label">{bidiText(lang, b.resultsFooter[lang])}</p>
        <p className="check-meta">{bidiText(lang, b.line[lang])}</p>
        <p className="check-label">{b.notMedical[lang]}</p>
      </footer>
    </CheckShell>
  );
}

/**
 * S50 register block: keep your own starting point. The QR (booth mode) points to the public site's
 * sign up, never to anything that carries this visit's data; its short address is printed under it.
 */
function KeepBlock({ homeOpen, booth }: { homeOpen: boolean; booth: boolean }) {
  const { lang } = useCheckUi();
  const link = registerLink(typeof location === "undefined" ? "https://azm.invalid" : location.origin);
  const [before, after] = t(lang, "assessment.guest.orOpen", { url: "{url}" }).split("{url}");
  const open = () => {
    // Booth mode: every exit replaces the page, so Back never returns to this visitor (S57).
    if (booth) location.replace(link.url);
    else location.assign(link.url);
  };
  return (
    <section className="check-card is-info rs-keep" aria-labelledby="rs-keep-title">
      <h2 id="rs-keep-title">{t(lang, "assessment.guest.keepTitle")}</h2>
      <p className="check-body">
        {homeOpen
          ? tx(lang, "assessment.guest.keepBody", { weeks: WEEKS })
          : t(lang, "assessment.guest.keepBodySoon")}
      </p>
      {booth && (
        <div className="rs-qr">
          <QrCode text={link.url} label={t(lang, "assessment.guest.qrAlt")} />
          <div className="rs-qr-text">
            <p className="check-body">{t(lang, "assessment.guest.scan")}</p>
            <p className="check-body">
              {before}
              <bdi className="rs-url" lang="en" dir="ltr">
                {link.short}
              </bdi>
              {after}
            </p>
          </div>
        </div>
      )}
      <button type="button" className="cta" onClick={open}>
        {t(lang, "assessment.guest.register")}
      </button>
    </section>
  );
}
