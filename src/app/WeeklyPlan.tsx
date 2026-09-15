import { useEffect, useState } from 'react';
import { Plan } from '../medical/plan';
import { libraryById, WeeklyItem, WeeklyPlan } from '../medical/weekly';
import { EXERCISES } from '../exercises/defs';
import { Lang, fmtNum } from './i18n';
import { api } from './api';
import Icon from './Icon';

const copy = {
 ar: {
  title: 'خطتك الأسبوعية', ai: 'كتبها محرك عزم بالذكاء الاصطناعي على قواعد حالتك الطبية', engine: 'مبنية على قواعد حالتك الطبية',
  writing: 'يكتب محرك عزم خطتك الأسبوعية', writingBody: 'نختار من مكتبة عزم تمارين آمنة لحالتك الطبية، ونرتّبها على أيام أسبوعك.',
  failed: 'تعذّر تجهيز الخطة الأسبوعية الآن.', retry: 'أعد المحاولة',
  warmup: 'الإحماء', camera: 'التمرين بالكاميرا', extra: 'تمارين اليوم', cooldown: 'التهدئة', withCamera: 'بالكاميرا',
  sets: 'مجموعات', reps: 'تكرار', seconds: 'ثانية', why: 'لماذا هذه الخطة', tips: 'نصائح لأسبوعك', open: 'افتح خطتك الأسبوعية', exercises: 'تمارين',
 },
 en: {
  title: 'Your weekly plan', ai: 'Written by the Azm AI engine on the rules for your medical condition', engine: 'Built on the rules for your medical condition',
  writing: 'The Azm engine is writing your weekly plan', writingBody: 'Choosing exercises from the Azm library that are safe for your medical condition, and arranging them across your week.',
  failed: 'The weekly plan could not be prepared right now.', retry: 'Try again',
  warmup: 'Warm up', camera: 'Camera session', extra: 'Today’s exercises', cooldown: 'Cool down', withCamera: 'Camera',
  sets: 'sets', reps: 'reps', seconds: 'sec', why: 'Why this plan', tips: 'Tips for your week', open: 'Open your weekly plan', exercises: 'exercises',
 },
};

const weekday = (day: number, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { weekday: 'long' }).format(new Date(2026, 8, 6 + day));
const categoryIcon: Record<string, string> = { flexibility: 'spark', balance: 'rise', core: 'shield', upper_body: 'chair', lower_body: 'rise' };

function Item({ item, lang }: { item: WeeklyItem; lang: Lang }) {
 const k = copy[lang], ex = libraryById(item.id);
 if (!ex) return null;
 const digits = (s: string) => lang === 'ar' ? s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : s;
 const dose = item.holdSeconds ? `${fmtNum(item.sets, lang)} × ${fmtNum(item.holdSeconds, lang)} ${k.seconds}` : `${fmtNum(item.sets, lang)} ${k.sets} × ${fmtNum(item.reps ?? 8, lang)} ${k.reps}`;
 return <details className="weekly-item">
  <summary><span className="weekly-item-icon"><Icon name={categoryIcon[ex.category] ?? 'spark'} size={16}/></span><div><b>{ex.name[lang]}</b><small>{dose}</small></div><Icon name="arrow" size={14}/></summary>
  <div className="weekly-item-body">
   <p>{digits(ex.description[lang])}</p>
   <ol>{ex.steps[lang].map(s => <li key={s}>{digits(s)}</li>)}</ol>
   {item.note && <p className="weekly-note"><Icon name="info" size={14}/>{item.note[lang]}</p>}
  </div>
 </details>;
}

