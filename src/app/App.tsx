import { lazy, Suspense, useEffect, useState } from "react";
import { Lang, fmtDate, fmtNum, fmtTime } from "./i18n";
import { labels, optionNames, reasonText, errorText } from "./platform-copy";
import { api, AccountState } from "./api";
import { Intake, Plan } from "../medical/plan";
import { Preferences, readPreferences, savePreferences } from "./experience";
import { EXERCISES } from "../exercises/defs";
import { SavedSession, Setup } from "./product";
import Brand from "./Brand";
import Landing from "./Landing";
import type { WeeklyPlan } from "../medical/weekly";
import { planRest, sessionDay, sessionSize } from "../medical/session";
import type { WorkoutRun } from "./Workout";
import Icon from "./Icon";
import type { ExitTarget } from "../features/assessment/flowMachine";
import { isBoothMode } from "../features/assessment/boothMode";
import { hasSnapshot } from "../features/assessment/snapshot";
import { CHECK_UI } from "../features/assessment/featureFlag";
import type { CheckStartOptions } from "../features/progress";
import { countPhrase, t } from "../i18n";
import { LazyPage, LazyPart } from "./LazyPage";
import { programWhy } from "../medical/programWhy";
import { V7_UI } from "./v7flag";
import type { FocusExit } from "../features/focus/FocusApp";
import type { FindingsExit } from "../features/focus/FindingsPage";
import type { ProgramExit } from "../features/program-v7/ProgramPage";
import type { ShowcaseExit } from "../features/showcase/ShowcaseEntry";
/**
 * Loaded on demand (acceptance F-4): the landing's first script carries the app shell, the landing
 * and the copy; the check, the camera and pose runtime, the booth, the portal pages and the workout
 * each come when they open. The signed in portal fetches the check's code ahead (below).
 */
const CheckApp = lazy(() => import("../features/assessment/CheckApp"));
const loadBooth = () => import("../features/assessment/booth");
const BoothStaffPage = lazy(() => loadBooth().then((m) => ({ default: m.BoothStaffPage })));
/** Booth v2 (contract C): the booth journey, its two doors and six steps. */
const BoothApp = lazy(() => import("../features/booth/BoothApp"));
const loadProgress = () => import("../features/progress");
const AfterIntakeOffer = lazy(() => loadProgress().then((m) => ({ default: m.AfterIntakeOffer })));
const ExampleProgress = lazy(() => loadProgress().then((m) => ({ default: m.ExampleProgress })));
const ResultsPage = lazy(() => loadProgress().then((m) => ({ default: m.ResultsPage })));
const TodayCheckSlot = lazy(() => loadProgress().then((m) => ({ default: m.TodayCheckSlot })));
const Auth = lazy(() => import("./Auth"));
const TryCamera = lazy(() => import("./TryCamera"));
const WeeklyPlanView = lazy(() => import("./WeeklyPlan"));
const SportPath = lazy(() => import("./SportPath"));
const IntakeForm = lazy(() => import("./IntakeForm"));
const Workout = lazy(() => import("./Workout"));
const Session = lazy(() => import("./Session"));
const History = lazy(() => import("./History"));
const CoachSettings = lazy(() => import("./CoachSettings"));
const Privacy = lazy(() => import("./Privacy"));
/**
 * The v7 pages (product v7 contract 1.2, 1.3 and C-9), filled by streams B (the focus check and the
 * findings), E (the program) and F (the showcase). Only a VITE_V7=1 build has them: a default build
 * emits no chunk for them (8.8). The test is V7_UI written inline, as the E2E gallery's below: the
 * bundler registers a dynamic import before it inlines an imported constant, so `V7_UI ? lazy(...)`
 * would still emit the (never loaded) chunks. tests/v7/a-seams.test.ts keeps the two tests equal.
 */
const FocusApp = import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/focus/FocusApp")) : null;
const FindingsPage =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/focus/FindingsPage")) : null;
const ProgramPage =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/program-v7/ProgramPage")) : null;
const ShowcaseEntry =
  import.meta.env.VITE_V7 === "1" ? lazy(() => import("../features/showcase/ShowcaseEntry")) : null;
/** A v7 intake's own rows on My condition (A2-15), from the intake step's lazy chunk. */
const IntakeV7Review =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7Review })))
    : null;
const checkApi = () => import("../features/assessment/api");
/** Sends what a movement check left in its outbox (loads the flow's code first). */
const flushPendingCheckCalls = (owner: string) =>
  import("../features/assessment/useCheckFlow").then((m) => m.flushPendingCheckCalls(owner));
