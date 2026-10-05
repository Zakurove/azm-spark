import { useEffect, useState } from "react";
import { Plan } from "../medical/plan";
import { libraryById, stepsOf, summaryText, WeeklyItem, WeeklyPlan } from "../medical/weekly";
import { V7_UI } from "./v7flag";
import { EXERCISES } from "../exercises/defs";
import { Lang, fmtDate, fmtNum } from "./i18n";
import { api } from "./api";
import Icon from "./Icon";
import ExerciseArt from "./ExerciseArt";
import { guidedCopy } from "./guided-copy";
import { cardKind } from "../medical/session";
import { doseText } from "./weekly-dose";

const copy = {
  ar: {
    title: "خطتك الأسبوعية",
    ai: "كتبها محرك عزم بالذكاء الاصطناعي على قواعد حالتك الطبية",
    engine: "مبنية على قواعد حالتك الطبية",
    writing: "يكتب محرك عزم خطتك الأسبوعية",
    writingBody: "نختار من مكتبة عزم تمارين آمنة لحالتك الطبية، ونرتّبها على أيام أسبوعك.",
    failed: "تعذّر تجهيز الخطة الأسبوعية الآن.",
    retry: "أعد المحاولة",
    warmup: "الإحماء",
    camera: "التمرين بالكاميرا",
    extra: "تمارين اليوم",
    cooldown: "التهدئة",
    withCamera: "بالكاميرا",
    tips: "نصائح لأسبوعك",
    fromResults: "من نتائجك",
    seeResult: "اعرض النتيجة",
  },
  en: {
    title: "Your weekly plan",
    ai: "Written by the Azm AI engine on the rules for your medical condition",
    engine: "Built on the rules for your medical condition",
    writing: "The Azm engine is writing your weekly plan",
    writingBody:
      "Choosing exercises from the Azm library that are safe for your medical condition, and arranging them across your week.",
    failed: "The weekly plan could not be prepared right now.",
    retry: "Try again",
    warmup: "Warm up",
    camera: "Camera session",
    extra: "Today’s exercises",
    cooldown: "Cool down",
    withCamera: "Camera",
    tips: "Tips for your week",
    fromResults: "From your results",
    seeResult: "See the result",
  },
};

/** The mark of an exercise the findings chose: gold, beside its dose (v7, E3). */
const FROM_RESULTS = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  width: "fit-content",
  marginTop: 4,
  color: "#6f540c",
  background: "#fdf4d6",
} as const;

/** The way to the result behind it: the purple of the person's own marks. */
const RESULT_LINK = { color: "#4f3c7c", fontWeight: 800, textUnderlineOffset: 4 } as const;

const weekday = (day: number, lang: Lang) => fmtDate(new Date(2026, 8, 6 + day), lang, { weekday: "long" });
/**
 * A weekly plan item as the guided card it becomes in the session (booth v2, D): its glyph, its dose
 * (a timer for a hold, a tap counter for reps), and inside, the description and the numbered steps.
 * v7 (contract 1.2, E3): an exercise the findings chose is marked «من نتائجك» and says why inside, in
 * one line, with the way to the result behind it (the findings page, VITE_V7=1 builds); its steps name
 * the hold its dose resolved.
 */
function Item({ item, lang, findings }: { item: WeeklyItem; lang: Lang; findings?: string | null }) {
  const g = guidedCopy(lang),
    k = copy[lang],
    ex = libraryById(item.id);
  if (!ex) return null;
  const n = (v: number) => fmtNum(v, lang);
  const digits = (s: string) => (lang === "ar" ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : s);
  const timer = cardKind(item) === "timer";
  const dose = doseText(item, lang);
  const why = item.why?.[lang];
  // The result behind it: a range finding or the walk (a region or wheelchair reason is no result).
  const result = (item.reasonRefs ?? []).some((r) => r.kind === "rom" || r.kind === "gait");
  return (
    <details className="weekly-item" {...(why ? { "data-from-results": "" } : {})}>
      <summary>
        <ExerciseArt category={ex.category} size="row" />
        <div>
          <b>{ex.name[lang]}</b>
          <small className="weekly-dose">
            <Icon name={timer ? "clock" : "tap"} size={13} />
            {dose}
          </small>
          {why && (
            <small className="weekly-tag" style={FROM_RESULTS}>
              <Icon name="spark" size={12} />
              {k.fromResults}
            </small>
          )}
        </div>
        <Icon name="arrow" size={14} />
      </summary>
      <div className="weekly-item-body">
        {why && (
          <p className="weekly-note weekly-why">
            <Icon name="spark" size={14} />
            <span>
              {why}
              {V7_UI && result && (
                <>
                  {" "}
                  <a href={`/?findings=1${findings ? `&check=${findings}` : ""}`} style={RESULT_LINK}>
                    {k.seeResult}
                  </a>
                </>
              )}
            </span>
          </p>
        )}
        <p>{digits(ex.description[lang])}</p>
        <ol className="weekly-steps">
          {stepsOf(ex, item, lang).map((s, i) => (
            <li key={s}>
              <span aria-hidden="true">{n(i + 1)}</span>
              {digits(s)}
            </li>
          ))}
        </ol>
        {item.note && (
          <p className="weekly-note">
            <Icon name="info" size={14} />
            {item.note[lang]}
          </p>
        )}
        <p className="weekly-guided">
          <Icon name="spark" size={13} />
          {g.guided}
          {" · "}
          {timer ? g.timer : g.counter}
        </p>
      </div>
    </details>
  );
}

