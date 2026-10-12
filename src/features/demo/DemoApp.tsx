/**
 * The booth demo (Nasser at the KSCDR booth): azm-spark.gymwise.ai/demo opens with no registration
 * and no form to fill. On load it signs in a demo person (POST /api/demo/start: a fresh account on the
 * reserved demo domain with the adult confirmation, the consents and a filled v7 health form, see
 * server/modules/demo), or keeps the demo person this browser already holds, then shows the demo
 * home: four large cards, phone first, Arabic first and right to left, in the light Azm family of the
 * focus check.
 *   - Full journey: the real v7 flow from the health form (filled, editable), then the range, the walk,
 *     the program's build and the program; a demo person who already finished it is replaced first.
 *   - Range of motion: a movement picker (the common ones first), then the range test page's own
 *     measuring screens (RomLab's LabRun in its demo mode: camera, skeleton and meter, nothing saved).
 *   - Walk: the walk's own screens (GaitStep in its demo mode: part 1 side passes, part 2 toward the
 *     phone and back; the result read on the phone, nothing posted).
 *   - Exercises: the demo exercises (the shoulder press and the others, with the Live coach, unsaved).
 * «زائر جديد» signs the demo person out and signs a fresh one in, so each visitor starts clean. Every
 * part's close and end come back to the demo home. src/app/App.tsx opens it at /demo, VITE_V7=1
 * builds only; on a VITE_E2E=1 build the parts read their e2e options from the query string as the
 * labs do (?e2ePerson=1, ?e2eGait=1).
 */
import { lazy, useEffect, useState } from "react";
import { APP_VERSION } from "../../app/version";
import type { Lang } from "../../app/i18n";
import { api, type AccountState } from "../../app/api";
import { isDemoEmail } from "../../app/demoAccount";
import { readPreferences, savePreferences, type Preferences } from "../../app/experience";
import { LazyPage } from "../../app/LazyPage";
import { CheckRoot } from "../assessment/shared/CheckRoot";
import CheckIcon from "../assessment/shared/CheckIcon";
import { Actions, Glass, Kicker, Loading, Page, Title, TopBar } from "../focus/parts";
import type { FocusExit } from "../focus/FocusApp";
import type { ProgramExit } from "../program-v7/ProgramPage";
import { demoCopy } from "./copy";
import "../focus/focus.css";
import "./demo.css";

const IntakeForm = lazy(() => import("../../app/IntakeForm"));
const FocusApp = lazy(() => import("../focus/FocusApp"));
const ProgramPage = lazy(() => import("../program-v7/ProgramPage"));
const DemoExercises = lazy(() => import("../program-v7/DemoExercises"));
const DemoRange = lazy(() => import("./DemoRange"));
const DemoWalk = lazy(() => import("./DemoWalk"));

/** The four parts of the demo, in the order of the home. */
export const DEMO_PARTS = ["journey", "range", "walk", "exercises"] as const;
export type DemoPart = (typeof DEMO_PARTS)[number];

const PICTURES: Record<DemoPart, string> = {
  journey: "/illustrations/v7/landing/v7_landing_coach_600.webp",
  range: "/illustrations/v7/rom/v7_rom_shoulder_flexion_600.webp",
  walk: "/illustrations/v7/walk/v7_walk_side_path_600.webp",
  exercises: "/illustrations/landing/chair-press.webp",
};

type JourneyStep = "form" | "check" | "program" | "demos";
type View =
  { kind: "home" } | { kind: "journey"; step: JourneyStep } | { kind: Exclude<DemoPart, "journey"> };

type Person =
  { status: "starting" } | { status: "ready"; account: AccountState } | { status: "error"; code: string };

/** The demo person: the one this browser holds, or a fresh one (fresh: always a new one). */
async function demoPerson(fresh: boolean): Promise<AccountState> {
  if (!fresh) {
    const me = await api<AccountState>("/auth/me").catch(() => null);
    if (me && isDemoEmail(me.user.email)) return me;
  }
  return api<AccountState>("/demo/start", {});
}

export interface DemoAppProps {
  lang: Lang;
  onLanguage(): void;
}

