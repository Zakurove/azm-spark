import { useEffect, useState } from "react";
import { Plan } from "../medical/plan";
import { libraryById, summaryText, WeeklyItem, WeeklyPlan } from "../medical/weekly";
import { EXERCISES } from "../exercises/defs";
import { Lang, fmtDate, fmtNum } from "./i18n";
import { api } from "./api";
import Icon from "./Icon";
import ExerciseArt from "./ExerciseArt";
import { guidedCopy } from "./guided-copy";
import { cardKind } from "../medical/session";

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
  },
};

const weekday = (day: number, lang: Lang) => fmtDate(new Date(2026, 8, 6 + day), lang, { weekday: "long" });
/**
 * A weekly plan item as the guided card it becomes in the session (booth v2, D): its glyph, its dose
 * (a timer for a hold, a tap counter for reps), and inside, the description and the numbered steps.
 */
function Item({ item, lang }: { item: WeeklyItem; lang: Lang }) {
  const g = guidedCopy(lang),
    ex = libraryById(item.id);
  if (!ex) return null;
  const n = (v: number) => fmtNum(v, lang);
  const digits = (s: string) => (lang === "ar" ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : s);
  const timer = cardKind(item) === "timer";
  const dose = timer
    ? g.doseHold(item.sets, item.holdSeconds ?? 0, n)
    : g.doseReps(item.sets, item.reps ?? 8, n);
  return (
    <details className="weekly-item">
      <summary>
        <ExerciseArt category={ex.category} size="row" />
        <div>
          <b>{ex.name[lang]}</b>
          <small className="weekly-dose">
            <Icon name={timer ? "clock" : "tap"} size={13} />
            {dose}
          </small>
        </div>
        <Icon name="arrow" size={14} />
      </summary>
      <div className="weekly-item-body">
        <p>{digits(ex.description[lang])}</p>
        <ol className="weekly-steps">
          {ex.steps[lang].map((s, i) => (
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
            <Item key={i.id} item={i} lang={lang} />
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
            <Item key={i.id} item={i} lang={lang} />
          ))}
        </div>
        <div className="weekly-block">
          <h3>{k.cooldown}</h3>
          {day.cooldown.map((i) => (
            <Item key={i.id} item={i} lang={lang} />
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
