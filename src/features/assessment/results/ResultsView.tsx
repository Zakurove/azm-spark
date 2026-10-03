/**
 * S50 to S52, one ResultsView in three variants (UX spec S50 to S52):
 *   S50 guest       «نتائجك اليوم»: the values, the register block with its QR (booth), new visitor
 *   S51 first       «نقطة بدايتك»: the first result of each series, then the next check's date
 *   S52 re-test     «نتائجك الآن»: then and now per series from compareSeries, once the server has saved
 *                   the check (GET /api/progress); until then the values of today, marked not saved yet
 * An ended early check shows the ended early header. S49 always comes first (the flow). No footer
 * disclaimer (D-017 item 2).
 *
 * States: L saving while the completion runs (values render at once); E nothing measured (every card
 * not measured, the lead becomes results.noneMeasured); Er the save failed (chip and Try again); Off
 * values with the chip and state.offline.savedLater (the banner); Cam not applicable.
 */
import { useEffect, useMemo, useState } from "react";
import { t } from "../../../i18n";
import { bidiText, tx } from "../../../i18n/rich";
import { CHECK_DATA } from "../../../movements/assessments";
import { RETEST_DAYS, REPEAT_OFFER_DAYS } from "../../../medical/assessment";
import { dayLabel } from "../../progress/format";
import { todaysViews, type SeriesViewLike } from "../../progress/series";
import { HowToRead, type HeavierOfferState } from "../../progress/ThenNow";
import "../../progress/progress.css";
import type { ScreenProps } from "../screenTypes";
import { CheckShell } from "../shared/CheckShell";
import { useCheckUi } from "../shared/CheckUi";
import { ErrorState } from "../shared/states";
import { resultsModel, type ResultsModel } from "./model";
import { ResetDialog, startNextVisitor } from "../booth/BoothLayer";
import { QrCode } from "../shared/QrCode";
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
 * The register link of the booth QR (S50, S57): the public site's sign up, never this visit's data.
 * App.tsx opens the account page on its register tab from `register=1` (UX spec S50).
 */
export function registerLink(origin: string): { url: string; short: string } {
  const u = new URL("/?app=1&register=1", origin);
  return { url: u.toString(), short: u.host };
}

export function ResultsScreen({ model, dispatch, api, retrySave }: ScreenProps) {
  const ui = useCheckUi();
  const { lang } = ui;
  const d = model.data;
  const r: ResultsModel = useMemo(
    () => resultsModel(model),
    [d.protocol, d.outcomes, d.base, d.config.mode, d.checkKind],
  );
  const guest = r.mode === "guest";
  const [now] = useState(() => Date.now());
  const [newVisitor, setNewVisitor] = useState(false);
  const effectsPending = model.effects.some((e) => e.type === "complete" || e.type === "result");
  const save = saveStateOf({
    guest,
    effectsPending,
    waiting: ui.savedLater,
    auth: ui.saveAuth,
    online: ui.online,
  });
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
          onChoose: (c) => {
            setChosen((x) => ({ ...x, [view.seriesKey]: c }));
            // Kept for the next check of that arm (POST /api/progress/load-step, Q26).
            if (view.side === "left" || view.side === "right") void api.postLoadStep(view.side, c);
          },
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
      : r.mode === "first"
        ? CHECK_DATA.boundary.firstResult[lang]
        : null;
  const screen = guest ? "S50" : r.mode === "retest" ? "S52" : "S51";
  const booth = d.config.booth;
  const repeat = [...(views?.values() ?? [])].some((v) => v.repeatOffer);
  const home = d.setting === "home";
  const sideLeanOnly = d.config.session === "side_lean_only";

  return (
    <CheckShell
      brand
      sound
      // S51 and S52: the top bar ✕ returns to Today (the check is over, so it is not Exit).
      close={
        guest
          ? undefined
          : { label: t(lang, "assessment.common.backToToday"), onClick: () => dispatch({ type: "EXIT" }) }
      }
      footer={
        guest
          ? booth
            ? {
                // S57: New visitor asks first, then clears the visit and loads the page again.
                secondary: {
                  label: t(lang, "assessment.guest.newVisitor"),
                  onClick: () => setNewVisitor(true),
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
        {save === "saving" && (
          <p className="check-meta" role="status">
            {t(lang, "assessment.state.loading.saving")}
          </p>
        )}
        {save === "error" && (
          <ErrorState
            title={t(lang, "assessment.state.error.title")}
            body={t(lang, "assessment.state.error.body")}
            onRetry={retrySave}
          />
        )}
      </div>

      {views && views.size > 0 && <HowToRead />}
      <ResultCards model={r} views={views ?? undefined} heavier={heavier} />

      {!guest && (
        <section className="rs-next" aria-labelledby="rs-next-title">
          <h2 id="rs-next-title">{t(lang, "assessment.results.nextHeading")}</h2>
          {home && !r.endedEarly && !sideLeanOnly && (
            <p className="check-body">
              {bidiText(
                lang,
                t(lang, "assessment.results.nextDate", { date: dayLabel(lang, now + RETEST_DAYS * DAY_MS) }),
              )}
            </p>
          )}
          {repeat && (
            <p className="check-body">
              {tx(lang, "assessment.entry.repeatOffer.body", {
                from: dayLabel(lang, now + REPEAT_OFFER_DAYS[0] * DAY_MS, { weekday: false }),
                to: dayLabel(lang, now + REPEAT_OFFER_DAYS[1] * DAY_MS, { weekday: false }),
              })}
            </p>
          )}
          <p className="check-body">{t(lang, "assessment.results.keepProgram")}</p>
        </section>
      )}

      {guest && <KeepBlock booth={booth} />}

      {newVisitor && (
        <ResetDialog
          onConfirm={() => {
            setNewVisitor(false);
            startNextVisitor(dispatch, { guest: true, online: ui.online });
          }}
          onStay={() => setNewVisitor(false)}
        />
      )}
    </CheckShell>
  );
}

/**
 * S50 register block (C31): «أنشئ حسابًا مجانيًا». At the booth the QR, scanned with the visitor's own
 * phone, points to the public site's sign up, never to anything that carries this visit's data; its
 * short address is printed under it. Off the booth, one line and the button.
 */
function KeepBlock({ booth }: { booth: boolean }) {
  const { lang } = useCheckUi();
  const link = registerLink(typeof location === "undefined" ? "https://azm.invalid" : location.origin);
  const [before, after] = t(lang, "assessment.guest.orOpen", { url: "{url}" }).split("{url}");
  if (!booth)
    return (
      <section className="check-card is-info rs-keep">
        <p className="check-body">{tx(lang, "assessment.guest.keepBody", { weeks: WEEKS })}</p>
        <button type="button" className="cta" onClick={() => location.assign(link.url)}>
          {t(lang, "assessment.guest.register")}
        </button>
      </section>
    );
  return (
    <section className="check-card is-info rs-keep" aria-labelledby="rs-keep-title">
      <h2 id="rs-keep-title">{t(lang, "assessment.guest.register")}</h2>
      <div className="rs-qr">
        <QrCode text={link.url} label={t(lang, "assessment.guest.qrAlt")} showText />
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
    </section>
  );
}
