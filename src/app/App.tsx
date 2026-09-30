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
import Auth from "./Auth";
import TryCamera from "./TryCamera";
import WeeklyPlanView from "./WeeklyPlan";
import { WeeklyPlan } from "../medical/weekly";
import IntakeForm from "./IntakeForm";
import Workout, { WorkoutRun } from "./Workout";
import Session from "./Session";
import History from "./History";
import CoachSettings from "./CoachSettings";
import Icon from "./Icon";
import CheckApp from "../features/assessment/CheckApp";
import type { ExitTarget } from "../features/assessment/flowMachine";
import { createCheckApi, homeOpenOf, offerMinutes } from "../features/assessment/api";
import { isBoothMode } from "../features/assessment/boothMode";
import { flushPendingCheckCalls, hasSnapshot } from "../features/assessment/useCheckFlow";
import { CHECK_UI } from "../features/assessment/featureFlag";
import { BoothStaffPage, VisitorTokenPage } from "../features/assessment/booth";
import {
  AfterIntakeOffer,
  ExampleProgress,
  ResultsPage,
  TodayCheckSlot,
  type CheckStartOptions,
} from "../features/progress";
import { countPhrase, t } from "../i18n";
import Privacy from "./Privacy";
const qs = new URLSearchParams(location.search);
/** Movement check entries (contract v3 J): the guest check, booth staff mode and the example page. */
const checkEntry = qs.get("check") === "1";
const boothEntry = qs.get("booth") === "1";
/**
 * S55b: a visitor's own phone opened the staff QR (/?boothToken=<token>). VisitorTokenPage redeems the
 * one check token (POST /api/booth/redeem) and keeps this phone's own pass; its Continue opens the
 * guest check for a visitor who is not signed in and Today for one who is, replacing the page.
 */
const boothTokenEntry = qs.get("boothToken");
/** The account page opened on its register tab (S50 QR, the Create a free account button). */
const registerEntry = qs.get("register") === "1";
// The example page (S54): shown only where the check UI is on (featureFlag.ts).
const exampleEntry = CHECK_UI && qs.get("example") === "progress";
/** The privacy notice (Q32 (1), H5), open to everyone. */
const privacyEntry = qs.get("privacy") === "1";
type Page = "today" | "program" | "health" | "history" | "results";
const PAGES: readonly Page[] = CHECK_UI
  ? ["today", "program", "results", "health", "history"]
  : ["today", "program", "health", "history"];
