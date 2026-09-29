/**
 * S33 Postponed and S35 Paused today.
 *
 * S33: today's check is postponed after a pre-check answer: why in plain words (the reason's data
 * screen, as a SentenceStack), the call controls the text names (997 first, then 937, Q22), and when to
 * try again (scr_paused_today with {when}, Q33 (4)). No Back: the answers cannot be changed to get past
 * a postpone. check_postpone plays on entry (not for sci_ready). The body itself is not read by the
 * device voice until its speech line is approved (O12 interim, O24-2): it is shown in full.
 * sci_ready (no lock): the list again and "Done, go through the list again".
 *
 * S35: a start refused by a lock: the lock line only, never its reason (Q25 (c)), and the care team
 * release when the lock allows it (releasableByClearance).
 */
import { t } from "../../../i18n";
import { bidiText } from "../../../i18n/rich";
import { CHECK_DATA, precheckItem, screenText } from "../../../movements/assessments";
import type { PrecheckItem } from "../../../movements/types";
import type { ScreenProps } from "../screenTypes";
import { CallLink, CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { callsFor, pausedLine, postponeScreen, whenOfLock } from "./copy";
import { ListenButton, SentenceStack, TimeText } from "./parts";
import { useEntryLines, useVoice } from "./voice";

export function Postponed({ model, dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const voice = useVoice(model.data.soundMode);
  const s = model.state.kind === "postponed" ? model.state : null;
  const reason = s?.reason ?? "unwell";
  const sci = reason === "sci_ready";
  const screen = postponeScreen(reason, s?.screen ?? null);
  const body = screenText(screen, lang);
  const calls = callsFor(body);
  const when = sci ? null : whenOfLock(model.data.lock, Date.now(), "start");
  const list = sci ? ((precheckItem("pc_sci_ready") as PrecheckItem).list?.[lang] ?? []) : [];
  // check_postpone says what the title and the body already show: spoken, not captioned again.
  useEntryLines(voice, sci ? [] : [{ cue: "check_postpone" }], !sci, { onScreen: true });
  const exit = {
    label: t(lang, guest ? "assessment.guest.staff.restart" : "assessment.common.backToToday"),
    onClick: () => dispatch({ type: "EXIT" }),
  };
  return (
    <CheckShell
      sound={!sci}
      footer={
        sci
          ? {
              primary: {
                label: t(lang, "assessment.postpone.sciAgain"),
                onClick: () => dispatch({ type: "RECHECK" }),
              },
              secondary: exit,
            }
          : { primary: exit }
      }
    >
      <div className="flow-stack" data-screen="S33" data-reason={reason}>
        <section className="check-card is-cream flow-lock-card" aria-labelledby="flow-postpone-title">
          <span className="check-card-icon">
            <CheckIcon name="pause" />
          </span>
          <h1 id="flow-postpone-title">
            {t(lang, sci ? "assessment.postpone.titleSci" : "assessment.postpone.title")}
          </h1>
          <SentenceStack text={body} size={20} />
          {sci && (
            <ul className="flow-list flow-read-list">
              {list.map((item, i) => (
                <li key={i}>{bidiText(lang, item)}</li>
              ))}
            </ul>
          )}
        </section>
        {calls.map((n) => (
          <CallLink
            key={n}
            number={n}
            label={n === "997" ? CHECK_DATA.emergencyCall.button[lang] : t(lang, "assessment.common.call937")}
          />
        ))}
        {!sci && (
          <ListenButton onClick={() => void voice.play([{ cue: "check_postpone" }], { onScreen: true })} />
        )}
        {/* A booth visitor has no account and the lock ends with the visit: the staff line, as the
            safety screens show it for guests, never "try again tomorrow after ...". */}
        {!sci && (
          <p className="check-body">
            {guest ? t(lang, "assessment.safety.boothStaff") : <TimeText text={pausedLine(lang, when)} />}
          </p>
        )}
      </div>
    </CheckShell>
  );
}

export function PausedToday({ model, dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const s = model.state.kind === "paused" ? model.state : null;
  const now = Date.now();
  const when =
    s?.when ??
    whenOfLock(model.data.lock ?? (s?.until ? { reason: "", until: s.until } : null), now, "return");
  // A guest's visit lock: only the staff reset or a new visitor ends it (S57), so no way back in here.
  // SPEC-GAP: booth-visit-lock-exit. The spec has no booth form of S35: no primary is offered while the
  // lock runs; the booth badge's staff reset starts the next visit.
  const guestLocked = guest && !!s?.until && s.until > now;
  return (
    <CheckShell
      exit={!guest}
      footer={
        guestLocked
          ? undefined
          : {
              primary: {
                label: t(lang, guest ? "assessment.guest.staff.restart" : "assessment.common.backToToday"),
                onClick: () => dispatch({ type: "EXIT" }),
              },
            }
      }
    >
      <div className="flow-stack" data-screen="S35">
        <section
          className="check-card is-cream flow-lock-card"
          role="status"
          aria-labelledby="flow-paused-title"
        >
          <span className="check-card-icon">
            <CheckIcon name="pause" />
          </span>
          <h1 id="flow-paused-title">{t(lang, "assessment.entry.locked.title")}</h1>
          <p className="check-body">
            {guest ? t(lang, "assessment.safety.boothStaff") : <TimeText text={pausedLine(lang, when)} />}
          </p>
        </section>
        {s?.releasable && !guest && (
          <button type="button" className="ghost flow-release" onClick={() => dispatch({ type: "RELEASE" })}>
            {t(lang, "assessment.entry.locked.cleared")}
          </button>
        )}
      </div>
    </CheckShell>
  );
}