export default function DemoApp({ lang, onLanguage }: DemoAppProps) {
  const [person, setPerson] = useState<Person>({ status: "starting" });
  const [view, setView] = useState<View>({ kind: "home" });
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const onPreferences = (p: Preferences) => {
    setPreferences(p);
    savePreferences(p);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  /** Signs a demo person in; resolves to the account, or null when it could not. */
  const begin = async (fresh: boolean): Promise<AccountState | null> => {
    setPerson({ status: "starting" });
    try {
      const account = await demoPerson(fresh);
      setPerson({ status: "ready", account });
      return account;
    } catch (e) {
      setPerson({ status: "error", code: (e as Error).message });
      return null;
    }
  };
  useEffect(() => {
    void begin(false);
  }, []);

  const home = () => setView({ kind: "home" });
  const newVisitor = () => {
    home();
    void begin(true);
  };
  const open = async (part: DemoPart) => {
    if (person.status !== "ready") return;
    if (part !== "journey") return setView({ kind: part });
    // The journey shows the build and the program once per person: a person who finished it is replaced.
    const account = person.account.awaitingCheck === true ? person.account : await begin(true);
    if (account) setView({ kind: "journey", step: "form" });
  };

  if (person.status !== "ready")
    return (
      <DemoStatus lang={lang} onLanguage={onLanguage} person={person} onRetry={() => void begin(true)} />
    );
  const account = person.account;
  const setAccount = (next: Partial<AccountState>) =>
    setPerson({ status: "ready", account: { ...account, ...next } });

  if (view.kind === "range")
    return (
      <LazyPage lang={lang}>
        <DemoRange lang={lang} onLanguage={onLanguage} onClose={home} />
      </LazyPage>
    );
  if (view.kind === "walk")
    return (
      <LazyPage lang={lang}>
        <DemoWalk lang={lang} onLanguage={onLanguage} onClose={home} />
      </LazyPage>
    );
  if (view.kind === "exercises")
    return (
      <LazyPage lang={lang}>
        <DemoExercises
          lang={lang}
          onLanguage={onLanguage}
          preferences={preferences}
          onPreferences={onPreferences}
          onBack={home}
        />
      </LazyPage>
    );
  if (view.kind === "journey") {
    const step = (s: JourneyStep) => setView({ kind: "journey", step: s });
    if (view.step === "form")
      return (
        <LazyPage lang={lang}>
          <JourneyForm
            lang={lang}
            onLanguage={onLanguage}
            account={account}
            onClose={home}
            onSaved={(saved) => {
              setAccount(saved);
              step("check");
            }}
          />
        </LazyPage>
      );
    if (view.step === "check")
      return (
        <LazyPage lang={lang}>
          <FocusApp
            lang={lang}
            onLanguage={onLanguage}
            owner={account.user.id}
            onboarding={account.awaitingCheck === true}
            onExit={(to: FocusExit) => {
              if (to === "program" || to === "program_tab") {
                setAccount({ awaitingCheck: false });
                step("program");
              } else if (to === "health") step("form");
              else {
                // Left part way: the server ends the wait once a check has completed.
                void api<AccountState>("/auth/me")
                  .then((me) => setAccount({ awaitingCheck: me.awaitingCheck }))
                  .catch(() => undefined);
                home();
              }
            }}
          />
        </LazyPage>
      );
    if (view.step === "program")
      return (
        <LazyPage lang={lang}>
          <ProgramPage
            lang={lang}
            onLanguage={onLanguage}
            onExit={(to: ProgramExit) => (to === "demos" ? step("demos") : home())}
          />
        </LazyPage>
      );
    return (
      <LazyPage lang={lang}>
        <DemoExercises
          lang={lang}
          onLanguage={onLanguage}
          preferences={preferences}
          onPreferences={onPreferences}
          onBack={() => step("program")}
        />
      </LazyPage>
    );
  }
  return (
    <DemoHome lang={lang} onLanguage={onLanguage} onOpen={(p) => void open(p)} onNewVisitor={newVisitor} />
  );
}

/** While the demo person is signed in, or why it could not be. */
function DemoStatus({
  lang,
  onLanguage,
  person,
  onRetry,
}: {
  lang: Lang;
  onLanguage(): void;
  person: Exclude<Person, { status: "ready" }>;
  onRetry(): void;
}) {
  const c = demoCopy(lang);
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page lang={lang} top={<TopBar lang={lang} onLanguage={onLanguage} />} screen={`demo_${person.status}`}>
        {person.status === "starting" ? (
          <Loading text={c.starting} />
        ) : (
          <div className="dm-home">
            <Glass className="fx-card dm-hero" tone="rose">
              <Kicker>{c.kicker}</Kicker>
              <Title>{c.title}</Title>
              <p className="fx-body" role="alert">
                {person.code === "RATE_LIMIT" ? c.busy : c.failed}
              </p>
            </Glass>
            <Actions items={[{ label: c.retry, onClick: onRetry, icon: "refresh", name: "retry" }]} />
          </div>
        )}
      </Page>
    </CheckRoot>
  );
}