const qs = new URLSearchParams(location.search);
/** Movement check entries (contract v3 J): the guest check, booth staff mode and the example page. */
const checkEntry = qs.get("check") === "1";
/**
 * Booth v2 (contract C1, D-018): /?booth=1 is the booth journey. The parked movement check keeps its
 * staff page at /?booth=check, linked from nowhere at the booth, and its E2E harness at
 * /?booth=1&e2eBooth=<page> (VITE_E2E builds only).
 */
const boothParam = qs.get("booth");
const boothJourneyEntry = boothParam === "1" && !qs.get("e2eBooth");
const boothEntry = boothParam === "check" || (boothParam === "1" && !!qs.get("e2eBooth"));
/** The account page opened on its register tab (S50 QR, the Create a free account button). */
const registerEntry = qs.get("register") === "1";
// The example page (S54): shown wherever the check UI is on (featureFlag.ts, every build by default).
const exampleEntry = CHECK_UI && qs.get("example") === "progress";
/** The privacy notice (Q32 (1), H5), open to everyone. */
const privacyEntry = qs.get("privacy") === "1";
/** A v7 page of the signed in portal (VITE_V7=1 builds only). */
type V7Page = { page: "focus" } | { page: "findings"; checkId: string | null } | { page: "program" };
const CHECK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * The v7 entries (VITE_V7=1 builds only): /?focus=1 the focus check, /?findings=1 (with &check=<id>
 * for one check) the findings, /?targets=1 the program page, all signed in; /?showcase=1 the A to Z
 * showcase entry, signed in or not.
 */
const v7Entry: V7Page | null = !V7_UI
  ? null
  : qs.get("focus") === "1"
    ? { page: "focus" }
    : qs.get("findings") === "1"
      ? { page: "findings", checkId: CHECK_ID.test(qs.get("check") ?? "") ? qs.get("check") : null }
      : qs.get("targets") === "1"
        ? { page: "program" }
        : null;
const showcaseEntry = V7_UI && qs.get("showcase") === "1";
/** The URL of a v7 page, kept in the address bar so a reload opens the same page. */
const v7Url = (p: V7Page | null) =>
  !p
    ? "/"
    : p.page === "focus"
      ? "/?focus=1"
      : p.page === "program"
        ? "/?targets=1"
        : `/?findings=1${p.checkId ? `&check=${p.checkId}` : ""}`;
/** Where the showcase entry leaves to: a full page load, so the account it signed in is read afresh. */
const SHOWCASE_EXITS: Record<ShowcaseExit, string> = {
  landing: "/",
  focus: "/?focus=1",
  findings: "/?findings=1",
  program: "/?targets=1",
};
/** Four tabs (C44): My results carries the checks and, under them, the workout history. */
type Page = "today" | "program" | "health" | "results";
const PAGES: readonly Page[] = ["today", "program", "results", "health"];
const PAGE_ICONS: Record<Page, string> = {
  today: "spark",
  program: "calendar",
  results: "chart",
  health: "health",
};
/** A count with its noun in the right Arabic plural form (one and two replace the number). */
function countOf(
  lang: Lang,
  n: number,
  ar: { one: string; two: string; few: string; many: string },
  en: [string, string],
) {
  if (lang === "en") return `${fmtNum(n, lang)} ${n === 1 ? en[0] : en[1]}`;
  const form = new Intl.PluralRules("ar").select(n);
  if (form === "one") return ar.one;
  if (form === "two") return ar.two;
  return `${fmtNum(n, lang)} ${form === "few" ? ar.few : ar.many}`;
}
/**
 * The Arabic noun under a stat tile's number (the number stands above it): the plural after 2 to 10,
 * the singular after 1 and after 11 and more («٣ جلسات في الأسبوع», «٢٠ دقيقة»).
 */
function tileNoun(n: number, plural: string, singular: string) {
  const form = new Intl.PluralRules("ar").select(n);
  return form === "few" || form === "two" ? plural : singular;
}
/** Foundation gallery of the check (review screenshots, Playwright): VITE_E2E builds only (contract v3 K). */
const E2EGallery =
  import.meta.env.VITE_E2E === "1" ? lazy(() => import("../features/assessment/e2e/Gallery")) : null;
const galleryEntry = E2EGallery ? qs.get("e2eGallery") : null;
/**
 * A full page load that keeps the chosen language (the entries above are read at load). replace: the
 * page is replaced in the history, so Back cannot return to it (booth and guest exits, S57).
 */