const PAGE_ICONS: Record<Page, string> = {
  today: "spark",
  program: "calendar",
  results: "chart",
  health: "health",
  history: "clock",
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
  boothStaff: "/?booth=1",
  signIn: "/?app=1",
};
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
    [intakeOffer, setIntakeOffer] = useState<[number, number] | null>(null);
  const c = labels(lang);
  const pageLabel = (key: Page) => (key === "results" ? t(lang, "progress.nav.label") : c[key]);
  const toggleLanguage = () => setLang(lang === "ar" ? "en" : "ar");
  /** Where the movement check sends a signed in person when it ends or they leave it. */
  const onCheckExit = (to: ExitTarget) => {
    setCheckOpen(null);
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
    void createCheckApi()
      .getContext()
      .then((r) => setHomeChecksOpen(r.ok && homeOpenOf(r.value)));
  }, [account?.user.id]);
  // Signed in (again): send what a movement check left in its outbox (0.7; a 401 kept it there).
  useEffect(() => {
    if (account) void flushPendingCheckCalls(account.user.id);
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
      void createCheckApi()
        .getContext()
        .then((r) =>
          setIntakeOffer(r.ok && homeOpenOf(r.value) && !r.value.blocked ? offerMinutes(r.value) : null),
        );
  };
  const start = async (isDemo: boolean) => {
    setBusy(true);
    setError("");
    try {
      setRun(await api<WorkoutRun>("/workouts", { version: account?.plan?.version, demo: isDemo }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (boothTokenEntry !== null)
    return (
      <VisitorTokenPage
        lang={lang}
        onLanguage={toggleLanguage}
        token={boothTokenEntry}
        // Booth mode on: a signed in visitor opens Today (S01 starts the booth check), a visitor who is
        // not signed in the guest check (S05); the address loses the token either way.
        onContinue={(on) => openUrl(on && !account ? "/?check=1" : "/", lang, true)}
      />
    );
  if (privacyEntry)
    return (
      <Privacy
        lang={lang}
        onLanguage={toggleLanguage}
        onBack={() => (history.length > 1 ? history.back() : openUrl("/", lang, true))}
      />
    );
  if (E2EGallery && galleryEntry)
    return (
      <Suspense fallback={null}>
        <E2EGallery name={galleryEntry} lang={lang} onLanguage={toggleLanguage} />
      </Suspense>
    );
  if (checkEntry)
    return (
      <CheckApp
        lang={lang}
        onLanguage={toggleLanguage}
        mode="guest"
        // A guest never goes Back into a previous visitor's screens: every exit replaces the page (S57).
        onExit={(to) => openUrl(EXIT_URLS[to] ?? "/", lang, true)}
      />
    );
  if (boothEntry)
    return (
      <BoothStaffPage
        lang={lang}
        onLanguage={toggleLanguage}
        onExit={() => openUrl("/", lang, true)}
        onOpenGuest={() => openUrl("/?check=1", lang)}
      />
    );
  if (exampleEntry)
    return (
      <ExampleProgress
        lang={lang}
        onLanguage={toggleLanguage}
        canTryCheck={isBoothMode() || homeChecksOpen}
        // At the booth the guest check; at home the signed in check starts from Today (S01).
        onTryCheck={() => openUrl(isBoothMode() ? "/?check=1" : "/", lang)}
        onRegister={() => openUrl("/?app=1&register=1", lang)}
      />
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
    );
  }
  if (tryCam)
    return (
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
      />
    );
  if (!account)
    return (
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
    );
  if (checkOpen)
    return (
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
    );
  if (run)
    return (
      <Workout
        run={run}
        lang={lang}
        preferences={preferences}
        onPreferences={updatePreferences}
        onExit={() => setRun(null)}
      />
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
    <TodayCheckSlot
      lang={lang}
      booth={isBoothMode()}
      owner={account.user.id}
      onStart={(options) => setCheckOpen(options ?? {})}
      onOpenResults={() => setPage("results")}
      onOpenHealth={() => {
        setPage("health");
        setEditing(false);
      }}
    />
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
        <div>
          <b>
            {fmtNum(
              p.exercises.reduce((s, e) => s + e.sets, 0),
              lang,
            )}
          </b>
          <span>{c.sets}</span>
        </div>
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
              onClick={() => {
                setPage(key);
                setEditing(false);
              }}
            >
              <Icon name={PAGE_ICONS[key]} size={20} />
              {pageLabel(key)}
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
          <span>{pageLabel(page)}</span>
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
            <IntakeForm
              lang={lang}
              initial={h}
              onSaved={onSaved}
              onCancel={h ? () => setEditing(false) : undefined}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  {/* My results (S53) has no kicker: its results are measured, not reported. */}
                  {page !== "results" && (
                    <p className="section-kicker">
                      {page === "today" ? `${c.welcome}، ${account.user.name}` : c.reported}
                    </p>
                  )}
                  <h1>
                    {page === "today"
                      ? lang === "ar"
                        ? "خطوتك القادمة تبدأ هنا."
                        : "Your next move starts here."
                      : pageLabel(page)}
                  </h1>
                </div>
                {page !== "history" && page !== "results" && (
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
                            <p>{h.conditions.map((v) => optionNames[v]?.[lang]).join(" · ")}</p>
                            <div className="hero-dose">
                              <span>
                                {countOf(
                                  lang,
                                  p.exercises.length,
                                  { one: "حركة واحدة", two: "حركتان", few: "حركات", many: "حركة" },
                                  ["movement", "movements"],
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
                      {page === "today" && (
                        <WeeklyPlanView
                          lang={lang}
                          plan={p}
                          compact
                          onLoaded={onWeekly}
                          onOpen={() => setPage("program")}
                        />
                      )}
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
                        {page === "program" && (
                          <div className="plan-actions">
                            <button className="cta" disabled={busy} onClick={() => void start(false)}>
                              {c.start}
                              <Icon name="play" size={16} />
                            </button>
                            <button className="ghost" disabled={busy} onClick={() => void start(true)}>
                              {c.preview}
                            </button>
                          </div>
                        )}
                      </section>
                      {page === "program" && <WeeklyPlanView lang={lang} plan={p} onLoaded={onWeekly} />}
                    </>
                  )}
                  {(p.notes.length > 0 || p.exclusions.length > 0) && (
                    <section className="plan-notes">
                      <h2>{c.reasons}</h2>
                      {p.notes.map((n) => (
                        <p key={n}>{reason(n)}</p>
                      ))}
                      {p.exclusions.length > 0 && (
                        <details>
                          <summary>
                            {c.excluded} ({fmtNum(p.exclusions.length, lang)})
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
                </>
              )}
              {page === "health" && (
                <section className="health-card">
                  <div className="health-heading">
                    <Icon name="health" size={28} />
                    <h2>{c.health}</h2>
                  </div>
                  <dl className="intake-review">
                    {[
                      [c.age, fmtNum(h.age, lang)],
                      [c.condition, h.conditions.map((v) => optionNames[v]?.[lang]).join("، ")],
                      [c.mobility, optionNames[h.mobility]?.[lang]],
                      [c.pain, h.pain.map((v) => optionNames[v]?.[lang]).join("، ") || c.noItems],
                      [
                        c.restriction,
                        h.restrictions.map((v) => optionNames[v]?.[lang]).join("، ") || c.noItems,
                      ],
                      [c.clearance, h.clearance === "yes" ? c.yes : h.clearance === "no" ? c.no : c.unsure],
                      [c.medications, h.medications || c.noItems],
                      [c.diagnosis, h.diagnosisNotes || c.noItems],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="field-help">{c.recordNote}</p>
                  <button className="cta" onClick={() => setEditing(true)}>
                    {c.edit}
                  </button>
                </section>
              )}
              {page === "history" && (
                <History lang={lang} records={records} onStart={() => setPage("today")} />
              )}
              {page === "results" && (
                <ResultsPage
                  lang={lang}
                  booth={isBoothMode()}
                  owner={account.user.id}
                  onStartCheck={(options) => setCheckOpen(options ?? {})}
                  onOpenProgram={() => setPage("program")}
                />
              )}
              {/* My results carries its own footer (S53) at 16 px; the portal note stays elsewhere. */}
              {page !== "results" && <p className="medical-footnote">{c.medicalNote}</p>}
            </>
          )}
        </main>
      </div>
      {intakeOffer && (
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
      )}
      {settings && (
        <CoachSettings
          lang={lang}
          value={preferences}
          onChange={updatePreferences}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}
