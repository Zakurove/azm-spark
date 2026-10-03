/**
 * Step 6 (contract C8): the program. The rules' week shows at once (engineWeekly on the phone);
 * POST /api/booth/plan asks for the weekly plan the Azm AI engine arranges on the same rules, and
 * when it answers, its week takes the place of the rules' one. Then the sport path card ("Your path
 * to wheelchair basketball") and a code to register on the visitor's own phone. Nothing is stored.
 */
import { useEffect, useMemo, useState } from "react";
import type { Lang } from "../../app/i18n";
import { fmtDate } from "../../app/i18n";
import SportPath from "../../app/SportPath";
import { reasonText } from "../../app/platform-copy";
import type { Intake, Plan } from "../../medical/plan";
import { engineWeekly, type WeeklyPlan } from "../../medical/weekly";
import { QrCode } from "../assessment/shared/QrCode";
import { fetchPlan } from "./api";
import BoothIcon from "./BoothIcon";
import { boothCopy } from "./copy";
import type { Door } from "./journey";
import { Actions, StepHead, stepKicker } from "./parts";
import { cameraWeek } from "./views";

/** The AI week replaces the rules' week only if it arrives within this long. */
const AI_WAIT_MS = 30_000;

const weekday = (day: number, lang: Lang) => fmtDate(new Date(2026, 8, 6 + day), lang, { weekday: "long" });

/** The register link on the visitor's own phone (the account page on its register tab). */
export function registerUrl(lang: Lang, origin = location.origin): string {
  return `${origin}/?app=1&register=1${lang === "en" ? "&lang=en" : ""}`;
}

export function ProgramStep({
  lang,
  door,
  session,
  intake,
  plan: localPlan,
  onBack,
  onReset,
}: {
  lang: Lang;
  door: Door;
  session: string;
  intake: Intake;
  plan: Plan;
  onBack(): void;
  onReset(): void;
}) {
  const k = boothCopy(lang);
  const rules = useMemo(() => engineWeekly(intake, localPlan), [intake, localPlan]);
  const [weekly, setWeekly] = useState<WeeklyPlan | null>(rules);
  const [waiting, setWaiting] = useState(localPlan.status === "ready");

  useEffect(() => {
    if (localPlan.status !== "ready") return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), AI_WAIT_MS);
    void fetchPlan(session, intake, ctl.signal).then((r) => {
      if (ctl.signal.aborted && !r.ok) return setWaiting(false);
      if (r.ok && r.value.plan.status === "ready" && r.value.weekly?.days.length) setWeekly(r.value.weekly);
      setWaiting(false);
    });
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [session, intake, localPlan]);

  const title = door === "story" ? k.programTitleStory : k.programTitleSelf;
  const review = localPlan.status === "review";
  const days = cameraWeek(localPlan, weekly, lang);
  return (
    <div
      className="bx-program"
      data-screen="program"
      data-status={localPlan.status}
      data-source={weekly?.source}
    >
      <StepHead kicker={stepKicker(lang, 5)} title={title} />
      <div className="bx-program-grid">
        <div className="bx-program-main">
          {review ? (
            <section className="bx-review" role="status">
              <span className="bx-review-icon">
                <BoothIcon name="shield" size={30} />
              </span>
              <h2>{k.reviewTitle}</h2>
              <ul>
                {localPlan.reasons.map((r) => (
                  <li key={r}>{reasonText[r]?.[lang] ?? r}</li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="bx-week" aria-label={title}>
              <p className={`bx-source${waiting ? " waiting" : ""}`} role="status">
                <BoothIcon
                  name={waiting ? "spark" : weekly?.source === "ai" ? "spark" : "shield"}
                  size={17}
                />
                {waiting ? k.writing : weekly?.source === "ai" ? k.sourceAi : k.sourceEngine}
              </p>
              <p className="bx-every">
                {k.everySession}
                {days[0]?.camera.map((c) => (
                  <span key={c}>
                    <BoothIcon name="camera" size={14} />
                    {c}
                  </span>
                ))}
              </p>
              <ol className="bx-days">
                {days.map((d, i) => (
                  <li key={d.day} className="bx-day" style={{ ["--i" as string]: i }}>
                    <span className="bx-day-name">
                      <BoothIcon name="calendar" size={18} />
                      {weekday(d.day, lang)}
                    </span>
                    <b className="bx-day-focus">{d.focus}</b>
                    <span className="bx-day-items">
                      {d.extra.map((x) => (
                        <span key={x}>{x}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <Register lang={lang} review={review} where="flow" />
        </div>
        {!review && intake.goal === "sport" && intake.sport && (
          <div className="bx-program-side">
            <SportPath lang={lang} sport={intake.sport} plan={localPlan} weekly={weekly} />
          </div>
        )}
      </div>
      <Actions
        lang={lang}
        onBack={onBack}
        center={<Register lang={lang} review={review} where="dock" />}
        primary={{ label: k.startAgain, onClick: onReset, icon: "reset", name: "start-again" }}
      />
    </div>
  );
}

/**
 * The code to register on the visitor's own phone. Docked beside "Start again" on a tablet or a
 * computer, so it is always in view; in the page on a phone.
 */
function Register({ lang, review, where }: { lang: Lang; review: boolean; where: "flow" | "dock" }) {
  const k = boothCopy(lang);
  return (
    <section className={`bx-register ${where}`} aria-label={k.registerTitle} data-register={where}>
      <QrCode text={registerUrl(lang)} label={k.registerAlt} size={where === "dock" ? 88 : 112} showText />
      <div>
        <h2>{k.registerTitle}</h2>
        <p>{review ? k.reviewProgram : k.registerBody}</p>
      </div>
    </section>
  );
}
