/**
 * The screens of the focus check around the range blocks (product v7 contract B3; D-032, D-034):
 * loading, closed, the intro with the safety lines once, the start, the safety screens (an emergency,
 * a stop list answer with a screen), the stop list, the walk's slot, saving and the end. Since D-034
 * item 4 there is no consent page (the health form's consent covers it) and no day screen.
 *
 * The clinical words are the data's: the v1 safety screens (screenText), the stop list (check-v1
 * stopRouting), the range copy (rom-v7.json). The interface words are the rom namespace's (src/i18n/{ar,en}/rom.json) and the
 * v1 check's common words.
 */
import { useEffect, useId, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { countPhrase, interpolate, localizeDigits, t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { PrecheckEnv } from "../../medical/precheck";
import { stopOptions } from "../../medical/precheck";
import type { BodyMapKey, RegionId } from "../../medical/body-map";
import type { RomProtocol, RomProtocolItem } from "../../medical/rom-protocol";
import type { BodyMapColour } from "../../medical/rom-types";
import type { GaitPlan } from "../../medical/gait-eligibility";
import { CHECK_DATA, emergencyCallButton, screenText, stopFollowUp } from "../../movements/assessments";
import { ROM_DATA } from "../../movements/rom";
import type { ScreenId, StopOptionId } from "../../movements/types";
import type { CoachStopReason } from "../../coach/types";
import { splitSentences } from "../assessment/flow/copy";
import CheckIcon from "../assessment/shared/CheckIcon";
import { AnswerZones, BigNumber, SafetyHeading, type ZoneOption } from "../assessment/safety/parts";
import { useArmedPress } from "../assessment/safety/hooks";
import { SAFETY_TIMING } from "../assessment/safety/timing";
import { pausedLine } from "../assessment/safety/content";
import { fmtDate } from "../../app/i18n";
import { TIME_ZONE } from "../progress/format";
import type { LockView } from "../assessment/api";
import { BodyMap } from "../body-map/BodyMap";
import { copyText, movementName, regionName } from "./copy";
import { sideRegion } from "./names";
import { checkParts, type ClosedWhy } from "./flow";
import { MovementPicture } from "./MovementPicture";
import { Actions, Body, Glass, Kicker, Loading, PainScale, Title, useFocusOnMount, useModal } from "./parts";

/* ---------------------------------------------------------------- entry */

export function LoadingScreen({ lang }: { lang: Lang }) {
  return <Loading text={tV7(lang, "rom.shell.loading")} />;
}

export function LoadErrorScreen({
  lang,
  onRetry,
  onToday,
}: {
  lang: Lang;
  onRetry(): void;
  onToday(): void;
}) {
  return (
    <Glass className="fx-card">
      <Title>{t(lang, "assessment.state.error.title")}</Title>
      <Body lang={lang} text={tV7(lang, "rom.shell.loadError")} />
      <Actions
        items={[
          {
            label: t(lang, "assessment.common.backToToday"),
            onClick: onToday,
            kind: "secondary",
            name: "today",
          },
          { label: t(lang, "assessment.common.retry"), onClick: onRetry, name: "retry", icon: "refresh" },
        ]}
      />
    </Glass>
  );
}

/** When the next check opens: the weekday, the date and the time in Riyadh (Gregorian, Q30). */
export function opensAt(at: number, lang: Lang): string {
  return fmtDate(at, lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

/** Nothing can start now: the reason, and the one way forward. */
export function ClosedScreen({
  lang,
  why,
  until,
  lock,
  now,
  onToday,
  onHealth,
}: {
  lang: Lang;
  why: ClosedWhy;
  until?: number | null;
  lock?: LockView | null;
  now: number;
  onToday(): void;
  onHealth(): void;
}) {
  const v = (k: string) => tV7(lang, `rom.closed.${k}` as never);
  let title = "";
  let body = "";
  let icon = "info";
  switch (why) {
    case "intake":
      [title, body, icon] = [v("intakeTitle"), v("intakeBody"), "people"];
      break;
    case "home_closed":
      [title, body, icon] = [v("homeTitle"), v("homeBody"), "badge"];
      break;
    case "locked":
      [title, body, icon] = [v("lockedTitle"), lock?.until ? pausedLine(lock.until, now, lang) : "", "pause"];
      break;
    case "too_soon":
      // The day, the date and the time the next check opens (48 hours after the last), as v1's entry
      // card names it: never «tomorrow» for a check two days away.
      [title, body, icon] = [
        v("soonTitle"),
        until ? interpolate(lang, tV7(lang, "rom.closed.soonBody"), { date: opensAt(until, lang) }) : "",
        "calendar",
      ];
      break;
    case "plan":
      [title, body] = [v("planTitle"), v("planBody")];
      break;
    case "review":
      [title, body] = [v("reviewTitle"), v("reviewBody")];
      break;
    case "adult":
      title = t(lang, "assessment.adult.title");
      body = t(lang, "assessment.adult.body", { age: 18 });
      break;
    case "rate":
      [title, body, icon] = [v("rateTitle"), v("rateBody"), "clock"];
      break;
    case "nothing":
      [title, body, icon] = [v("nothingTitle"), v("nothingBody"), "shield"];
      break;
    case "no_camera":
      [title, body, icon] = [v("noCameraTitle"), v("noCameraBody"), "camera"];
      break;
  }
  return (
    <Glass className="fx-card" data-closed={why}>
      <span className="fx-badge" aria-hidden="true">
        <CheckIcon name={icon} size={28} />
      </span>
      <Title>{title}</Title>
      {body && <Body lang={lang} text={body} />}
      <Actions
        items={[
          why === "intake" || why === "plan"
            ? { label: v("intakeAction"), onClick: onHealth, name: "health" }
            : null,
          {
            label: t(lang, "assessment.common.backToToday"),
            onClick: onToday,
            kind: why === "intake" || why === "plan" ? "secondary" : "primary",
            name: "today",
          },
        ]}
      />
    </Glass>
  );
}

/** The minutes of the day's movements (sessionOrder.minutesPerMovement). */
export function minutesOf(items: readonly RomProtocolItem[]): number {
  return Math.max(1, Math.round(items.length * ROM_DATA.sessionOrder.minutesPerMovement));
}

/** The joints of the day's movements (joints.ts), as the intro lists them. */
export { cellOf, jointsOf, type JointGroup } from "./joints";
import { cellOf, jointsOf } from "./joints";

/**
 * Which joints we will measure, and why (plan 1.7): the affected joints of the history, each with its
 * movements, marked on the body map the person filled in; the order of the parts (sit, stand, walk,
 * lie down), so the chair, the space and the bed are ready; the minutes; safety; start.
 */
export function IntroScreen({
  lang,
  protocol,
  gait,
  setting = "booth",
  sciWarning = false,
  onNoCamera,
  wheelchair = false,
  onStart,
}: {
  lang: Lang;
  protocol: RomProtocol;
  gait: GaitPlan | null;
  /** D-017 item 1: no time is mentioned anywhere on the booth path; the minutes show at home only. */
  setting?: "home" | "booth";
  /** v1's warn_sci_t6 once, on the safety card (D-032 item 2: no longer before every part). */
  sciWarning?: boolean;
  /**
   * D-032 item 3, a person whose program waits for the check: «لا أستطيع استخدام الكاميرا», which
   * builds the program from the history.
   */
  onNoCamera?: () => void;
  wheelchair?: boolean;
  onStart(): void;
}) {
  const runs = protocol.items.filter((i) => !i.skipped);
  const joints = jointsOf(runs);
  const parts = checkParts(protocol, gait);
  const colours: Partial<Record<BodyMapKey, BodyMapColour>> = {};
  const notes: Partial<Record<BodyMapKey, string>> = {};
  for (const g of joints) {
    colours[cellOf(g)] = "mild";
    notes[cellOf(g)] = g.items.map((i) => movementName(i.movementId, lang)).join(lang === "ar" ? "، " : ", ");
  }
  return (
    <div className="fx-intro">
      <Glass className="fx-card fx-hero fx-intro-hero">
        <Kicker>{tV7(lang, "rom.shell.name")}</Kicker>
        <Title>{tV7(lang, "rom.intro.title")}</Title>
        <Body lang={lang} text={copyText("intro", lang)} />
        <Body lang={lang} text={copyText("intro_no_diagnosis", lang)} muted />
        {setting === "home" && (
          <p className="fx-meta" data-part="minutes">
            <CheckIcon name="clock" size={20} />
            <span>
              {interpolate(lang, tV7(lang, "rom.intro.minutes"), { n: minutesOf(runs), unit: "min" })}
            </span>
          </p>
        )}
      </Glass>
      <Glass className="fx-card fx-joints">
        <h2 className="fx-h2">{tV7(lang, "rom.intro.joints")}</h2>
        <div className="fx-joints-body">
          <ul className="fx-joint-cards">
            {joints.map((g) => (
              <li key={g.key} className="fx-joint-card">
                <span className="fx-joint-picture" aria-hidden="true">
                  <MovementPicture
                    movementId={g.items[0].movementId}
                    side={g.side}
                    lang={lang}
                    size={52}
                    wheelchair={wheelchair}
                  />
                </span>
                <span className="fx-joint-card-text">
                  <b>{sideRegion(g, lang)}</b>
                  <span className="fx-moves">
                    {g.items.map((i) => (
                      <span key={i.movementId} className="fx-move">
                        {movementName(i.movementId, lang)}
                      </span>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="fx-joints-map">
            <BodyMap lang={lang} mode="summary" colours={colours} notes={notes} />
          </div>
        </div>
        <div className="fx-order">
          <p className="fx-order-name">{tV7(lang, "rom.intro.order")}</p>
          <ol className="fx-order-steps">
            {parts.map((p, i) => (
              <li
                key={p.kind === "range" ? p.block : "gait"}
                className={p.kind === "gait" ? "is-walk" : undefined}
              >
                <b>{localizeDigits(lang, String(i + 1))}</b>
                <span>{tV7(lang, p.kind === "range" ? `rom.intro.${p.block}` : "rom.intro.walkStep")}</span>
              </li>
            ))}
          </ol>
        </div>
      </Glass>
      <Glass className="fx-card fx-safety-note" tone="gold">
        <h2 className="fx-h2">{tV7(lang, "rom.intro.safety")}</h2>
        <Body lang={lang} text={copyText("safety_always", lang)} />
        <Body lang={lang} text={copyText("stop_line", lang)} />
        {/* D-034 item 4: no red STOP on the check's screens; the X at the top stops. */}
        <p className="fx-note" data-note="stop-how">
          <CheckIcon name="close" size={20} />
          <span>{bidiText(lang, tV7(lang, "rom.intro.stopHow"))}</span>
        </p>
        {sciWarning && <WarningNote lang={lang} id="warn_sci_t6" />}
      </Glass>
      <Actions
        items={[
          onNoCamera
            ? {
                label: tV7(lang, "rom.onboarding.noCamera"),
                onClick: onNoCamera,
                kind: "quiet",
                name: "no_camera",
              }
            : null,
          { label: tV7(lang, "rom.intro.start"), onClick: onStart, name: "start", icon: "play" },
        ]}
      />
    </div>
  );
}

/** «الركبة اليمنى» · "Right knee": the region and the side, as the person sees them. */
export { sideRegion } from "./names";

/**
 * The walk's pain question (walk_pain, after a pain stop in a region the walk loads): the region, the
 * pain now, 0 to 10 (rom-protocol 6 pain_during: ask before any other movement of the same joint).
 */
export function WalkPainScreen({
  lang,
  region,
  onAnswer,
}: {
  lang: Lang;
  region: RegionId;
  onAnswer(level: number): void;
}) {
  const title = useId();
  return (
    <Glass className="fx-card fx-question" data-today="pain">
      <Kicker>{regionName(region, lang)}</Kicker>
      <QuestionText lang={lang} id={title} text={copyText("pain_ask", lang)} />
      <PainScale
        lang={lang}
        labelledBy={title}
        nextLabel={t(lang, "assessment.common.next")}
        onDone={onAnswer}
      />
    </Glass>
  );
}

/**
 * A question's words: the first sentence large, what follows («0 means no pain …») under it; a
 * region's red flag question («في الركبة اليوم: …») with its place in purple before the signs.
 */
export function QuestionText({
  lang,
  id,
  text,
  lead = false,
  as = "h1",
  focus = true,
}: {
  lang: Lang;
  id: string;
  text: string;
  lead?: boolean;
  as?: "h1" | "h2";
  /** Takes focus when it opens (off for the questions of a screen with its own heading). */
  focus?: boolean;
}) {
  const H = as;
  // The question takes focus when it opens: a new screen's, or a question opening over the measurement.
  const ref = useFocusOnMount<HTMLHeadingElement>(focus);
  const colon = lead ? text.indexOf(":") : -1;
  if (colon > 0) {
    const place = text.slice(0, colon + 1);
    const rest = text.slice(colon + 1).trim();
    return (
      <H
        ref={ref}
        id={id}
        className={`fx-title is-question${rest.length > 90 ? " is-long" : ""}`}
        tabIndex={-1}
      >
        <span className="fx-q-lead">{bidiText(lang, place)}</span> {bidiText(lang, rest)}
      </H>
    );
  }
  const [first = text, ...more] = splitSentences(text);
  return (
    <>
      <H
        ref={ref}
        id={id}
        className={`fx-title is-question${first.length > 110 ? " is-long" : ""}`}
        tabIndex={-1}
      >
        {bidiText(lang, first)}
      </H>
      {more.length > 0 && <p className="fx-q-more">{bidiText(lang, more.join(" "))}</p>}
    </>
  );
}

export function StartingScreen({
  lang,
  error,
  onRetry,
  onToday,
}: {
  lang: Lang;
  error: "network" | "server" | null;
  onRetry(): void;
  onToday(): void;
}) {
  if (!error) return <Loading text={tV7(lang, "rom.shell.loading")} />;
  return (
    <Glass className="fx-card">
      <Title>{t(lang, "assessment.state.error.titleStart")}</Title>
      <Body lang={lang} text={tV7(lang, "rom.shell.startError")} />
      <Actions
        items={[
          {
            label: t(lang, "assessment.common.backToToday"),
            onClick: onToday,
            kind: "secondary",
            name: "today",
          },
          { label: t(lang, "assessment.common.retry"), onClick: onRetry, name: "retry", icon: "refresh" },
        ]}
      />
    </Glass>
  );
}

/* ------------------------------------------------------------- a v1 warning */

/** A v1 warning as a note card: a caution (warn_pain_high, warn_weak_shoulder) or good to know. */
export function WarningNote({ lang, id, text }: { lang: Lang; id: ScreenId; text?: string }) {
  const warn = id === "warn_pain_high" || id === "warn_weak_shoulder";
  return (
    <section
      className={`fx-warning is-${warn ? "warn" : "info"}`}
      aria-label={t(lang, warn ? "assessment.tone.warn" : "assessment.tone.info")}
      data-warning={id}
    >
      <CheckIcon name={warn ? "alert-triangle" : "info"} size={22} />
      <p>{bidiText(lang, localizeDigits(lang, text ?? screenText(id, lang)))}</p>
    </section>
  );
}

/* ---------------------------------------------------------- safety screens */

type SafetyKind = "emergency" | "ad" | "faint" | "fall" | "seekCare" | "postpone";

function safetyKindOf(screen: ScreenId | null): SafetyKind {
  switch (screen) {
    case "scr_emergency":
      return "emergency";
    case "scr_ad":
      return "ad";
    case "scr_faint":
    case "scr_faint_sci":
      return "faint";
    case "scr_fall":
    case "scr_fall_seated":
      return "fall";
    case "scr_stop_seek_care":
    case "scr_stop_pain":
      return "seekCare";
    default:
      return "postpone";
  }
}

const SAFETY_HEADING: Record<SafetyKind, string> = {
  emergency: "assessment.safety.emergency.title",
  ad: "assessment.safety.ad.title",
  faint: "assessment.safety.faint.title",
  fall: "assessment.safety.fall.title",
  seekCare: "assessment.safety.seekCare.title",
  postpone: "assessment.postpone.title",
};
const SAFETY_ICON: Record<SafetyKind, string> = {
  emergency: "alert-triangle",
  ad: "alert-triangle",
  faint: "faint",
  fall: "fall",
  seekCare: "shield",
  postpone: "pause",
};

/**
 * A v1 safety screen (UX spec S36 to S40, map 2.7): the heading, the data's text sentence by sentence,
 * the ambulance number on the emergency screen, the calls the text names, the paused line of a lock,
 * and the one way on.
 */
export function SafetyScreen({
  lang,
  screen,
  alsoShow = [],
  lock = null,
  now,
  next,
}: {
  lang: Lang;
  screen: ScreenId | null;
  alsoShow?: ScreenId[];
  lock?: LockView | null;
  now: number;
  next: { label: string; onClick(): void; name: string };
}) {
  const kind = safetyKindOf(screen);
  const screens = [screen, ...alsoShow].filter((s): s is ScreenId => !!s);
  const texts = screens.map((s) => screenText(s, lang));
  const all = texts.join(" ");
  const calls997 = /997|٩٩٧/.test(all);
  const calls937 = /937|٩٣٧/.test(all);
  const call = emergencyCallButton(lang);
  const heading = t(lang, SAFETY_HEADING[kind] as never);
  // The first sentence that repeats the heading's words is not printed again under it (v1 skipFirst).
  const same = (a: string, b: string) => a.replace(/[.؟?!،,\s]+/g, "") === b.replace(/[.؟?!،,\s]+/g, "");
  return (
    <Glass
      className={`fx-card fx-safety is-${kind}`}
      tone={kind === "emergency" || kind === "ad" ? "rose" : undefined}
    >
      <div className="fx-v1">
        <SafetyHeading icon={SAFETY_ICON[kind]} text={heading} />
      </div>
      {kind === "emergency" && (
        <div className="fx-v1">
          <BigNumber />
        </div>
      )}
      {texts.map((text, k) => (
        <div key={k} className="fx-sentences">
          {splitSentences(localizeDigits(lang, text)).map((s, i) =>
            k === 0 && i === 0 && same(s, heading) ? null : <p key={i}>{bidiText(lang, s)}</p>,
          )}
        </div>
      ))}
      {lock?.until && <p className="fx-body">{bidiText(lang, pausedLine(lock.until, now, lang))}</p>}
      <div className="fx-actions is-column">
        {calls997 && (
          <a className="fx-button is-call" href={call.href} data-action="call997">
            <CheckIcon name="phone-call" size={22} />
            <span>{localizeDigits(lang, call.label)}</span>
          </a>
        )}
        {calls937 && (
          <a className="fx-button is-secondary" href="tel:937" data-action="call937">
            <CheckIcon name="phone-call" size={22} />
            <span>{t(lang, "assessment.common.call937")}</span>
          </a>
        )}
        <button
          type="button"
          className={`fx-button is-${calls997 ? "secondary" : "primary"}`}
          onClick={next.onClick}
          data-action={next.name}
        >
          <span>{next.label}</span>
        </button>
      </div>
    </Glass>
  );
}

/**
 * The faint follow up (v1 S38b, sf_faint_loc, Q33 (3), O42) after a faint or a fall stop's screen,
 * once the person is settled: «هل فقدت الوعي، ولو للحظة؟». Yes or Not sure open the emergency screen
 * at once; No shows the stop's screen again with its lock. It waits for the answer: there is no timer
 * (D-016). The stop's first sentence stays under the answers, as in v1.
 */
export function FaintAskScreen({
  lang,
  back,
  onAnswer,
}: {
  lang: Lang;
  /** The stop's screen (scr_faint, scr_fall, scr_fall_seated). */
  back: ScreenId | null;
  onAnswer(value: "yes" | "no" | "unsure"): void;
}) {
  const q = stopFollowUp("sf_faint_loc");
  const title = useId();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const options: ZoneOption[] = q.options.map((o) => ({
    value: o.value as string,
    label: o.label[lang],
    icon: o.value === "yes" ? "check" : o.value === "no" ? "close" : "help",
    commitAtOnce: true,
  }));
  const intro = back ? (splitSentences(localizeDigits(lang, screenText(back, lang)))[0] ?? "") : "";
  return (
    <Glass className="fx-card fx-question fx-faint" tone="rose">
      <h1 ref={heading} id={title} className="fx-title is-question" tabIndex={-1}>
        {bidiText(lang, q.ask[lang])}
      </h1>
      <div className="fx-v1 fx-zones">
        <AnswerZones
          labelledBy={title}
          options={options}
          onAnswer={(v) => onAnswer(v as "yes" | "no" | "unsure")}
        />
      </div>
      {intro && <Body lang={lang} text={intro} muted />}
    </Glass>
  );
}

const STOP_ICONS: Record<StopOptionId, string> = {
  chest: "heart",
  stroke_signs: "bolt",
  ad_signs: "alert-triangle",
  faint: "faint",
  breath: "breath",
  fall: "fall",
  pain: "arrow-up",
  tired: "pause",
  choice: "stop-square",
  other: "help",
};

/**
 * D-030 D5-11: the coach's preselected answer comes into view when the list opens (on a phone the other
 * reasons sit below the urgent group); the list keeps the urgent options first.
 */
export function scrollPreselected(root: ParentNode | null, preselect: string): void {
  const row = root?.querySelector<HTMLElement>(`.fx-stop-row[data-option="${preselect}"]`);
  row?.scrollIntoView?.({ block: "center" });
}

/**
 * The stop list (S41, Q31): the data's options for this person, symptoms and falls first, one tap each
 * (no Next, no «pressed by mistake» row, O43). The coach's reason is preselected and highlighted; the
 * person confirms it with the tap (C-7). Since D-034 item 4 it opens from the X's «توقّف الآن» (there is
 * no red STOP under it any more), from the coach's stop or from a pain stop of the walk.
 */
export function StopListScreen({
  lang,
  env,
  preselect,
  onChoose,
}: {
  lang: Lang;
  env: PrecheckEnv;
  preselect: CoachStopReason | null;
  onChoose(option: StopOptionId): void;
}) {
  const shown = new Set(stopOptions(env));
  const title = useId();
  // A double tap on the press that opened it must never pick a reason: a row counts only for a press
  // that started on it after the list opened, and not within 600 ms of a press that opened it (v1
  // useArmedPress, SAFETY_TIMING.stopArmMs, R3C-03 (6)). Keyboard and switch activation always count.
  const armed = useArmedPress(SAFETY_TIMING.stopArmMs);
  // A modal list (v1 S41): the page behind inert, focus on its question, Tab kept inside, no Escape
  // (a safety list stays until it is answered), and focus back where it was when it closes.
  const modal = useModal();
  useEffect(() => {
    if (preselect) scrollPreselected(modal.ref.current, preselect);
  }, [preselect, modal.ref]);
  const group = (g: "urgent" | "other") =>
    CHECK_DATA.stopRouting.options.filter((o) => shown.has(o.id) && o.group === g);
  const row = (o: (typeof CHECK_DATA.stopRouting.options)[number]) => (
    <button
      key={o.id}
      type="button"
      className={`fx-stop-row${preselect === o.id ? " is-preselected" : ""}`}
      data-option={o.id}
      onClick={(e) => {
        if (armed(e)) onChoose(o.id);
      }}
    >
      <span className="fx-stop-row-icon" aria-hidden="true">
        <CheckIcon name={STOP_ICONS[o.id]} size={26} />
      </span>
      <span>{bidiText(lang, o.label[lang])}</span>
    </button>
  );
  return (
    <div
      ref={modal.ref}
      onKeyDown={modal.onKeyDown}
      className="fx-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title}
      data-screen="stop_list"
    >
      <Glass className="fx-card fx-stoplist">
        <p className="fx-stay-put">{bidiText(lang, t(lang, "assessment.stop.stayPut"))}</p>
        <h1 id={title} className="fx-title" tabIndex={-1}>
          {bidiText(lang, CHECK_DATA.stopRouting.ask[lang])}
        </h1>
        <p className="fx-meta">{t(lang, "assessment.stop.hint")}</p>
        <section className="fx-stop-group" aria-label={t(lang, "assessment.stop.groupUrgent")}>
          <h2 className="fx-h3">{t(lang, "assessment.stop.groupUrgent")}</h2>
          {group("urgent").map(row)}
        </section>
        <section className="fx-stop-group" aria-label={t(lang, "assessment.stop.groupOther")}>
          <h2 className="fx-h3">{t(lang, "assessment.stop.groupOther")}</h2>
          {group("other").map(row)}
        </section>
      </Glass>
    </div>
  );
}

/**
 * The X mid check (D-034 item 4: there is no red STOP): the stop and leave options. «توقّف الآن» opens
 * the stop list, which asks why (an urgent reason leads to its screen, the others rest or go on);
 * leaving ends the check here (v1 S15's question); staying goes back to it. In the lying block, the sit
 * before stand line too (rom-protocol 6 sit_before_stand: after any lying test).
 */
export function LeaveDialog({
  lang,
  lying = false,
  onStay,
  onStop,
  onLeave,
}: {
  lang: Lang;
  lying?: boolean;
  onStay(): void;
  /** «توقّف الآن»: the stop list (absent: leave and stay only). */
  onStop?: () => void;
  onLeave(): void;
}) {
  const title = useId();
  // A modal dialog (v1 CheckDialog): the page behind inert, focus on its question, Tab kept inside,
  // Escape stays in the check, focus back where it was.
  const modal = useModal(onStay);
  return (
    <div
      ref={modal.ref}
      onKeyDown={modal.onKeyDown}
      className="fx-overlay is-dim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title}
      data-screen="leave"
    >
      <Glass className="fx-card fx-dialog">
        <h1 id={title} className="fx-title" tabIndex={-1}>
          {tV7(lang, "rom.shell.stopTitle")}
        </h1>
        <Body lang={lang} text={tV7(lang, "rom.shell.stopBody")} />
        {lying && (
          <p className="fx-note">
            <CheckIcon name="info" size={20} />
            <span>{bidiText(lang, copyText("sit_before_stand", lang))}</span>
          </p>
        )}
        <div className="fx-actions is-column">
          {onStop && (
            <button type="button" className="fx-button is-stop" onClick={onStop} data-action="stop_now">
              <CheckIcon name="stop-square" size={22} />
              <span>{tV7(lang, "rom.shell.stopNow")}</span>
            </button>
          )}
          <button
            type="button"
            className="fx-button is-secondary"
            onClick={onLeave}
            data-action="leave_confirm"
          >
            <span>{tV7(lang, "rom.shell.leave")}</span>
          </button>
          <button type="button" className="fx-button is-primary" onClick={onStay} data-action="stay">
            <span>{tV7(lang, "rom.shell.stay")}</span>
          </button>
        </div>
      </Glass>
    </div>
  );
}

/* --------------------------------------------------------------- the end */

export function CompletingScreen({ lang, error, onRetry }: { lang: Lang; error: boolean; onRetry(): void }) {
  if (!error) return <Loading text={tV7(lang, "rom.shell.saving")} />;
  return (
    <Glass className="fx-card">
      <Title>{t(lang, "assessment.state.error.title")}</Title>
      <Body lang={lang} text={tV7(lang, "rom.shell.saveError")} />
      <Actions
        items={[
          { label: t(lang, "assessment.common.retry"), onClick: onRetry, name: "retry", icon: "refresh" },
        ]}
      />
    </Glass>
  );
}

export function DoneScreen({
  lang,
  measured,
  onFindings,
}: {
  lang: Lang;
  measured: { item: RomProtocolItem; value: number | null; label: string | null; lack?: boolean }[];
  onFindings(): void;
}) {
  return (
    <div className="fx-done">
      <Glass className="fx-card fx-hero">
        <span className="fx-badge is-gold" aria-hidden="true">
          <CheckIcon name="check" size={30} />
        </span>
        <Title>{tV7(lang, "rom.done.title")}</Title>
        <Body lang={lang} text={tV7(lang, "rom.done.body")} />
        <ul className="fx-done-list">
          {measured.map(({ item, value, label, lack }) => (
            <li key={`${item.movementId}:${item.side}`}>
              <span>
                <b>{movementName(item.movementId, lang)}</b>
                <small>{label ? `${sideRegion(item, lang)} · ${label}` : sideRegion(item, lang)}</small>
              </span>
              <span className="fx-done-value">
                <em dir="ltr">
                  {value === null ? "·" : `${localizeDigits(lang, String(Math.abs(value)))}°`}
                </em>
                {lack && value !== null && <small>{tV7(lang, "rom.measure.fromStraight")}</small>}
              </span>
            </li>
          ))}
        </ul>
      </Glass>
      <Actions
        items={[
          {
            label: tV7(lang, "rom.done.findings"),
            onClick: onFindings,
            name: "findings",
            icon: "arrow-forward",
          },
        ]}
      />
    </div>
  );
}

/**
 * The walk is postponed today for pain (gait-rules eligibility.today: leg, hip or back pain 6 or more,
 * a sharp pain, or a region not measured today for pain): why, then the rest of the check.
 */
export function WalkSkippedScreen({ lang, onContinue }: { lang: Lang; onContinue(): void }) {
  return (
    <Glass className="fx-card" data-walk="skipped">
      <span className="fx-badge is-violet" aria-hidden="true">
        <CheckIcon name="shield" size={28} />
      </span>
      <Title>{tV7(lang, "rom.gait.painSkipTitle")}</Title>
      <Body lang={lang} text={tV7(lang, "rom.gait.painSkipBody")} />
      <Actions
        items={[{ label: t(lang, "assessment.common.continue"), onClick: onContinue, name: "continue" }]}
      />
    </Glass>
  );
}

/** The walk's slot (C-13: between the standing and the lying blocks): C's GaitStep, and «لن أمشي اليوم». */
export function GaitSlot({
  lang,
  children,
  onSkip,
  hero = true,
  skip = true,
}: {
  lang: Lang;
  children: ReactNode;
  onSkip(): void;
  /** The walk says what of the slot shows (D-030 C4-7): the title card on its first card only. */
  hero?: boolean;
  /** And «لن أمشي اليوم» while nothing was recorded and the person is not set up to walk. */
  skip?: boolean;
}) {
  return (
    <div className="fx-gait">
      {hero && (
        <Glass className="fx-card fx-hero">
          <Kicker>{tV7(lang, "rom.shell.name")}</Kicker>
          <Title>{tV7(lang, "rom.gait.title")}</Title>
          <Body lang={lang} text={tV7(lang, "rom.gait.body")} />
        </Glass>
      )}
      {children}
      {skip && (
        <Actions
          items={[
            { label: tV7(lang, "rom.gait.skip"), onClick: onSkip, kind: "secondary", name: "skip_walk" },
          ]}
        />
      )}
    </div>
  );
}

/** The count phrase of the minutes, for tests. */
export const minutesText = (lang: Lang, n: number) => countPhrase(lang, "min", n);