/** The demo home: what the demo is, the four parts, and «زائر جديد». */
export function DemoHome({
  lang,
  onLanguage,
  onOpen,
  onNewVisitor,
}: {
  lang: Lang;
  onLanguage(): void;
  onOpen(part: DemoPart): void;
  onNewVisitor(): void;
}) {
  const c = demoCopy(lang);
  return (
    <CheckRoot ui={{ lang }} page={false} className="fx">
      <Page lang={lang} top={<TopBar lang={lang} onLanguage={onLanguage} />} screen="demo_home">
        <div className="dm-home">
          <Glass className="fx-card dm-hero">
            <Kicker>{c.kicker}</Kicker>
            <Title>{c.title}</Title>
            <p className="dm-persona">
              <span className="dm-avatar" aria-hidden="true">
                <CheckIcon name="people" size={22} />
              </span>
              <span>{c.persona}</span>
            </p>
          </Glass>
          <ul className="dm-parts" aria-label={c.partsLabel}>
            {DEMO_PARTS.map((part) => (
              <li key={part}>
                <button type="button" className="dm-part" data-demo-part={part} onClick={() => onOpen(part)}>
                  <span className="dm-part-pic" aria-hidden="true">
                    <img src={PICTURES[part]} alt="" decoding="async" />
                  </span>
                  <span className="dm-part-text">
                    <b>{c.parts[part].title}</b>
                    <span>{c.parts[part].line}</span>
                  </span>
                  <span className="dm-part-go" aria-hidden="true">
                    <CheckIcon name="arrow-forward" size={24} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="dm-new">
            <Actions
              items={[
                {
                  label: c.newVisitor,
                  onClick: onNewVisitor,
                  kind: "secondary",
                  icon: "refresh",
                  name: "new_visitor",
                },
              ]}
            />
            <p className="dm-new-hint">{c.newVisitorHint}</p>
            {/* The hackathon submission's demo video, which lived at /demo before the booth demo. */}
            <a className="dm-video" href="/demo/video.html" data-demo-video>
              {c.watchVideo}
            </a>
            <p className="dm-version" data-app-version>
              {APP_VERSION}
            </p>
          </div>
        </div>
      </Page>
    </CheckRoot>
  );
}

/**
 * The journey's first step: the portal's own health form (the v7 steps), filled with the demo
 * person's answers and editable; its last button reads «التالي: قياس حركتك» and saves, then the check.
 */
function JourneyForm({
  lang,
  onLanguage,
  account,
  onClose,
  onSaved,
}: {
  lang: Lang;
  onLanguage(): void;
  account: AccountState;
  onClose(): void;
  onSaved(saved: Partial<AccountState>): void;
}) {
  const c = demoCopy(lang);
  return (
    <div
      className="portal-shell dm-journey"
      data-screen="demo_journey_form"
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <div className="portal-content">
        <header className="portal-topbar dm-journey-top">
          <span className="dm-journey-kicker">
            {c.kicker} · {c.parts.journey.title}
          </span>
          <div>
            <button type="button" className="language" onClick={onLanguage}>
              {lang === "ar" ? "English" : "العربية"}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label={c.back}
              data-action="leave"
            >
              <CheckIcon name="close" size={22} />
            </button>
          </div>
        </header>
        <main className="portal-main">
          <IntakeForm lang={lang} initial={account.intake} onSaved={onSaved} onCancel={onClose} nextCheck />
        </main>
      </div>
    </div>
  );
}
