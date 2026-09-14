import { useState } from 'react';
import { Lang,fmtNum,T } from './i18n';
import { copy,SavedSession } from './product';
import { ui,insight } from './experience';
import { EXERCISES } from '../exercises/defs';
import RepReview from './RepReview';
import Icon from './Icon';
export function sessionCsv(records:SavedSession[]){
 const rows=[['date','exercise','completed_reps','without_flags','with_flags','shorter_range','best_range_pct','effort_0_10'],...records.map(r=>[new Date(r.endedAt).toISOString(),r.exerciseId,r.reps.valid+r.reps.compensated,r.reps.valid,r.reps.compensated,r.reps.partial,r.romPct??'',r.rpe??''])];
 return rows.map(row=>row.join(',')).join('\r\n');
}
export default function History({lang,records,onStart}:{lang:Lang;records:SavedSession[];onStart:()=>void}){
 const [expanded,setExpanded]=useState<number|null>(null);const c=copy(lang),x=ui(lang);const completed=records.reduce((n,r)=>n+r.reps.valid+r.reps.compensated,0);
 const minutes=records.reduce((n,r)=>n+Math.max(0,r.endedAt-r.startedAt)/60000,0);
 const download=()=>{const url=URL.createObjectURL(new Blob([sessionCsv(records)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='azm-sessions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section className="history-page"><div className="history-title"><h1>{c.history}</h1>{records.length>0&&<button className="ghost" onClick={download}><Icon name="download" size={18}/>{x.export}</button>}</div>{records.length===0?<div className="empty-history"><Icon name="clock" size={38}/><h2>{c.noHistory}</h2><p>{c.noHistoryBody}</p><button className="cta" onClick={onStart}>{c.emptyAction}</button></div>:<>
 <div className="history-stats">{[[records.length,x.sessions],[completed,x.completed],[Math.round(minutes),x.minutes]].map(([n,label])=><div key={label}><span>{label}</span><strong>{fmtNum(Number(n),lang)}</strong></div>)}</div>
 <div className="history-chart"><div><h2>{x.recent}</h2><p>{x.completed}</p></div><div className="session-bars">{records.slice(0,7).reverse().map((r,i)=><div key={i}><b>{fmtNum(r.reps.valid+r.reps.compensated,lang)}</b><span style={{height:`${8+70*(r.reps.valid+r.reps.compensated)/Math.max(1,...records.slice(0,7).map(s=>s.reps.valid+s.reps.compensated))}px`}}/><small>{new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{month:'short',day:'numeric'}).format(r.endedAt)}</small></div>)}</div></div>
 <div className="history-list">{records.map((r,i)=><div className="history-record" key={`${r.endedAt}-${i}`}><button className="history-record-button" aria-expanded={expanded===i} onClick={()=>setExpanded(expanded===i?null:i)}><span className="history-symbol"><Icon name="check"/></span><span className="history-record-title"><strong>{EXERCISES.find(e=>e.id===r.exerciseId)?.name[lang]}</strong><small>{new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(r.endedAt)}</small></span><span><b>{fmtNum(r.reps.valid+r.reps.compensated,lang)}</b><small>{x.completed}</small></span><Icon name="arrow" size={18}/></button>{expanded===i&&<div className="history-detail"><p>{insight(r.reps,lang)}</p><div className="record-metrics"><span>{T.validReps[lang]}: {fmtNum(r.reps.valid,lang)}</span><span>{T.compReps[lang]}: {fmtNum(r.reps.compensated,lang)}</span><span>{T.partialReps[lang]}: {fmtNum(r.reps.partial,lang)}</span><span>{T.rpeLabel[lang]}: {r.rpe==null?'—':fmtNum(r.rpe,lang)}</span></div>{r.moments&&<RepReview reps={r.moments} lang={lang}/>}</div>}</div>)}</div><p className="micro history-export-note">{x.exportNote}</p>
 </>}</section>;
}
