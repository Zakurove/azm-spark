import { useState } from 'react';
import { Lang,fmtNum,pct } from './i18n';
import { RepMoment,ui } from './experience';
export default function RepReview({reps,lang,demo=false,compact=false}:{reps:RepMoment[];lang:Lang;demo?:boolean;compact?:boolean}){
 const [selected,setSelected]=useState<number|null>(null);const c=ui(lang);const active=selected===null?reps.length-1:Math.min(selected,reps.length-1);const rep=reps[active];
 const labels={valid:c.complete,compensated:c.adjust,partial:c.partial};
 return <section className={`rep-review ${compact?'compact':''}`}><div className="review-heading"><h3>{demo?c.demoTimeline:c.timeline}</h3><span>{fmtNum(reps.length,lang)}</span></div>{!reps.length?<p className="micro">{c.noneYet}</p>:<><div className="rep-timeline">{reps.map((r,i)=><button key={i} className={`${r.cls} ${active===i?'active':''}`} aria-pressed={active===i} aria-label={`${c.rep} ${fmtNum(i+1,lang)}: ${labels[r.cls]}`} onClick={()=>setSelected(i)}><span className="rep-stick" style={{height:`${12+Math.min(1,r.peakPct)*28}px`}}/><span>{fmtNum(i+1,lang)}</span></button>)}</div>{rep&&<div className="rep-detail"><span className={`rep-class ${rep.cls}`}>{labels[rep.cls]}</span><span>{fmtNum(Math.round(rep.durSec*10)/10,lang)} {c.seconds}</span><span>{pct(Math.min(1,rep.peakPct),lang)} {c.range}</span></div>}</>}</section>;
}