export default function WeeklyPlanView({
  lang,
  plan,
  onLoaded,
}: {
  lang: Lang;
  plan: Plan;
  onLoaded: (w: WeeklyPlan) => void;
}) {
  const k = copy[lang];
  const weekly = plan.weekly;
  const [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const today = new Date().getDay();
  const [dayIdx, setDayIdx] = useState(() =>
    Math.max(
      0,
      plan.days.findIndex((d) => d >= today),
    ),
  );

  useEffect(() => {
    if (plan.status !== "ready" || weekly) return;
    let live = true;
    setError("");
    api<{ weekly: WeeklyPlan; version: number }>("/plan/weekly", {})
      .then((r) => {
        if (live && r.version === plan.version) onLoaded(r.weekly);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [plan.version, plan.status, !!weekly, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (plan.status !== "ready") return null;
  if (!weekly)
    return (
      <section className="weekly-card weekly-loading" aria-live="polite">
        {error ? (
          <>
            <p className="form-error" role="alert">
              {k.failed}
            </p>
            <button className="ghost" onClick={() => setAttempt((a) => a + 1)}>
              {k.retry}
            </button>
          </>
        ) : (
          <>
            <div className="weekly-skel-head">
              <span className="report-spinner" aria-hidden />
              <div>
                <b>{k.writing}</b>
                <p>{k.writingBody}</p>
              </div>
            </div>
            <div className="weekly-skel" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          </>
        )}
      </section>
    );

  const badge = (
    <span className="weekly-badge">
      <Icon name="spark" size={13} />
      {weekly.source === "ai" ? k.ai : k.engine}
    </span>
  );
  const day = weekly.days[Math.min(dayIdx, weekly.days.length - 1)];
  // v7: the focus check a week built from the findings follows (its exercises link to its results).
  const findingsCheck = weekly.findings?.checkId ?? null;
  return (
    <section className="weekly-card">
      <div className="weekly-head">
        {badge}
        <h2>{k.title}</h2>
        <p className="weekly-summary">{summaryText(weekly.summary, lang)}</p>
      </div>
      <div className="weekly-days" role="tablist">
        {weekly.days.map((d, i) => (
          <button
            key={d.day}
            role="tab"
            aria-selected={i === dayIdx}
            className={i === dayIdx ? "active" : ""}
            onClick={() => setDayIdx(i)}
          >
            <span>{weekday(d.day, lang)}</span>
            <small>{d.focus[lang]}</small>
          </button>
        ))}
      </div>
      <div className="weekly-day">
        <div className="weekly-block">
          <h3>{k.warmup}</h3>
          {day.warmup.map((i) => (
            <Item key={i.id} item={i} lang={lang} findings={findingsCheck} />
          ))}
        </div>
        {/* Booth v2 (D): a program with no camera movement is guided cards alone. */}
        {plan.exercises.length > 0 && (
          <div className="weekly-block">
            <h3>{k.camera}</h3>
            {plan.exercises.map((e) => (
              <div key={e.exerciseId} className="weekly-item camera">
                <span className="weekly-item-icon">
                  <Icon name="camera" size={16} />
                </span>
                <div>
                  <b>{EXERCISES.find((x) => x.id === e.exerciseId)?.name[lang]}</b>
                  <small>{guidedCopy(lang).cameraDose(e.sets, e.reps, (v) => fmtNum(v, lang))}</small>
                </div>
                <span className="weekly-tag">{k.withCamera}</span>
              </div>
            ))}
          </div>
        )}
        <div className="weekly-block">
          <h3>{k.extra}</h3>
          {day.extra.map((i) => (
            <Item key={i.id} item={i} lang={lang} findings={findingsCheck} />
          ))}
        </div>
        <div className="weekly-block">
          <h3>{k.cooldown}</h3>
          {day.cooldown.map((i) => (
            <Item key={i.id} item={i} lang={lang} findings={findingsCheck} />
          ))}
        </div>
      </div>
      {/* Booth v2 (B7): the Program page says why in two short lines of its own (plan-notes), so the
          week shows its tips only; the plan's reasons stay in the data for the booth. */}
      <div className="weekly-foot">
        <div>
          <h3>{k.tips}</h3>
          <ul>
            {weekly.tips.map((w) => (
              <li key={w.en}>{w[lang]}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
