/**
 * The entry screens of the flow:
 *   S04   Use a phone for the check (desktop interstitial, O10)
 *   S05   Guest welcome at the booth (two paths, Q19 (7)), with the adult line above the starts (C02)
 *   S05a  Adult confirmation of a signed in account without one (Q32 (6)) and the adult end card
 *   S09   Talk to our team (Q19 (5a))
 */
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { bidiText, tx } from "../../../i18n/rich";
import { CHECK_DATA, screenText } from "../../../movements/assessments";
import { backTarget, testsOff } from "../flowMachine";
import type { ScreenProps } from "../screenTypes";
import { AnswerButtons } from "../shared/answers";
import { CheckShell } from "../shared/CheckShell";
import CheckIcon from "../shared/CheckIcon";
import { useCheckUi } from "../shared/CheckUi";
import { guestMinutes, localLabels } from "./copy";
import { QrCode, SamePress } from "./parts";
import { unlockAudio } from "./voice";
import { TokenEndedCard, useBoothMode } from "../booth";

/* ------------------------------------------------------------------ S04 */

/**
 * Whether this device reports an orientation sensor reading (O10): only then may it run camera tests,
 * so only then does S04 offer "Continue on this device". Laptops and desktops usually have none.
 * E2E builds may force it with ?e2eOrientation=1.
 */
export function useOrientationSensor(): boolean {
  const [seen, setSeen] = useState(() => {
    if (import.meta.env.VITE_E2E !== "1" || typeof location === "undefined") return false;
    return new URLSearchParams(location.search).get("e2eOrientation") === "1";
  });
  useEffect(() => {
    if (seen || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta !== null || e.gamma !== null) setSeen(true);
    };
    window.addEventListener("deviceorientation", on);
    return () => window.removeEventListener("deviceorientation", on);
  }, [seen]);
  return seen;
}

/** The link the S04 code opens: the site root signed in (they find S01 on Today), the guest check otherwise. */
export function desktopLink(origin: string, guest: boolean): string {
  return `${origin}${guest ? "/?check=1" : "/"}`;
}

