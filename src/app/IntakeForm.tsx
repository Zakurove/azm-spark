import { lazy, Suspense, useState } from "react";
import {
  HEIGHT_CM,
  Intake,
  conditions,
  equipmentOptions,
  goalOptions,
  painOptions,
  reconcileV7Fields,
  restrictionOptions,
  validateIntake,
  Plan,
} from "../medical/plan";
import { painIdsFromRegions, type ReportRegion } from "../medical/body-map";
import { sportById, sportsFor, type SportId } from "../medical/sports";
import SportIcon from "./SportIcon";
import { Lang, fmtDate, fmtNum, fmtTime } from "./i18n";
import { labels, optionNames, errorText } from "./platform-copy";
import { api } from "./api";
import Icon from "./Icon";
import ReportUpload, { ReportResult } from "./ReportUpload";
import { CHECK_DATA } from "../movements/assessments";
import { t } from "../i18n";
import { privacyHref } from "./privacyHref";
import { V7_UI } from "./v7flag";
import type { V7Ui } from "./IntakeV7";

/**
 * v7 (product v7 contract 1.2 and 2.2, shortened by D-034 item 5): a VITE_V7 build has three short
 * steps, their v7 parts loaded on demand (src/app/IntakeV7.tsx):
 *   1. «حالتك وحركتك»: age, sex, the conditions with their side, how the person exercises, walking;
 *   2. «جسمك وسلامتك»: the body map filled from the condition, then the safety questions (warning
 *      signs, clearance, recent change, restrictions, and the v7 safety answers);
 *   3. «هدفك ووقتك»: the goal, equipment, days, time and length, and the consent.
 * It no longer asks the diagnosis notes, the medications or the v1 support side (the map gives it),
 * writes pain[] from the body map, and has no review step (local-docs/qa/v7/form-trim.md). A default
 * build keeps the four v1 steps exactly as before and loads none of it.
 */
// The lazy imports test the env inline, like App.tsx's VITE_E2E gallery: Vite 8 chunks before it
// folds a constant imported from another module, so `V7_UI ? lazy(...)` left an orphan IntakeV7
// chunk in a default build (contract change log, A2). V7_UI drives every other branch. The parts
// wait in a plain Suspense: importing LazyPage here moved React's jsx runtime out of the landing's
// chunk, and a part that fails to load reaches the page's own boundary (App's LazyPage).
const IntakeV7 = import.meta.env.VITE_V7 === "1" ? lazy(() => import("./IntakeV7")) : null;
const IntakeV7About =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7About })))
    : null;
const IntakeV7StepName =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7StepName })))
    : null;
const IntakeV7Consent =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7Consent })))
    : null;
const IntakeV7Review =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7Review })))
    : null;
/** D-032 item 3: «التالي: قياس حركتك» on the last button when the movement check comes next. */
const IntakeV7NextCheck =
  import.meta.env.VITE_V7 === "1"
    ? lazy(() => import("./IntakeV7").then((m) => ({ default: m.IntakeV7NextCheck })))
    : null;
type StepKind = "about" | "health" | "body" | "goal" | "review";
/** v7 (D-034 item 5): three steps; the v1 health questions are shared between the first two. */
const STEP_KINDS: readonly StepKind[] = V7_UI
  ? ["about", "body", "goal"]
  : ["about", "health", "goal", "review"];
/** The label of each v1 step in labels().steps. */
const V1_STEP: Record<Exclude<StepKind, "body">, number> = { about: 0, health: 1, goal: 2, review: 3 };
/** The v7 first step's own answers: sex, walking (bed walks no) and a valid height if given. */
function v7AboutReady(d: Pick<Intake, "sex" | "walking" | "heightCm">): boolean {
  const h = d.heightCm;
  return (
    d.sex !== undefined &&
    d.walking !== undefined &&
    (h === undefined || (Number.isInteger(h) && h >= HEIGHT_CM.min && h <= HEIGHT_CM.max))
  );
}