export default function WeeklyPlanView({ lang, plan, compact, onLoaded, onOpen }: { lang: Lang; plan: Plan; compact?: boolean; onLoaded: (w: WeeklyPlan) => void; onOpen?: () => void }) {
 const k = copy[lang];
 const weekly = plan.weekly;
 const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
 const today = new Date().getDay();
 const [dayIdx, setDayIdx] = useState(() => Math.max(0, plan.days.findIndex(d => d >= today)));

 useEffect(() => {
  if (plan.status !== 'ready' || weekly) return;
  let live = true;
  setError('');
  api<{ weekly: WeeklyPlan; version: number }>('/plan/weekly', {})
   .then(r => { if (live && r.version === plan.version) onLoaded(r.weekly); })
   .catch(e => { if (live) setError((e as Error).message); });
  return () => { live = false; };
 }, [plan.version, plan.status, !!weekly, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

 if (plan.status !== 'ready') return null;
 if (!weekly) return <section className="weekly-card weekly-loading" aria-live="polite">
  {error ? <><p className="form-error" role="alert">{k.failed}</p><button className="ghost" onClick={() => setAttempt(a => a + 1)}>{k.retry}</button></> : <>
   <div className="weekly-skel-head"><span className="report-spinner" aria-hidden/><div><b>{k.writing}</b><p>{k.writingBody}</p></div></div>
   <div className="weekly-skel" aria-hidden><i/><i/><i/></div>
  </>}
 </section>;

 const badge = <span className="weekly-badge"><Icon name="spark" size={13}/>{weekly.source === 'ai' ? k.ai : k.engine}</span>;
 const day = weekly.days[Math.min(dayIdx, weekly.days.length - 1)];
 if (compact) {
  const count = day.warmup.length + day.extra.length + day.cooldown.length + plan.exercises.length;
  return <section className="weekly-card compact">
   <div className="weekly-head">{badge}<h2>{k.title}</h2><p className="weekly-summary">{weekly.summary[lang]}</p></div>
   <div className="weekly-today"><b>{weekday(day.day, lang)} · {day.focus[lang]}</b><span>{fmtNum(count, lang)} {k.exercises}</span></div>
   <button className="ghost" onClick={onOpen}>{k.open}<Icon name="arrow" size={16}/></button>
  </section>;
 }

 return <section className="weekly-card">
  <div className="weekly-head">{badge}<h2>{k.title}</h2><p className="weekly-summary">{weekly.summary[lang]}</p></div>
  <div className="weekly-days" role="tablist">
   {weekly.days.map((d, i) => <button key={d.day} role="tab" aria-selected={i === dayIdx} className={i === dayIdx ? 'active' : ''} onClick={() => setDayIdx(i)}><span>{weekday(d.day, lang)}</span><small>{d.focus[lang]}</small></button>)}
  </div>
  <div className="weekly-day">
   <div className="weekly-block"><h3>{k.warmup}</h3>{day.warmup.map(i => <Item key={i.id} item={i} lang={lang}/>)}</div>
   <div className="weekly-block"><h3>{k.camera}</h3>
    {plan.exercises.map(e => <div key={e.exerciseId} className="weekly-item camera"><span className="weekly-item-icon"><Icon name="camera" size={16}/></span><div><b>{EXERCISES.find(x => x.id === e.exerciseId)?.name[lang]}</b><small>{fmtNum(e.sets, lang)} {k.sets} × {fmtNum(e.reps, lang)} {k.reps}</small></div><span className="weekly-tag">{k.withCamera}</span></div>)}
   </div>
   <div className="weekly-block"><h3>{k.extra}</h3>{day.extra.map(i => <Item key={i.id} item={i} lang={lang}/>)}</div>
   <div className="weekly-block"><h3>{k.cooldown}</h3>{day.cooldown.map(i => <Item key={i.id} item={i} lang={lang}/>)}</div>
  </div>
  <div className="weekly-foot">
   <div><h3>{k.why}</h3><ul>{weekly.why.map(w => <li key={w.en}>{w[lang]}</li>)}</ul></div>
   <div><h3>{k.tips}</h3><ul>{weekly.tips.map(w => <li key={w.en}>{w[lang]}</li>)}</ul></div>
  </div>
 </section>;
}