export function DesktopGate({ dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const sensor = useOrientationSensor();
  const origin = typeof location === "undefined" ? "" : location.origin;
  const host = typeof location === "undefined" ? "" : location.host;
  const link = desktopLink(origin, guest);
  const short = `${host}${guest ? "/?check=1" : ""}`;
  return (
    <CheckShell
      footer={
        sensor
          ? {
              primary: {
                label: t(lang, "assessment.desktop.continue"),
                onClick: () => dispatch({ type: "CONTINUE" }),
              },
            }
          : undefined
      }
    >
      <div className="flow-desktop" data-screen="S04">
        <div className="flow-desktop-text">
          <h1>{t(lang, "assessment.desktop.title")}</h1>
          <p className="check-body">{tx(lang, "assessment.desktop.body", { metersFrom: 2, metersTo: 3 })}</p>
          <p className="flow-url">
            {t(lang, "assessment.desktop.orOpen", { url: "\u0000" })
              .split("\u0000")
              .map((part, i, all) => (
                <span key={i}>
                  {bidiText(lang, part)}
                  {i < all.length - 1 && (
                    <bdi lang="en" dir="ltr" className="flow-url-link">
                      {short}
                    </bdi>
                  )}
                </span>
              ))}
          </p>
        </div>
        <QrCode text={link} alt={t(lang, "assessment.desktop.qrAlt")} />
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S05 */

export function GuestWelcome({ dispatch, model }: ScreenProps) {
  const { lang, online } = useCheckUi();
  // S55b: a visitor token that ended while this screen showed: booth.tokenEnded in place of the start.
  const { tokenEnded } = useBoothMode();
  // F-2: the one test path first, the full check after it, each with the minutes of what runs at this
  // booth; a path with no test switched on is not offered (D-016 item 4, F-1 D). C03: gold is the one
  // test, the staff default; the full check stays visible as an outline button of the same size.
  const minutes = guestMinutes(testsOff(model.data));
  // The start tap unlocks audio (4.6): the booth has no intro or sound check to do it (C04, C05).
  const start = (path: "quick" | "full") => () => {
    unlockAudio();
    dispatch({ type: "GUEST_PATH", path });
  };
  const quick =
    minutes.quick === null
      ? undefined
      : {
          label: t(lang, "assessment.guest.quickTry", { minutes: minutes.quick, unit: "min" }),
          onClick: start("quick"),
        };
  const full =
    minutes.full === null
      ? undefined
      : {
          label: t(lang, "assessment.guest.fullCheck", {
            minutesFrom: minutes.full[0],
            minutesTo: minutes.full[1],
            unit: "min",
          }),
          onClick: start("full"),
        };
  const primary = quick ?? full;
  const secondary = quick && full ? full : undefined;
  // C02: the adult line sits directly above the start buttons, so a start is the confirmation.
  const adult = (
    <p className="check-body flow-adult-line">{bidiText(lang, CHECK_DATA.boundary.adultConfirm[lang])}</p>
  );
  return (
    <CheckShell
      brand
      language
      footer={
        tokenEnded || !primary ? undefined : { lead: adult, primary, ...(secondary ? { secondary } : {}) }
      }
    >
      <div className="flow-stack" data-screen="S05">
        <h1>{t(lang, "assessment.guest.title")}</h1>
        <p className="check-body">{t(lang, "assessment.guest.notSaved")}</p>
        <p className="check-label">{bidiText(lang, CHECK_DATA.boundary.notMedical[lang])}</p>
        {!online && <p className="check-field-error">{t(lang, "assessment.guest.offlineNoModel")}</p>}
        {tokenEnded && <TokenEndedCard onContinue={() => dispatch({ type: "EXIT" })} />}
        <button
          type="button"
          className="check-text-button flow-example-link"
          onClick={() => dispatch({ type: "EXAMPLE" })}
        >
          {t(lang, "assessment.guest.seeExample")}
        </button>
        <button
          type="button"
          className="check-text-button"
          data-adult="under"
          onClick={() => dispatch({ type: "ADULT_NO" })}
        >
          {t(lang, "assessment.adult.under", { age: ADULT_AGE })}
        </button>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S05a */

export const ADULT_AGE = 18;

export function AdultGate({ model, dispatch }: ScreenProps) {
  const { lang, guest } = useCheckUi();
  const ended = model.state.kind === "adultEnd";
  const back = backTarget(model) ? () => dispatch({ type: "BACK" }) : undefined;
  if (ended)
    return (
      <CheckShell
        exit={false}
        footer={{
          primary: guest
            ? {
                label: t(lang, "assessment.guest.staff.restart"),
                onClick: () => dispatch({ type: "RESTART" }),
              }
            : { label: t(lang, "assessment.common.backToToday"), onClick: () => dispatch({ type: "EXIT" }) },
        }}
      >
        <section className="check-card is-cream" role="status" data-screen="S05a" data-variant="end">
          <span className="check-card-icon">
            <CheckIcon name="info" />
          </span>
          <h1 className="check-h2">{t(lang, "assessment.adult.title")}</h1>
          <p className="check-body">{tx(lang, "assessment.adult.body", { age: ADULT_AGE })}</p>
        </section>
      </CheckShell>
    );
  const options = [
    { value: "yes", label: CHECK_DATA.boundary.adultConfirm[lang] },
    { value: "no", label: t(lang, "assessment.adult.under", { age: ADULT_AGE }) },
  ];
  return (
    <CheckShell onBack={back}>
      <div className="flow-stack" data-screen="S05a">
        <h1 id="flow-adult-title">{t(lang, "assessment.adult.title")}</h1>
        <SamePress>
          <AnswerButtons
            labelledBy="flow-adult-title"
            options={localLabels(lang, options)}
            value={null}
            onSubmit={(v) => dispatch({ type: v === "yes" ? "ADULT_YES" : "ADULT_NO" })}
          />
        </SamePress>
      </div>
    </CheckShell>
  );
}

/* ------------------------------------------------------------------ S09 */

export function TalkToStaff({ model, dispatch }: ScreenProps) {
  const { lang } = useCheckUi();
  const booth = model.data.config.booth;
  return (
    <CheckShell
      footer={{
        primary: {
          label: t(lang, "assessment.guest.staff.restart"),
          onClick: () => dispatch({ type: "RESTART" }),
        },
      }}
    >
      <section className="check-card is-cream" role="status" data-screen="S09">
        <span className="check-card-icon">
          <CheckIcon name="info" />
        </span>
        <h1 className="check-h2">
          {t(lang, booth ? "assessment.guest.staff.titleBooth" : "assessment.guest.staff.titleHome")}
        </h1>
        <p className="check-body">
          {booth
            ? bidiText(lang, screenText("scr_booth_no_check", lang))
            : t(lang, "assessment.guest.staff.bodyHome")}
        </p>
      </section>
    </CheckShell>
  );
}