type Draft = Omit<Intake, "symptoms" | "recentChange" | "clearance" | "mobility"> & {
  symptoms: Intake["symptoms"] | "";
  recentChange: Intake["recentChange"] | "";
  clearance: Intake["clearance"] | "";
  mobility: Intake["mobility"] | "";
};
/**
 * D-035 item 5: each safety question's answers in the order the buttons show them, the answer that
 * lets the person go ahead first (no warning sign, no recent change, no restriction, cleared by the
 * doctor). Same values, only the order.
 */
export const SAFETY_ANSWERS = {
  symptoms: ["no", "yes"],
  recentChange: ["no", "yes"],
  restrictions: ["no", "yes"],
  clearance: ["yes", "no", "unsure"],
} as const;

/**
 * The intake the form validates and saves, from its draft. A VITE_V7 build writes pain[] from the
 * body map (contract 2.2 rule 3; the v1 pain question is not asked). A default build asks neither
 * the body map nor walking, yet a saved v7 intake brings them into the draft, so it keeps them in
 * line with the v1 answers the person changed (reconcileV7Fields, Gate A review): otherwise an
 * unticked pain area or mobility bed would make the intake impossible to save in this build.
 */
export function intakeBody<D extends Draft>(draft: D): D {
  return V7_UI ? { ...draft, pain: painIdsFromRegions(draft.regions ?? []) } : reconcileV7Fields(draft);
}
const empty: Draft = {
  age: 0,
  conditions: [],
  diagnosisNotes: "",
  medications: "",
  mobility: "",
  support: "none",
  pain: [],
  restrictions: [],
  symptoms: "",
  recentChange: "",
  clearance: "",
  equipment: [],
  goal: "mobility",
  days: [0, 2, 4],
  time: "09:00",
  sessionMinutes: 30,
  consent: false,
};
/**
 * The goal of the program (booth v2, B3): four cards, and with «العودة إلى الرياضة» the grid of the 13
 * para sports, those that suit the person's position first. The rules decide what is safe; the goal
 * only shapes what is chosen.
 */
