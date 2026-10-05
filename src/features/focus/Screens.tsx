/**
 * The screens of the focus check around the range blocks (product v7 contract B3): loading, closed,
 * the consent, the intro, the v1 pre-check questions and the day questions (rf_region), the start,
 * the safety screens (an emergency or a postpone answer, the seek care screen of a red flag region,
 * a stop list answer with a screen), the stop list, the walk's slot, saving and the end.
 *
 * The clinical words are the data's: the v1 pre-check (questionView), the v1 safety screens
 * (screenText), the stop list (check-v1 stopRouting), the range copy (rom-v7.json), rf_region
 * (rom.rf_region_ask). The interface words are the rom namespace's (src/i18n/{ar,en}/rom.json) and
 * the v1 check's common words.
 */
import { useId, useState, type ReactNode } from "react";
import type { Lang } from "../../app/i18n";
import { countPhrase, interpolate, localizeDigits, t } from "../../i18n";
import { bidiText } from "../../i18n/rich";
import { tV7 } from "../../i18n/v7";
import type { AnswerValue, PrecheckEnv, Answers } from "../../medical/precheck";
import { stopOptions } from "../../medical/precheck";
import { REGION_IDS, type BodyMapKey, type RegionId } from "../../medical/body-map";
import type { RomProtocol, RomProtocolItem } from "../../medical/rom-protocol";
import type { BodyMapColour } from "../../medical/rom-types";
import type { RomSide } from "../../movements/rom/types";
import type { GaitPlan } from "../../medical/gait-eligibility";
import { CHECK_DATA, emergencyCallButton, screenText, stopFollowUp } from "../../movements/assessments";
import { GAIT_DATA } from "../../movements/gait";
import { ROM_DATA } from "../../movements/rom";
import type { ScreenId, StopOptionId } from "../../movements/types";
import type { CoachStopReason } from "../../coach/types";
import { questionView, splitSentences } from "../assessment/flow/copy";
import { AreaPicker } from "../assessment/flow/parts";
import { MultiAnswerList } from "../assessment/shared/answers";
import CheckIcon from "../assessment/shared/CheckIcon";
import { AnswerZones, BigNumber, SafetyHeading, type ZoneOption } from "../assessment/safety/parts";
import { pausedLine, whenText } from "../assessment/safety/content";
import type { LockView } from "../assessment/api";
import { BodyMap } from "../body-map/BodyMap";
import { copyText, movementName, regionName } from "./copy";
import { checkParts, type ClosedWhy, type TodayQuestion } from "./flow";
import { MovementPicture } from "./MovementPicture";
import { Actions, Body, Choices, Glass, Kicker, Loading, PainScale, Title } from "./parts";

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
      [title, body, icon] = [
        v("soonTitle"),
        until
          ? interpolate(lang, tV7(lang, "rom.closed.soonBody"), { when: whenText(until, now, lang) })
          : "",
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

/** The focus_check consent (C-8): what is kept, where, and the way out. The words are A's (rom.consent). */
export function ConsentScreen({
  lang,
  saving,
  error,
  onAgree,
  onLater,
}: {
  lang: Lang;
  saving: boolean;
  error: boolean;
  onAgree(): void;
  onLater(): void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const c = (k: string) => tV7(lang, `rom.consent.${k}` as never);
  const box = useId();
  return (
    <Glass className="fx-card fx-consent">
      <span className="fx-badge is-violet" aria-hidden="true">
        <CheckIcon name="shield" size={28} />
      </span>
      <Title>{c("title")}</Title>
      <Body lang={lang} text={c("body")} />
      <ul className="fx-points">
        {["pointKept", "pointProfile", "pointVideo", "pointWhere", "pointWithdraw"].map((k) => (
          <li key={k}>
            <CheckIcon name="check" size={20} />
            <span>{bidiText(lang, c(k))}</span>
          </li>
        ))}
      </ul>
      <a className="fx-link" href="/privacy" target="_blank" rel="noreferrer">
        {c("privacyLink")}
      </a>
      <label className={`fx-agree${tried && !agreed ? " is-missing" : ""}`} htmlFor={box}>
        <input id={box} type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{bidiText(lang, c("agree"))}</span>
      </label>
      {tried && !agreed && <p className="fx-hint">{t(lang, "assessment.common.chooseToContinue")}</p>}
      {error && <p className="fx-hint">{t(lang, "assessment.state.error.body")}</p>}
      <Actions
        items={[
          { label: c("notNow"), onClick: onLater, kind: "secondary", name: "later" },
          {
            label: c("continue"),
            busy: saving,
            name: "agree",
            onClick: () => (agreed ? onAgree() : setTried(true)),
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

/** A joint of the day: a region and a side, with its movements in protocol order. */
export interface JointGroup {
  key: string;
  region: RegionId;
  side: RomSide;
  items: RomProtocolItem[];
}

/** The joints of the day's movements in body order (the region list, the right side first). */
export function jointsOf(items: readonly RomProtocolItem[]): JointGroup[] {
  const groups = new Map<string, JointGroup>();
  for (const i of items) {
    const key = `${i.region}:${i.side}`;
    const g = groups.get(key) ?? { key, region: i.region, side: i.side, items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const rank = { right: 0, left: 1, none: 2 } as const;
  return [...groups.values()].sort(
    (a, b) => REGION_IDS.indexOf(a.region) - REGION_IDS.indexOf(b.region) || rank[a.side] - rank[b.side],
  );
}

/** The body map cell of a joint (the neck and the back have one, axial). */
export const cellOf = (g: Pick<JointGroup, "region" | "side">): BodyMapKey =>
  (g.side === "none" ? `${g.region}:axial` : `${g.region}:${g.side}`) as BodyMapKey;

/**
 * Which joints we will measure, and why (plan 1.7): the affected joints of the history, each with its
 * movements, marked on the body map the person filled in; the order of the parts (sit, stand, walk,
 * lie down), so the chair, the space and the bed are ready; the minutes; safety; start.
 */
export function IntroScreen({
  lang,
  protocol,
  gait,
  onStart,
}: {
  lang: Lang;
  protocol: RomProtocol;
  gait: GaitPlan | null;
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
        <p className="fx-meta">
          <CheckIcon name="clock" size={20} />
          <span>
            {interpolate(lang, tV7(lang, "rom.intro.minutes"), { n: minutesOf(runs), unit: "min" })}
          </span>
        </p>
      </Glass>
      <Glass className="fx-card fx-joints">
        <h2 className="fx-h2">{tV7(lang, "rom.intro.joints")}</h2>
        <div className="fx-joints-body">
          <ul className="fx-joint-cards">
            {joints.map((g) => (
              <li key={g.key} className="fx-joint-card">
                <span className="fx-joint-picture" aria-hidden="true">
                  <MovementPicture movementId={g.items[0].movementId} side={g.side} lang={lang} size={52} />
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
      </Glass>
      <Actions
        items={[{ label: tV7(lang, "rom.intro.start"), onClick: onStart, name: "start", icon: "play" }]}
      />
    </div>
  );
}

/** «الركبة اليمنى» · "Right knee": the region and the side, as the person sees them. */
export function sideRegion(i: Pick<RomProtocolItem, "region" | "side">, lang: Lang): string {
  const region = regionName(i.region, lang);
  if (i.side === "none") return region;
  const w = ROM_DATA.sideWords;
  if (lang === "en")
    return `${w.side[i.side][0].toUpperCase()}${w.side[i.side].slice(1)} ${regionName(i.region, lang, true)}`;
  // The region's own gender decides the side word («الركبة اليمنى», «الكتف الأيمن»).
  const feminine = FEMININE_REGIONS.has(i.region);
  return `${region} ${feminine ? w.sideF[i.side] : w.sideM[i.side]}`;
}
/** Arabic regions with feminine names: الركبة, الرقبة (the others take the masculine side word). */
const FEMININE_REGIONS = new Set(["knee", "neck"]);

/* ---------------------------------------------------------- the questions */

/** One v1 pre-check question (C-2): the data's text in the form questionForm chooses. */
export function QuestionScreen({
  lang,
  env,
  answers,
  id,
  onAnswer,
}: {
  lang: Lang;
  env: PrecheckEnv;
  answers: Answers;
  id: string;
  onAnswer(value: AnswerValue): void;
}) {
  const view = questionView(env, answers, id, lang);
  const title = useId();
  let control: ReactNode;
  if (view.kind === "scale")
    control = (
      <PainScale
        lang={lang}
        labelledBy={title}
        nextLabel={t(lang, "assessment.common.next")}
        onDone={onAnswer}
      />
    );
  else if (view.kind === "areaChips")
    control = <AreaChips lang={lang} labelledBy={title} areas={view.areas ?? []} onDone={onAnswer} />;
  else if (view.kind === "areaScale")
    control = <AreaScale lang={lang} labelledBy={title} areas={view.areas ?? []} onDone={onAnswer} />;
  else
    control = (
      <Choices
        lang={lang}
        labelledBy={title}
        choices={view.options.map((o) => ({ value: o.value, label: o.label }))}
        onPick={onAnswer}
      />
    );
  return (
    <Glass className="fx-card fx-question" data-question={id}>
      <Kicker>{view.groupHeading ?? tV7(lang, "rom.precheck.kicker")}</Kicker>
      <h1
        id={title}
        className={`fx-title is-question${view.question.length > 110 ? " is-long" : ""}`}
        tabIndex={-1}
      >
        {bidiText(lang, view.question)}
      </h1>
      {view.list && (
        <div className="fx-list">
          {view.listHeading && <p className="fx-list-heading">{bidiText(lang, view.listHeading)}</p>}
          <ul>
            {view.list.map((l, i) => (
              <li key={i}>{bidiText(lang, l)}</li>
            ))}
          </ul>
        </div>
      )}
      {control}
    </Glass>
  );
}

function AreaChips({
  lang,
  labelledBy,
  areas,
  onDone,
}: {
  lang: Lang;
  labelledBy: string;
  areas: { id: string; label: string }[];
  onDone(v: string[]): void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  return (
    <div className="fx-v1">
      {tried && !chosen.length && <p className="fx-hint">{t(lang, "assessment.precheck.areas.pickOne")}</p>}
      <MultiAnswerList
        labelledBy={labelledBy}
        options={areas.map((a) => ({ value: a.id, label: a.label }))}
        value={chosen}
        onChange={setChosen}
      />
      <Actions
        items={[
          {
            label: t(lang, "assessment.common.next"),
            name: "next",
            onClick: () => (chosen.length ? onDone(chosen) : setTried(true)),
          },
        ]}
      />
    </div>
  );
}

function AreaScale({
  lang,
  labelledBy,
  areas,
  onDone,
}: {
  lang: Lang;
  labelledBy: string;
  areas: { id: string; label: string }[];
  onDone(v: Record<string, number>): void;
}) {
  const [value, setValue] = useState<Record<string, number | null>>({});
  const [none, setNone] = useState(false);
  const [tried, setTried] = useState(false);
  const complete = none || (Object.keys(value).length > 0 && Object.values(value).every((v) => v !== null));
  return (
    <div className="fx-v1">
      <p className="fx-meta">{t(lang, "assessment.precheck.areas.hint")}</p>
      {tried && !complete && <p className="fx-hint">{t(lang, "assessment.common.chooseToContinue")}</p>}
      <AreaPicker
        labelledBy={labelledBy}
        areas={areas}
        value={none ? {} : value}
        scale
        noneLabel={t(lang, "assessment.precheck.areas.none")}
        none={none}
        onNone={() => {
          setNone(true);
          setValue({});
        }}
        onChange={(v) => {
          setNone(false);
          setValue(v);
        }}
      />
      <Actions
        items={[
          {
            label: t(lang, "assessment.common.next"),
            name: "next",
            onClick: () =>
              complete ? onDone(none ? {} : (value as Record<string, number>)) : setTried(true),
          },
        ]}
      />
    </div>
  );
}

/** A day question (2.5): the pain now of a region, rf_region, the transfer, the walk's two items. */
export function TodayScreen({
  lang,
  q,
  onAnswer,
}: {
  lang: Lang;
  q: TodayQuestion;
  onAnswer(v: number | boolean): void;
}) {
  const title = useId();
  const yesNo = (
    <Choices
      lang={lang}
      labelledBy={title}
      layout="row"
      choices={[
        { value: "yes", label: copyText("ans_yes", lang) },
        { value: "no", label: copyText("ans_no", lang) },
      ]}
      onPick={(v) => onAnswer(v === "yes")}
    />
  );
  let kicker = "";
  let question = "";
  let control: ReactNode = yesNo;
  switch (q.kind) {
    case "pain":
      kicker = regionName(q.region, lang);
      question = copyText("pain_ask", lang);
      control = (
        <PainScale
          lang={lang}
          labelledBy={title}
          nextLabel={t(lang, "assessment.common.next")}
          onDone={onAnswer}
        />
      );
      break;
    case "rf": {
      // The question names the region in its lead («في الركبة اليوم:»): no kicker.
      const leg = ["hip", "knee", "ankle_foot"].includes(q.region);
      question = tV7(lang, leg ? "rom.rf_region_ask_leg" : "rom.rf_region_ask", {
        region: regionName(q.region, lang, true),
      });
      break;
    }
    case "transfer":
      question = copyText("transfer_chair_ask", lang);
      break;
    case "walk10m":
      kicker = tV7(lang, "rom.gait.title");
      question = GAIT_DATA.copy.setup.pc_walk_10m[lang];
      break;
    case "pdFreezing":
      kicker = tV7(lang, "rom.gait.title");
      question = GAIT_DATA.copy.setup.pc_pd_freezing[lang];
      break;
  }
  return (
    <Glass className="fx-card fx-question" data-today={q.kind}>
      {kicker && <Kicker>{kicker}</Kicker>}
      <QuestionText lang={lang} id={title} text={question} lead={q.kind === "rf"} />
      {control}
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
}: {
  lang: Lang;
  id: string;
  text: string;
  lead?: boolean;
  as?: "h1" | "h2";
}) {
  const H = as;
  const colon = lead ? text.indexOf(":") : -1;
  if (colon > 0) {
    const place = text.slice(0, colon + 1);
    const rest = text.slice(colon + 1).trim();
    return (
      <H id={id} className={`fx-title is-question${rest.length > 90 ? " is-long" : ""}`} tabIndex={-1}>
        <span className="fx-q-lead">{bidiText(lang, place)}</span> {bidiText(lang, rest)}
      </H>
    );
  }
  const [first = text, ...more] = splitSentences(text);
  return (
    <>
      <H id={id} className={`fx-title is-question${first.length > 110 ? " is-long" : ""}`} tabIndex={-1}>
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
  const options: ZoneOption[] = q.options.map((o) => ({
    value: o.value as string,
    label: o.label[lang],
    icon: o.value === "yes" ? "check" : o.value === "no" ? "close" : "help",
    commitAtOnce: true,
  }));
  const intro = back ? (splitSentences(localizeDigits(lang, screenText(back, lang)))[0] ?? "") : "";
  return (
    <Glass className="fx-card fx-question fx-faint" tone="rose">
      <h1 id={title} className="fx-title is-question" tabIndex={-1}>
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
 * The stop list (S41, Q31): the data's options for this person, symptoms and falls first, one tap each
 * (no Next, no «pressed by mistake» row, O43). The coach's reason is preselected and highlighted; the
 * person confirms it with the tap (C-7).
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
  const group = (g: "urgent" | "other") =>
    CHECK_DATA.stopRouting.options.filter((o) => shown.has(o.id) && o.group === g);
  const row = (o: (typeof CHECK_DATA.stopRouting.options)[number]) => (
    <button
      key={o.id}
      type="button"
      className={`fx-stop-row${preselect === o.id ? " is-preselected" : ""}`}
      data-option={o.id}
      onClick={() => onChoose(o.id)}
    >
      <span className="fx-stop-row-icon" aria-hidden="true">
        <CheckIcon name={STOP_ICONS[o.id]} size={26} />
      </span>
      <span>{bidiText(lang, o.label[lang])}</span>
    </button>
  );
  return (
    <div
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
 * Leaving mid check: what is kept, stay or leave (v1 S15's question). In the lying block, the sit
 * before stand line too (rom-protocol 6 sit_before_stand: after any lying test).
 */
export function LeaveDialog({
  lang,
  lying = false,
  onStay,
  onLeave,
}: {
  lang: Lang;
  lying?: boolean;
  onStay(): void;
  onLeave(): void;
}) {
  const title = useId();
  return (
    <div
      className="fx-overlay is-dim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title}
      data-screen="leave"
    >
      <Glass className="fx-card fx-dialog">
        <h1 id={title} className="fx-title" tabIndex={-1}>
          {tV7(lang, "rom.shell.leaveTitle")}
        </h1>
        <Body lang={lang} text={tV7(lang, "rom.shell.leaveBody")} />
        {lying && (
          <p className="fx-note">
            <CheckIcon name="info" size={20} />
            <span>{bidiText(lang, copyText("sit_before_stand", lang))}</span>
          </p>
        )}
        <Actions
          items={[
            {
              label: tV7(lang, "rom.shell.leaveConfirm"),
              onClick: onLeave,
              kind: "secondary",
              name: "leave_confirm",
            },
            { label: tV7(lang, "rom.shell.stay"), onClick: onStay, name: "stay" },
          ]}
        />
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

/** The walk's slot (C-13: between the standing and the lying blocks): C's GaitStep, and «لن أمشي اليوم». */
export function GaitSlot({ lang, children, onSkip }: { lang: Lang; children: ReactNode; onSkip(): void }) {
  return (
    <div className="fx-gait">
      <Glass className="fx-card fx-hero">
        <Kicker>{tV7(lang, "rom.shell.name")}</Kicker>
        <Title>{tV7(lang, "rom.gait.title")}</Title>
        <Body lang={lang} text={tV7(lang, "rom.gait.body")} />
      </Glass>
      {children}
      <Actions
        items={[{ label: tV7(lang, "rom.gait.skip"), onClick: onSkip, kind: "secondary", name: "skip_walk" }]}
      />
    </div>
  );
}

/** The count phrase of the minutes, for tests. */
export const minutesText = (lang: Lang, n: number) => countPhrase(lang, "min", n);