const openUrl = (path: string, lang: Lang, replace = false) => {
  const url = lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path;
  if (replace) location.replace(url);
  else location.assign(url);
};
/** The pages the movement check leaves to, outside the signed in portal. */
const EXIT_URLS: Partial<Record<ExitTarget, string>> = {
  example: "/?example=progress",
  try: "/?try=1",
  demo: "/?demo=1&autostart=1",
  signIn: "/?app=1",
};
/** The v7 answers of an intake the v7 form saved (contract 2.2, hasV7Fields); null for one saved before v7. */
const v7AnswersOf = (h: Intake) =>
  h.sex !== undefined && h.regions !== undefined && h.walking !== undefined
    ? { sex: h.sex, regions: h.regions, walking: h.walking, heightCm: h.heightCm, romFlags: h.romFlags }
    : null;

/**
 * My condition's answers (the health page). v7 (D-024, A2-15): in a VITE_V7 build a v7 intake's own
 * rows (sex, walking, height and the body map) follow mobility, as the intake's review step lists
 * them, and replace the pain row, which a v7 intake writes from the body map. An intake saved before
 * v7, and a default build, keep the rows as before.
 */
export function HealthAnswers({ lang, h }: { lang: Lang; h: Intake }) {
  const c = labels(lang);
  const v7 = IntakeV7Review ? v7AnswersOf(h) : null;
  type Row = [string, string | undefined];
  const pain: Row = [c.pain, h.pain.map((v) => optionNames[v]?.[lang]).join("، ") || c.noItems];
  const rows: Row[] = [
    [c.age, fmtNum(h.age, lang)],
    [c.condition, h.conditions.map((v) => optionNames[v]?.[lang]).join("، ")],
    [c.mobility, optionNames[h.mobility]?.[lang]],
    ...(v7 ? [] : [pain]),
    [c.restriction, h.restrictions.map((v) => optionNames[v]?.[lang]).join("، ") || c.noItems],
    [c.clearance, h.clearance === "yes" ? c.yes : h.clearance === "no" ? c.no : c.unsure],
    [c.medications, h.medications || c.noItems],
    [c.diagnosis, h.diagnosisNotes || c.noItems],
  ];
  const row = ([k, v]: Row) => (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <dl className="intake-review">
      {rows.slice(0, 3).map(row)}
      {IntakeV7Review && v7 && (
        <Suspense fallback={null}>
          <IntakeV7Review lang={lang} value={v7} />
        </Suspense>
      )}
      {rows.slice(3).map(row)}
    </dl>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(qs.get("lang") === "en" ? "en" : "ar"),
    [account, setAccount] = useState<AccountState | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState<Page>("today"),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const [preferences, setPreferences] = useState(readPreferences),
    [settings, setSettings] = useState(false),
    [records, setRecords] = useState<SavedSession[]>([]),
    [run, setRun] = useState<WorkoutRun | null>(null),
    [busy, setBusy] = useState(false),
    [demo, setDemo] = useState(qs.get("demo") === "1" && qs.get("autostart") === "1"),
    [authView, setAuthView] = useState(qs.get("app") === "1" || registerEntry),
    [authRegister, setAuthRegister] = useState(registerEntry),
    [tryCam, setTryCam] = useState(qs.get("try") === "1"),
    // A signed in check reloaded by S32 (camera permission) opens again where it was. The options
    // name a resume (O6), the side lean only session (Q12 (2)) or the care team release (S01).
    [checkOpen, setCheckOpen] = useState<CheckStartOptions | null>(() =>
      hasSnapshot("signedIn") ? {} : null,
    ),
    // S54: home checks are open (the context says so for a signed in person; closed otherwise).
    [homeChecksOpen, setHomeChecksOpen] = useState(false),
    [intakeOffer, setIntakeOffer] = useState<[number, number] | null>(null),
    // A v7 page opened by its URL or from another v7 page (VITE_V7=1 builds only).
    [v7Page, setV7Page] = useState<V7Page | null>(v7Entry);
  const c = labels(lang);
  /** The short tab names (D-018: اليوم · برنامجي · نتائجي · حالتي); page titles keep the full names. */
  const navLabel = (key: Page) => (key === "results" ? t(lang, "progress.nav.label") : c.nav[key]);
  const pageTitle = (key: Page) => (key === "results" ? t(lang, "progress.nav.label") : c.titles[key]);
  const toggleLanguage = () => setLang(lang === "ar" ? "en" : "ar");
  /** Where the movement check sends a signed in person when it ends or they leave it. */
  const onCheckExit = (to: ExitTarget) => {
    setCheckOpen(null);
    // The check can change the check in setting (S14): the settings dialog shows it as stored.
    setPreferences(readPreferences());
    const url = EXIT_URLS[to];
    // In booth mode every exit replaces the page (S57); at home a page change keeps Back.
    if (url) return openUrl(url, lang, isBoothMode());
    if (to === "healthEdit") {
      setPage("health");
      setEditing(true);
      return;
    }
    setPage(to === "results" ? "results" : "today");
  };
  const updatePreferences = (p: Preferences) => {
    setPreferences(p);
    savePreferences(p);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  useEffect(() => {
    let active = true;
    api<AccountState>("/auth/me")
      .then((s) => {
        if (active) setAccount(s);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  // S54: "Try the movement check" also shows while home checks are open (the context, signed in only,
  // so a visitor who is not signed in never calls it).
  useEffect(() => {
    if (!exampleEntry || !account) return;
    void checkApi().then(({ createCheckApi, homeOpenOf }) =>
      createCheckApi()
        .getContext()
        .then((r) => setHomeChecksOpen(r.ok && homeOpenOf(r.value))),
    );
  }, [account?.user.id]);
  // Signed in (again): send what a movement check left in its outbox (0.7; a 401 kept it there).
  useEffect(() => {
    if (!account) return;
    void flushPendingCheckCalls(account.user.id);
    // The check's code, fetched ahead while the portal is open, so the check still opens after the
    // connection drops (0.7).
    void import("../features/assessment/CheckApp").catch(() => undefined);
  }, [account?.user.id]);
  useEffect(() => {
    if (account && !run)
      api<{ records: SavedSession[] }>("/sessions")
        .then((x) => setRecords(x.records))
        .catch(() => setRecords([]));
  }, [account, run]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, editing, run]);
  const onWeekly = (w: WeeklyPlan) =>
    setAccount((a) => (a && a.plan ? { ...a, plan: { ...a.plan, weekly: w } } : a));
  const onSaved = (s: { intake: Intake; plan: Plan }) => {
    setAccount((a) => (a ? { ...a, ...s } : null));
    setEditing(false);
    setPage("program");
    // S02: offered once after the intake, only while home checks are open and the plan is not in review.
    if (CHECK_UI && s.plan.status !== "review")
      void checkApi().then(({ createCheckApi, homeOpenOf, offerMinutes }) =>
        createCheckApi()
          .getContext()
          .then((r) =>
            setIntakeOffer(r.ok && homeOpenOf(r.value) && !r.value.blocked ? offerMinutes(r.value) : null),
          ),
      );
  };
  const start = async (isDemo: boolean) => {
    setBusy(true);
    setError("");
    try {
      // Booth v2 (D): the session holds the day's guided cards; the phone says which weekday it is.
      setRun(
        await api<WorkoutRun>("/workouts", {
          version: account?.plan?.version,
          demo: isDemo,
          guided: true,
          weekday: new Date().getDay(),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (privacyEntry)
    return (
      <LazyPage lang={lang}>
        <Privacy
          lang={lang}
          onLanguage={toggleLanguage}
          onBack={() => (history.length > 1 ? history.back() : openUrl("/", lang, true))}
        />
      </LazyPage>
    );
  if (E2EGallery && galleryEntry)
    return (
      <Suspense fallback={null}>
        <E2EGallery name={galleryEntry} lang={lang} onLanguage={toggleLanguage} />
      </Suspense>
    );
  if (ShowcaseEntry && showcaseEntry)
    return (
      <LazyPage lang={lang}>
        <ShowcaseEntry
          lang={lang}
          onLanguage={toggleLanguage}
          onExit={(to) => openUrl(SHOWCASE_EXITS[to], lang, true)}
        />
      </LazyPage>
    );
  if (checkEntry)
    return (
      <LazyPage lang={lang}>
        <CheckApp
          lang={lang}
          onLanguage={toggleLanguage}
          mode="guest"
          // A guest never goes Back into a previous visitor's screens: every exit replaces the page (S57).
          onExit={(to) => openUrl(EXIT_URLS[to] ?? "/", lang, true)}
        />
      </LazyPage>
    );
  if (boothJourneyEntry)
    return (
      <LazyPage lang={lang}>
        <BoothApp lang={lang} onLanguage={toggleLanguage} />
      </LazyPage>
    );
  if (boothEntry)
    return (
      <LazyPage lang={lang}>
        <BoothStaffPage
          lang={lang}
          onLanguage={toggleLanguage}
          onOpenGuest={() => openUrl("/?check=1", lang)}
        />
      </LazyPage>
    );
  if (exampleEntry)
    return (
      <LazyPage lang={lang}>
        <ExampleProgress
          lang={lang}
          onLanguage={toggleLanguage}
          canTryCheck={isBoothMode() || homeChecksOpen}
          booth={isBoothMode()}
          // At the booth the guest check; at home the signed in check starts from Today (S01).
          onTryCheck={() => openUrl(isBoothMode() ? "/?check=1" : "/", lang)}
          onRegister={() => openUrl("/?app=1&register=1", lang)}
        />
      </LazyPage>
    );
  if (demo) {
    const ex = EXERCISES.find((e) => e.id === qs.get("ex")) ?? EXERCISES[0];
    const setup: Setup = {
      position:
        ex.id === "sit_to_stand" ? "rise" : qs.get("profile") === "wheelchair" ? "wheelchair" : "chair",
      support:
        qs.get("profile") === "hemiparesis_right"
          ? "right"
          : qs.get("profile") === "hemiparesis_left"
            ? "left"
            : "none",
    };
    return (
      <LazyPage lang={lang}>
        <Session
          lang={lang}
          setup={setup}
          exerciseId={ex.id}
          demo
          preferences={preferences}
          onPreferences={updatePreferences}
          onExit={() => {
            setDemo(false);
            history.replaceState({}, "", "/");
          }}
          onRestart={() => {
            setDemo(false);
            setTimeout(() => setDemo(true), 0);
          }}
          onDemo={() => {}}
        />
      </LazyPage>
    );
  }
  if (tryCam)
    return (
      <LazyPage lang={lang}>
        <TryCamera
          lang={lang}
          onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
          preferences={preferences}
          onPreferences={updatePreferences}
          onExit={() => {
            setTryCam(false);
            history.replaceState({}, "", "/");
          }}
          onSimulate={() => {
            setTryCam(false);
            setDemo(true);
          }}
          onRegister={() => {
            setTryCam(false);
            setAuthRegister(true);
            setAuthView(true);
            history.replaceState({}, "", "/");
          }}
        />
      </LazyPage>
    );
  if (loading)
    return (
      <div className="portal-loading">
        <Brand />
        <p>{c.loading}</p>
      </div>
    );
  if (!account && !authView)
    return (
      <Landing
        lang={lang}
        onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
        onEnter={(register) => {
          setAuthRegister(register === true);
          setAuthView(true);
        }}
        onDemo={() => setTryCam(true)}
        tryCheck={isBoothMode() || homeChecksOpen}
      />
    );
  if (!account)
    return (
      <LazyPage lang={lang}>
        <Auth
          lang={lang}
          onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
          onSuccess={setAccount}
          onDemo={() => setTryCam(true)}
          initialRegister={authRegister}
          onBack={() => {
            setAuthView(false);
            history.replaceState({}, "", "/");
          }}
        />
      </LazyPage>
    );
  if (v7Page) {
    /** Opens another v7 page, or closes them on a portal tab (healthEdit: the health form open). */
    const go = (next: V7Page | null, tab: Page = "today", healthEdit = false) => {
      history.replaceState({}, "", v7Url(next));
      setV7Page(next);
      if (next) return;
      setPage(tab);
      setEditing(healthEdit);
    };
    if (FocusApp && v7Page.page === "focus")
      return (
        <LazyPage lang={lang}>
          <FocusApp
            lang={lang}
            onLanguage={toggleLanguage}
            owner={account.user.id}
            onExit={(to: FocusExit) =>
              to === "findings"
                ? go({ page: "findings", checkId: null })
                : to === "health"
                  ? go(null, "health", true)
                  : go(null)
            }
          />
        </LazyPage>
      );
    if (FindingsPage && v7Page.page === "findings")
      return (
        <LazyPage lang={lang}>
          <FindingsPage
            lang={lang}
            onLanguage={toggleLanguage}
            checkId={v7Page.checkId}
            onExit={(to: FindingsExit) =>
              to === "program"
                ? go({ page: "program" })
                : to === "focus"
                  ? go({ page: "focus" })
                  : go(null, to === "results" ? "results" : "today")
            }
          />
        </LazyPage>
      );
    if (ProgramPage && v7Page.page === "program")
      return (
        <LazyPage lang={lang}>
          <ProgramPage
            lang={lang}
            onLanguage={toggleLanguage}
            onExit={(to: ProgramExit) =>
              to === "findings"
                ? go({ page: "findings", checkId: null })
                : go(null, to === "program" ? "program" : "today")
            }
          />
        </LazyPage>
      );
  }
  if (checkOpen)
    return (
      <LazyPage lang={lang}>
        <CheckApp
          lang={lang}
          onLanguage={toggleLanguage}
          mode="signedIn"
          onExit={onCheckExit}
          owner={account.user.id}
          {...(checkOpen.resume ? { resume: checkOpen.resume } : {})}
          {...(checkOpen.session ? { session: checkOpen.session } : {})}
          {...(checkOpen.release ? { release: true } : {})}
        />
      </LazyPage>
    );
  if (run)
    return (
      <LazyPage lang={lang}>
        <Workout
          run={run}
          lang={lang}
          firstSession={records.length === 0}
          preferences={preferences}
          onPreferences={updatePreferences}
          onExit={() => setRun(null)}
        />
      </LazyPage>
    );
  const h = account.intake,
    p = account.plan;
  const intake = !h || editing;
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
  const upcoming = weekdays.find((d) => p?.days.includes(d.getDay())) ?? weekdays[0];
  const reason = (key: string) => reasonText[key]?.[lang] ?? key;
  // S01 (with S03 above it when due): after the next session card, before the week strip.
  const todaySlot = CHECK_UI && (
    <LazyPart lang={lang}>
      <TodayCheckSlot
        lang={lang}
        owner={account.user.id}
        onStart={(options) => setCheckOpen(options ?? {})}
        onOpenResults={() => setPage("results")}
        onOpenHealth={() => {
          setPage("health");
          setEditing(false);
        }}
      />
    </LazyPart>
  );
  const planDetails = p && (
    <>
      <div className="plan-measures">
        <div>
          <b>{fmtNum(p.days.length, lang)}</b>
          <span>
            {lang === "ar"
              ? tileNoun(p.days.length, "جلسات في الأسبوع", "جلسة في الأسبوع")
              : p.days.length === 1
                ? "session a week"
                : "sessions a week"}
          </span>
        </div>
        <div>
          <b>{fmtNum(p.estimatedMinutes, lang)}</b>
          <span>{lang === "ar" ? tileNoun(p.estimatedMinutes, "دقائق", "دقيقة") : c.minutes}</span>
        </div>
        {p.exercises.length > 0 ? (
          <div>
            <b>
              {fmtNum(
                p.exercises.reduce((s, e) => s + e.sets, 0),
                lang,
              )}
            </b>
            <span>{c.sets}</span>
          </div>
        ) : (
          // Booth v2 (D): a program of guided cards alone counts the exercises of a session.
          p.weekly && (
            <div>
              <b>{fmtNum(sessionSize(p, sessionDay(p.weekly, upcoming.getDay(), planRest(p))), lang)}</b>
              <span>
                {lang === "ar"
                  ? tileNoun(
                      sessionSize(p, sessionDay(p.weekly, upcoming.getDay(), planRest(p))),
                      "تمارين في الجلسة",
                      "تمرينًا في الجلسة",
                    )
                  : "exercises a session"}
              </span>
            </div>
          )
        )}
      </div>
      <div className="prescriptions">
        {p.exercises.map((e, i) => {
          const def = EXERCISES.find((x) => x.id === e.exerciseId)!;
          return (
            <article className="prescription" key={e.exerciseId}>
              <span className="prescription-number">{fmtNum(i + 1, lang)}</span>
              <div>
                <h3>{def.name[lang]}</h3>
                <p>{reason(e.reason)}</p>
                <div className="dose">
                  <b>
                    {fmtNum(e.sets, lang)} {c.sets}
                  </b>
                  <span>×</span>
                  <b>
                    {fmtNum(e.reps, lang)} {c.reps}
                  </b>
                  <span>·</span>
                  <span>
                    {fmtNum(e.restSeconds, lang)} {c.seconds} {c.rest}
                  </span>
                </div>
              </div>
              <Icon name={e.setup.position} size={29} />
            </article>
          );
        })}
      </div>
    </>
  );
  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <button className="logo-link" onClick={() => setPage("today")}>
          <Brand />
        </button>
        <nav>
          {PAGES.map((key) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => {
                setPage(key);
                setEditing(false);
              }}
            >
              <span className="nav-icon">
                <Icon name={PAGE_ICONS[key]} size={20} />
              </span>
              <span className="nav-label">{navLabel(key)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar">{account.user.name.slice(0, 1)}</span>
          <div>
            <strong>{account.user.name}</strong>
            <small>{account.user.email}</small>
          </div>
        </div>
        <button
          className="logout"
          onClick={async () => {
            try {
              // Send this account's waiting check calls while its session holds (best effort, 3 s);
              // what stays waits for this account and is never sent under another (resultQueue.ts).
              await Promise.race([
                flushPendingCheckCalls(account.user.id).catch(() => undefined),
                new Promise((done) => setTimeout(done, 3000)),
              ]);
              await api("/auth/logout", {});
              setAccount(null);
              setRecords([]);
              setAuthRegister(false);
            } catch {
              setError("LOGOUT");
            }
          }}
        >
          <Icon name="logout" size={18} />
          {c.logout}
        </button>
      </aside>
      <div className="portal-content">
        <header className="portal-topbar">
          <div>
            <button className="icon-button" onClick={() => setSettings(true)} aria-label={c.neural}>
              <Icon name="settings" size={19} />
            </button>
            <button className="language" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              {lang === "ar" ? "English" : "العربية"}
            </button>
          </div>
        </header>
        <main className="portal-main">
          {intake ? (
            <LazyPart lang={lang}>
              <IntakeForm
                lang={lang}
                initial={h}
                onSaved={onSaved}
                onCancel={h ? () => setEditing(false) : undefined}
              />
            </LazyPart>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  {/* Program and health say what was reported; Today greets (C43); My results (S53)
                      has no kicker: its results are measured, not reported. */}
                  {page !== "results" && page !== "today" && <p className="section-kicker">{c.reported}</p>}
                  <h1>
                    {page === "today"
                      ? `${c.welcome}${lang === "ar" ? "، " : ", "}${account.user.name}`
                      : pageTitle(page)}
                  </h1>
                </div>
                {page !== "results" && (
                  <button
                    className="ghost"
                    onClick={() => {
                      setPage("health");
                      setEditing(true);
                    }}
                  >
                    <Icon name="health" size={17} />
                    {c.edit}
                  </button>
                )}
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error === "LOGOUT" ? c.signOutError : errorText(error, lang)}
                </p>
              )}
              {(page === "today" || page === "program") && p && (
                <>
                  {p.status === "review" ? (
                    <section className="medical-review">
                      <span className="review-icon">
                        <Icon name="health" size={30} />
                      </span>
                      <h2>{c.planReview}</h2>
                      <p>{c.planReviewBody}</p>
                      <ul>
                        {p.reasons.map((r) => (
                          <li key={r}>{reason(r)}</li>
                        ))}
                      </ul>
                      <button className="cta" onClick={() => setEditing(true)}>
                        {c.edit}
                        <Icon name="arrow" size={17} />
                      </button>
                    </section>
                  ) : null}
                  {p.status === "review" ? (
                    page === "today" && todaySlot
                  ) : (
                    <>
                      {page === "program" && h.goal === "sport" && h.sport && (
                        <LazyPart lang={lang}>
                          <SportPath lang={lang} sport={h.sport} plan={p} weekly={p.weekly} />
                        </LazyPart>
                      )}
                      {page === "today" && (
                        <section className="next-workout">
                          <div>
                            <p className="section-kicker">
                              {c.nextSession}
                              {" · "}
                              {fmtDate(upcoming, lang, {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                              })}
                            </p>
                            <h2>{optionNames[h.goal]?.[lang]}</h2>
                            <div className="hero-dose">
                              <span>
                                {countOf(
                                  lang,
                                  // Booth v2 (D): the camera movements and the day's guided cards.
                                  sessionSize(
                                    p,
                                    p.weekly && sessionDay(p.weekly, upcoming.getDay(), planRest(p)),
                                  ),
                                  { one: "تمرين واحد", two: "تمرينان", few: "تمارين", many: "تمرينًا" },
                                  ["exercise", "exercises"],
                                )}
                              </span>
                              <span>{countPhrase(lang, "min", p.estimatedMinutes)}</span>
                              <span>
                                <bdi>{fmtTime(p.time, lang)}</bdi>
                              </span>
                            </div>
                            <button className="cta" onClick={() => void start(false)} disabled={busy}>
                              {busy ? c.busy : c.start}
                              <Icon name="play" size={17} />
                            </button>
                            <button className="hero-preview" onClick={() => void start(true)} disabled={busy}>
                              {c.preview}
                            </button>
                          </div>
                          <div className="workout-art">
                            <img
                              src={
                                h.mobility === "wheelchair"
                                  ? "/illustrations/wheelchair-press.png"
                                  : h.mobility === "standing"
                                    ? "/illustrations/standing.png"
                                    : "/illustrations/chair-press.png"
                              }
                              alt={lang === "ar" ? "رسم توضيحي للتمرين" : "Exercise illustration"}
                            />
                          </div>
                        </section>
                      )}
                      {page === "today" && todaySlot}
                      <section className="schedule-card">
                        <div className="card-heading">
                          <h2>{c.schedule}</h2>
                          <span>
                            <bdi>{fmtTime(p.time, lang)}</bdi>
                          </span>
                        </div>
                        <div className="week-strip">
                          {weekdays.map((d, i) => {
                            const active = p.days.includes(d.getDay());
                            return (
                              <div
                                className={`${active ? "training-day" : ""} ${i === 0 ? "current-day" : ""}`}
                                key={i}
                              >
                                <span>
                                  {fmtDate(d, lang, {
                                    weekday: "short",
                                  })}
                                </span>
                                <b>{fmtNum(d.getDate(), lang)}</b>
                                <small>{active ? c.workoutDay : c.restDay}</small>
                                {active && <i />}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                      {page === "program" && (
                        <section className="plan-card">
                          <div className="card-heading">
                            <h2>{c.program}</h2>
                            <span>{c.planReady}</span>
                          </div>
                          {planDetails}
                          <div className="preparation-row">
                            <span>
                              <Icon name="clock" size={17} />
                              {c.warmup} {countPhrase(lang, "min", p.warmUpMinutes)}
                            </span>
                            <span>
                              {c.cooldown} {countPhrase(lang, "min", p.coolDownMinutes)}
                            </span>
                          </div>
                          <div className="plan-actions">
                            <button className="cta" disabled={busy} onClick={() => void start(false)}>
                              {c.start}
                              <Icon name="play" size={16} />
                            </button>
                            <button className="ghost" disabled={busy} onClick={() => void start(true)}>
                              {c.preview}
                            </button>
                          </div>
                        </section>
                      )}
                      {/* C43: why this program lives on the Program tab only, in two short lines (B7). */}
                      {page === "program" && (
                        <section className="plan-notes">
                          <h2>{c.reasons}</h2>
                          {programWhy(p).map((line) => (
                            <p key={line.en}>
                              <Icon name="check" size={15} />
                              {line[lang]}
                            </p>
                          ))}
                          {p.exclusions.length > 0 && (
                            <details>
                              <summary>
                                {c.excluded} ({fmtNum(p.exclusions.length, lang)})
                                <Icon name="arrow" size={14} />
                              </summary>
                              {p.exclusions.map((e) => (
                                <p key={e.exerciseId}>
                                  <strong>{EXERCISES.find((x) => x.id === e.exerciseId)?.name[lang]}:</strong>{" "}
                                  {reason(e.reason)}
                                </p>
                              ))}
                            </details>
                          )}
                        </section>
                      )}
                      {page === "program" && (
                        <LazyPart lang={lang}>
                          <WeeklyPlanView lang={lang} plan={p} onLoaded={onWeekly} />
                        </LazyPart>
                      )}
                    </>
                  )}
                </>
              )}
              {page === "health" && (
                <section className="health-card">
                  <div className="health-heading">
                    <Icon name="health" size={28} />
                    <h2>{c.health}</h2>
                  </div>
                  <HealthAnswers lang={lang} h={h} />
                  <p className="field-help">{c.recordNote}</p>
                  <button className="cta" onClick={() => setEditing(true)}>
                    {c.edit}
                  </button>
                </section>
              )}
              {page === "results" && (
                <LazyPart lang={lang}>
                  {CHECK_UI ? (
                    <ResultsPage
                      lang={lang}
                      owner={account.user.id}
                      onStartCheck={(options) => setCheckOpen(options ?? {})}
                      onOpenProgram={() => setPage("program")}
                      workouts={<History lang={lang} records={records} />}
                    />
                  ) : (
                    <History lang={lang} records={records} />
                  )}
                </LazyPart>
              )}
            </>
          )}
        </main>
      </div>
      {intakeOffer && (
        <LazyPart lang={lang}>
          <AfterIntakeOffer
            lang={lang}
            // The computed estimate of the base tests at home (O40); offered only while home checks open.
            minutes={intakeOffer}
            onStart={() => {
              setIntakeOffer(null);
              setCheckOpen({});
            }}
            onLater={() => setIntakeOffer(null)}
            // The intake form is gone: focus returns to the Program page heading (5.1).
            returnFocus={() => document.querySelector<HTMLElement>(".page-heading h1")}
          />
        </LazyPart>
      )}
      {settings && (
        <LazyPart lang={lang}>
          <CoachSettings
            lang={lang}
            value={preferences}
            onChange={updatePreferences}
            onClose={() => setSettings(false)}
          />
        </LazyPart>
      )}
    </div>
  );
}