export function GoalChoices({
  lang,
  goal,
  sport,
  mobility,
  onGoal,
  onSport,
}: {
  lang: Lang;
  goal: Intake["goal"];
  sport: SportId | undefined;
  mobility: string;
  onGoal: (goal: Intake["goal"]) => void;
  onSport: (sport: SportId) => void;
}) {
  const c = labels(lang);
  return (
    <>
      <fieldset>
        <legend>{c.goal}</legend>
        <div className="goal-grid">
          {goalOptions.map((g) => (
            <button
              type="button"
              key={g}
              aria-pressed={goal === g}
              className={`goal-card ${goal === g ? "selected" : ""}`}
              onClick={() => onGoal(g)}
            >
              <span className="goal-icon">
                <SportIcon icon={g} size={22} />
              </span>
              {optionNames[g][lang]}
            </button>
          ))}
        </div>
      </fieldset>
      {goal === "sport" && (
        <fieldset className="sport-pick">
          <legend>{c.sportPick}</legend>
          <div className="sport-grid">
            {sportsFor(mobility).map((s) => (
              <button
                type="button"
                key={s.id}
                aria-pressed={sport === s.id}
                className={`sport-tile ${sport === s.id ? "selected" : ""}`}
                onClick={() => onSport(s.id)}
              >
                <span className="sport-disc">
                  <SportIcon icon={s.icon} size={26} />
                </span>
                {s.name[lang]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

export default function IntakeForm({
  lang,
  initial,
  onSaved,
  onCancel,
  nextCheck = false,
}: {
  lang: Lang;
  initial: Intake | null;
  onSaved: (v: { intake: Intake; plan: Plan; awaitingCheck?: boolean }) => void;
  onCancel?: () => void;
  /**
   * D-032 item 3 (VITE_V7 builds): the movement check comes right after the form (a new profile, or a
   * program still waiting for the check), so the last button reads «التالي: قياس حركتك».
   */
  nextCheck?: boolean;
}) {
  const c = labels(lang),
    // A stable chair is assumed (B6): a chair saved before is dropped from the equipment answer.
    [draft, setDraft] = useState<Draft>(() =>
      initial ? { ...initial, equipment: initial.equipment.filter((e) => e !== "chair") } : empty,
    ),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set()),
    [reportInfo, setReportInfo] = useState<ReportResult | null>(null);
  // v7: the "Your body" step's working state, and the report's body map suggestions.
  // v7: the restrictions start as one yes or no; a yes shows the list.
  const [restrictYes, setRestrictYes] = useState(false);
  const [v7ui, setV7ui] = useState<V7Ui | null>(null),
    [reportRegions, setReportRegions] = useState<{ regions: ReportRegion[]; pain: string[] } | null>(null);
  const applyExtraction = (r: ReportResult) => {
    const filled = new Set<string>();
    const e = r.extracted;
    setDraft((d) => {
      const next = { ...d };
      if (e.age && !d.age) {
        next.age = e.age;
        filled.add("age");
      }
      if (e.conditions.length) {
        next.conditions = e.conditions;
        filled.add("conditions");
      }
      if (e.diagnosisNotes && !d.diagnosisNotes) {
        next.diagnosisNotes = e.diagnosisNotes;
        filled.add("diagnosis");
      }
      if (e.medications && !d.medications) {
        next.medications = e.medications;
        filled.add("medications");
      }
      if (e.mobility !== "unknown" && d.mobility === "") {
        next.mobility = e.mobility as Draft["mobility"];
        filled.add("mobility");
      }
      if (e.support === "left" || e.support === "right") {
        next.support = e.support;
        filled.add("support");
      }
      // v7 writes pain[] from the body map: the report's pain areas become map suggestions instead.
      if (!V7_UI && e.pain.length && !d.pain.length) {
        next.pain = e.pain;
        filled.add("pain");
      }
      if (e.restrictions.length && !d.restrictions.length) {
        next.restrictions = e.restrictions;
        filled.add("restrictions");
      }
      if (e.symptoms === "yes" && d.symptoms === "") {
        next.symptoms = "yes";
        filled.add("symptoms");
      }
      if (e.recentChange === "yes" && d.recentChange === "") {
        next.recentChange = "yes";
        filled.add("recentChange");
      }
      return next;
    });
    setPrefilled(filled);
    setReportInfo(r);
    if (V7_UI) setReportRegions({ regions: e.regions ?? [], pain: e.pain });
  };
  const mark = (f: string) =>
    prefilled.has(f) ? <span className="report-badge">{c.reportBadge}</span> : null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const name = (s: string) => optionNames[s]?.[lang] ?? s;
  const toggle = (field: "conditions" | "pain" | "restrictions" | "equipment", v: string) => {
    const values = draft[field];
    set(
      field,
      field === "conditions" && v === "none"
        ? ["none"]
        : values.includes(v)
          ? values.filter((x) => x !== v)
          : [...values.filter((x) => x !== "none"), v],
    );
  };
  const choices = (
    field: "conditions" | "pain" | "restrictions" | "equipment",
    options: readonly string[],
    withNone = true,
  ) => (
    <div className={`intake-choices ${field === "conditions" ? "conditions-grid" : ""}`}>
      {options.map((o) => (
        <button
          type="button"
          key={o}
          aria-pressed={draft[field].includes(o)}
          className={draft[field].includes(o) ? "selected" : ""}
          onClick={() => toggle(field, o)}
        >
          <span className="choice-check">{draft[field].includes(o) && <Icon name="check" size={12} />}</span>
          {name(o)}
        </button>
      ))}
      {withNone && ["pain", "restrictions", "equipment"].includes(field) && (
        <button
          type="button"
          className={!draft[field].length ? "selected" : ""}
          aria-pressed={!draft[field].length}
          onClick={() => set(field, [])}
        >
          {c.noItems}
        </button>
      )}
    </div>
  );
  const answer = (field: "symptoms" | "recentChange" | "clearance", title: string) => (
    <label className="intake-question">
      <span>{title}</span>
      <select required value={draft[field]} onChange={(e) => set(field, e.target.value as never)}>
        <option value="">{c.choose}</option>
        <option value="yes">{c.yes}</option>
        <option value="no">{c.no}</option>
        {field === "clearance" && <option value="unsure">{c.unsure}</option>}
      </select>
    </label>
  );
  /** v7: a yes or no question as buttons (the v1 form keeps its selects). */
  const yesNo = (field: "symptoms" | "recentChange" | "clearance", title: string) => (
    <fieldset className="intake-yesno" data-field={field}>
      <legend>
        {title}
        {mark(field)}
      </legend>
      <div className="intake-choices">
        {SAFETY_ANSWERS[field].map((v) => (
          <button
            type="button"
            key={v}
            data-value={v}
            aria-pressed={draft[field] === v}
            className={draft[field] === v ? "selected" : ""}
            onClick={() => set(field, v as never)}
          >
            {c[v]}
          </button>
        ))}
      </div>
    </fieldset>
  );
  const kind = STEP_KINDS[step];
  const restricted = restrictYes || draft.restrictions.length > 0;
  const last = STEP_KINDS.length - 1;
  const body = intakeBody(draft);
  const aboutValid = draft.age >= 18 && draft.age <= 100 && draft.conditions.length > 0;
  const goalValid =
    draft.days.length > 0 && draft.days.length <= 4 && (draft.goal !== "sport" || !!draft.sport);
  const valid = V7_UI
    ? kind === "about"
      ? aboutValid && !!draft.mobility && v7ui?.fillReady === true && v7AboutReady(draft)
      : kind === "body"
        ? (!restricted || draft.restrictions.length > 0) &&
          draft.regions !== undefined &&
          draft.romFlags !== undefined &&
          !!draft.symptoms &&
          !!draft.recentChange &&
          !!draft.clearance
        : goalValid && validateIntake(body)
    : kind === "about"
      ? aboutValid
      : kind === "health"
        ? !!draft.mobility && !!draft.symptoms && !!draft.recentChange && !!draft.clearance
        : kind === "goal"
          ? goalValid
          : validateIntake(body);
  const submit = async () => {
    if (!valid) {
      setError("INTAKE_INVALID");
      return;
    }
    setError("");
    if (step < last) {
      setStep(step + 1);
      window.scrollTo(0, 0);
      return;
    }
    setBusy(true);
    try {
      onSaved(await api("/intake", body, "PUT"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmtDate(new Date(2026, 8, 6 + i), lang, { weekday: "short" }),
  );
  const stepName = (k: StepKind) =>
    V7_UI && IntakeV7StepName && (k === "about" || k === "body" || k === "goal") ? (
      <Suspense fallback={k === "body" ? null : c.steps[V1_STEP[k]]}>
        <IntakeV7StepName lang={lang} kind={k} />
      </Suspense>
    ) : (
      c.steps[V1_STEP[k as Exclude<StepKind, "body">]]
    );
  const v7Value = {
    sex: draft.sex,
    regions: draft.regions,
    walking: draft.walking,
    heightCm: draft.heightCm,
    romFlags: draft.romFlags,
  };
  const v7Part = {
    lang,
    context: { conditions: draft.conditions, mobility: draft.mobility },
    value: v7Value,
    ui: v7ui,
    onUi: setV7ui,
    onChange: (v: Partial<Intake>) => setDraft((d) => ({ ...d, ...v })),
  };
  const ageField = (
    <label className="field age-field">
      <span>
        {c.age}
        {mark("age")}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min="18"
        max="100"
        required
        value={draft.age || ""}
        onChange={(e) => set("age", Number(e.target.value))}
      />
    </label>
  );
  const conditionField = (
    <fieldset>
      <legend>
        {c.condition}
        {mark("conditions")}
      </legend>
      <p className="field-help">{c.conditionHelp}</p>
      {choices("conditions", conditions)}
    </fieldset>
  );
  /** v7: does a doctor limit the person's movement, yes or no; a yes shows the list to tick. */
  const restrictionField = (
    <fieldset className="intake-yesno" data-field="restrictions">
      <legend>
        {c.restriction}
        {mark("restrictions")}
      </legend>
      <div className="intake-choices">
        {SAFETY_ANSWERS.restrictions.map((v) => (
          <button
            type="button"
            key={v}
            data-value={v}
            aria-pressed={restricted === (v === "yes")}
            className={restricted === (v === "yes") ? "selected" : ""}
            onClick={() => {
              setRestrictYes(v === "yes");
              if (v === "no") set("restrictions", []);
            }}
          >
            {c[v]}
          </button>
        ))}
      </div>
      {restricted && (
        <div className="intake-restrictions">{choices("restrictions", restrictionOptions, false)}</div>
      )}
    </fieldset>
  );
  /** v7: how the person exercises, as four buttons. */
  const mobilityField = (
    <fieldset className="intake-mobility">
      <legend>
        {c.mobility}
        {mark("mobility")}
      </legend>
      <div className="intake-choices">
        {(["seated", "wheelchair", "standing", "bed"] as const).map((o) => (
          <button
            type="button"
            key={o}
            data-value={o}
            aria-pressed={draft.mobility === o}
            className={draft.mobility === o ? "selected" : ""}
            onClick={() => set("mobility", o)}
          >
            {name(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
  // The review: v7 shows its rows after mobility, and the body map replaces the v1 pain row.
  const reviewRows = (
    [
      [c.age, fmtNum(draft.age, lang)],
      [c.condition, draft.conditions.map(name).join("، ")],
      [c.mobility, name(draft.mobility)],
      [c.pain, draft.pain.map(name).join("، ") || c.noItems],
      [c.restriction, draft.restrictions.map(name).join("، ") || c.noItems],
      [c.symptoms, draft.symptoms === "yes" ? c.yes : c.no],
      [c.clearance, draft.clearance === "yes" ? c.yes : draft.clearance === "no" ? c.no : c.unsure],
      [
        c.goal,
        draft.goal === "sport" && draft.sport
          ? `${name("sport")}${lang === "ar" ? "، " : ", "}${sportById(draft.sport)?.name[lang]}`
          : name(draft.goal),
      ],
      [c.equipment, draft.equipment.map(name).join(lang === "ar" ? "، " : ", ") || c.noItems],
      [
        c.days,
        [...draft.days]
          .sort()
          .map((i) => weekdays[i])
          .join(" · "),
      ],
      [c.time, fmtTime(draft.time, lang)],
    ] as [string, string][]
  ).filter(([k]) => !V7_UI || k !== c.pain);
  const consentField = (
    <>
      <label className="consent">
        <input
          type="checkbox"
          required
          checked={draft.consent}
          onChange={(e) => set("consent", e.target.checked)}
        />
        <span>
          {V7_UI && IntakeV7Consent ? (
            <Suspense fallback={c.consent}>
              <IntakeV7Consent lang={lang} />
            </Suspense>
          ) : (
            c.consent
          )}
        </span>
      </label>
      {/* H5: the health data consent names where the data is stored, and links the notice (Q32 (1)). */}
      <p className="field-help intake-storage">
        {CHECK_DATA.boundary.storageNotice[lang]}{" "}
        <a href={privacyHref(lang)} target="_blank" rel="noreferrer">
          {t(lang, "privacy.link")}
        </a>
      </p>
    </>
  );
  const reviewRow = ([k, v]: [string, string]) => (
    <div key={k}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <div className="intake-layout">
      <aside className="intake-progress">
        <p className="section-kicker">{c.health}</p>
        <h1>{c.intakeTitle}</h1>
        <p>{c.intakeBody}</p>
        <ol>
          {STEP_KINDS.map((k, i) => (
            <li key={k} className={i === step ? "current" : i < step ? "done" : ""}>
              <button onClick={() => i < step && setStep(i)} disabled={i > step}>
                <b>{i < step ? <Icon name="check" size={16} /> : fmtNum(i + 1, lang)}</b>
                {stepName(k)}
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <form
        className="intake-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {reportInfo && (
          <aside className="report-banner">
            <div className="report-banner-head">
              <Icon name="check" size={16} />
              <b>{c.reportDone}</b>
              <button
                type="button"
                className="text-button"
                onClick={() => setReportInfo(null)}
                aria-label={lang === "ar" ? "إغلاق" : "Dismiss"}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {reportInfo.summary && <p>{reportInfo.summary}</p>}
            {(reportInfo.missing.length > 0 || reportInfo.questions.length > 0) && (
              <div className="report-missing">
                <b>{c.reportMissing}</b>
                <ul>
                  {reportInfo.questions.length
                    ? reportInfo.questions.map((q) => <li key={q}>{q}</li>)
                    : reportInfo.missing.map((f) => (
                        <li key={f}>
                          {(
                            {
                              age: c.age,
                              conditions: c.condition,
                              mobility: c.mobility,
                              support: c.support,
                              pain: c.pain,
                              restrictions: c.restriction,
                              symptoms: c.symptoms,
                              recentChange: c.recentChange,
                              medications: c.medications,
                            } as Record<string, string>
                          )[f] ?? f}
                        </li>
                      ))}
                </ul>
              </div>
            )}
          </aside>
        )}
        <p className="section-kicker">
          {fmtNum(step + 1, lang)} / {fmtNum(STEP_KINDS.length, lang)}
        </p>
        <h2>{stepName(kind)}</h2>
        {kind === "about" && V7_UI && IntakeV7About && (
          <>
            {/* D-035 item 5: the report reading is shown first, as a standout card. */}
            {initial === null && !reportInfo && (
              <ReportUpload lang={lang} onExtracted={applyExtraction} card />
            )}
            <Suspense fallback={null}>
              <IntakeV7About
                {...v7Part}
                age={ageField}
                conditionField={conditionField}
                mobilityField={mobilityField}
              />
            </Suspense>
          </>
        )}
        {kind === "about" && !V7_UI && (
          <>
            <label className="field age-field">
              <span>
                {c.age}
                {mark("age")}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="18"
                max="100"
                required
                value={draft.age || ""}
                onChange={(e) => set("age", Number(e.target.value))}
              />
            </label>
            <fieldset>
              <legend>
                {c.condition}
                {mark("conditions")}
              </legend>
              <p className="field-help">{c.conditionHelp}</p>
              {choices("conditions", conditions)}
            </fieldset>
            <label className="field">
              <span>
                {c.diagnosis} <small>{c.optional}</small>
                {mark("diagnosis")}
              </span>
              <textarea
                rows={3}
                maxLength={1200}
                value={draft.diagnosisNotes}
                onChange={(e) => set("diagnosisNotes", e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {c.medications} <small>{c.optional}</small>
                {mark("medications")}
              </span>
              <textarea
                rows={2}
                maxLength={1200}
                value={draft.medications}
                onChange={(e) => set("medications", e.target.value)}
              />
            </label>
            {/* C47: the questions come first; the report is a secondary link under them. */}
            {initial === null && !reportInfo && <ReportUpload lang={lang} onExtracted={applyExtraction} />}
          </>
        )}
        {kind === "health" && (
          <>
            <label className="field">
              <span>
                {c.mobility}
                {mark("mobility")}
              </span>
              <select
                required
                value={draft.mobility}
                onChange={(e) => set("mobility", e.target.value as never)}
              >
                <option value="">{c.choose}</option>
                {["seated", "wheelchair", "standing", "bed"].map((o) => (
                  <option key={o} value={o}>
                    {name(o)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{c.support}</span>
              <select value={draft.support} onChange={(e) => set("support", e.target.value as never)}>
                <option value="none">{c.noItems}</option>
                {["left", "right"].map((o) => (
                  <option key={o} value={o}>
                    {name(o)}
                  </option>
                ))}
              </select>
            </label>
            {!V7_UI && (
              <fieldset>
                <legend>
                  {c.pain}
                  {mark("pain")}
                </legend>
                {choices("pain", painOptions)}
              </fieldset>
            )}
            <fieldset>
              <legend>
                {c.restriction}
                {mark("restrictions")}
              </legend>
              {choices("restrictions", restrictionOptions)}
            </fieldset>
            {answer("symptoms", c.symptoms)}
            {answer("recentChange", c.recentChange)}
            {answer("clearance", c.clearance)}
          </>
        )}
        {kind === "body" && IntakeV7 && (
          <Suspense fallback={null}>
            <IntakeV7
              {...v7Part}
              report={reportRegions}
              earlierPain={initial && initial.regions === undefined ? initial.pain : []}
              showMissing={error === "INTAKE_INVALID"}
              safety={
                <>
                  {yesNo("symptoms", c.symptoms)}
                  {yesNo("clearance", c.clearance)}
                  {yesNo("recentChange", c.recentChange)}
                  {restrictionField}
                </>
              }
            />
          </Suspense>
        )}
        {kind === "goal" && (
          <>
            <GoalChoices
              lang={lang}
              goal={draft.goal}
              sport={draft.sport}
              mobility={draft.mobility}
              // A sport rides only with the sport goal.
              onGoal={(goal) =>
                setDraft((d) => ({ ...d, goal, sport: goal === "sport" ? d.sport : undefined }))
              }
              onSport={(sport) => set("sport", sport)}
            />
            <fieldset>
              <legend>{c.equipment}</legend>
              <p className="field-help">{c.equipmentHelp}</p>
              {choices("equipment", equipmentOptions)}
            </fieldset>
            <fieldset>
              <legend>{c.days}</legend>
              <div className="day-picker">
                {weekdays.map((day, i) => (
                  <button
                    type="button"
                    key={i}
                    aria-pressed={draft.days.includes(i)}
                    className={draft.days.includes(i) ? "selected" : ""}
                    onClick={() =>
                      set(
                        "days",
                        draft.days.includes(i)
                          ? draft.days.filter((x) => x !== i)
                          : draft.days.length < 4
                            ? [...draft.days, i]
                            : draft.days,
                      )
                    }
                  >
                    {day}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field-pair">
              <label className="field">
                <span>{c.time}</span>
                <input
                  type="time"
                  required
                  value={draft.time}
                  onChange={(e) => set("time", e.target.value)}
                />
              </label>
              <label className="field">
                <span>{c.duration}</span>
                <select
                  value={draft.sessionMinutes}
                  onChange={(e) => set("sessionMinutes", Number(e.target.value))}
                >
                  {[20, 30, 40].map((n) => (
                    <option value={n} key={n}>
                      {fmtNum(n, lang)} {c.minutes}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {V7_UI && consentField}
          </>
        )}
        {kind === "review" && (
          <>
            <h3>{c.reviewTitle}</h3>
            <p className="field-help">{c.reviewBody}</p>
            <dl className="intake-review">
              {reviewRows.slice(0, 3).map(reviewRow)}
              {IntakeV7Review && (
                <Suspense fallback={null}>
                  <IntakeV7Review lang={lang} value={v7Value} />
                </Suspense>
              )}
              {reviewRows.slice(3).map(reviewRow)}
            </dl>
            {consentField}
          </>
        )}
        {/* v7: the missing answers note leaves once the step is complete. */}
        {error && !(V7_UI && error === "INTAKE_INVALID" && valid) && (
          <p className="form-error" role="alert">
            {errorText(error, lang)}
          </p>
        )}
        <div className="intake-actions">
          <button className="cta" disabled={busy} type="submit">
            {busy ? (
              c.busy
            ) : step === last ? (
              nextCheck && IntakeV7NextCheck ? (
                <Suspense fallback={initial ? c.save : c.create}>
                  <IntakeV7NextCheck lang={lang} />
                </Suspense>
              ) : initial ? (
                c.save
              ) : (
                c.create
              )
            ) : (
              c.continue
            )}
            <Icon name="arrow" size={18} />
          </button>
          {step > 0 ? (
            <button type="button" className="ghost" onClick={() => setStep(step - 1)}>
              {c.back}
            </button>
          ) : (
            onCancel && (
              <button type="button" className="ghost" onClick={onCancel}>
                {c.back}
              </button>
            )
          )}
        </div>
      </form>
    </div>
  );
}
