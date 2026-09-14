import {useEffect,useState} from 'react';
import {Plan} from '../medical/plan';
import {Lang,fmtNum} from './i18n';
import {labels} from './platform-copy';
import {Preferences,RepMoment} from './experience';
import {SessionSummary} from '../engine/types';
import {EXERCISES} from '../exercises/defs';
import Session from './Session';
import Brand from './Brand';
import Icon from './Icon';
import {api} from './api';
export interface WorkoutRun {id:string;demo:boolean;plan:Plan;nextIndex?:number}
export default function Workout({run,lang,preferences,onPreferences,onExit}:{run:WorkoutRun;lang:Lang;preferences:Preferences;onPreferences:(p:Preferences)=>void;onExit:()=>void}){
 const c=labels(lang),sets=run.plan.exercises.flatMap(e=>Array.from({length:e.sets},(_,i)=>({...e,setNumber:i+1})));
 const [ready,setReady]=useState(false);
 const [index,setIndex]=useState(run.nextIndex??0),[stage,setStage]=useState<'warmup'|'set'|'rest'|'cooldown'|'done'>(run.nextIndex?'rest':'warmup');
 const [remaining,setRemaining]=useState(run.nextIndex?sets[Math.max(0,run.nextIndex-1)].restSeconds:run.plan.warmUpMinutes*60),[effort,setEffort]=useState<number|null>(null),[saving,setSaving]=useState(false);
 useEffect(()=>{if(stage==='set'||stage==='done')return;const end=Date.now()+remaining*1000;const timer=setInterval(()=>setRemaining(Math.max(0,Math.ceil((end-Date.now())/1000))),1000);return()=>clearInterval(timer);},[stage]); // timer does not restart on every tick
 const next=()=>{if(effort!==null&&effort>=8){setStage('done');return;}if(index+1>=sets.length){setRemaining(run.plan.coolDownMinutes*60);setStage('cooldown');}else{setRemaining(sets[index].restSeconds);setIndex(i=>i+1);setStage('rest');}};
 const save=async(summary:SessionSummary,moments:RepMoment[])=>{if(saving)return;setSaving(true);try{await api(`/workouts/${run.id}/sets`,{index,summary,moments});setEffort(summary.rpe??null);}finally{setSaving(false);}};
 if(stage==='set'){const p=sets[index];return <Session key={`${run.id}-${index}`} lang={lang} setup={p.setup} exerciseId={p.exerciseId} targetReps={p.reps} setNumber={p.setNumber} demo={run.demo} preferences={preferences} onPreferences={onPreferences} onExit={onExit} onRestart={()=>setStage('rest')} onDemo={onExit} onSave={save} onContinue={next}/>;}
 const title=stage==='warmup'?c.warmup:stage==='rest'?c.restTitle:stage==='cooldown'?c.cooldown:c.done;
 return <div className="workout-shell"><header className="portal-header"><Brand/><span>{run.demo?c.preview:c.program}</span><button className="text-button" onClick={onExit}>{c.exit}</button></header><main className="interval-page"><div className="interval-main"><p className="section-kicker">{c.set} {fmtNum(Math.min(index+1,sets.length),lang)} / {fmtNum(sets.length,lang)}</p><h1>{title}</h1><p>{stage==='warmup'?c.warmupBody:stage==='rest'?c.restBody:stage==='cooldown'?c.cooldownBody:run.demo?c.demoDone:c.doneBody}</p>{stage!=='done'&&<div className="interval-clock" role="timer" aria-label={title}><bdi>{fmtNum(Math.floor(remaining/60),lang)}:{fmtNum(remaining%60,lang).padStart(2,lang==='ar'?'٠':'0')}</bdi><span>{stage==='rest'?c.rest:c.minutes}</span></div>}{effort!==null&&effort>=8&&<p className="form-error">{lang==='ar'?'الجهد المُبلّغ مرتفع. انتهِ لليوم وخذ راحتك.':'Your reported effort was high. Finish for today and take time to rest.'}</p>}{stage==='warmup'&&!run.demo&&<label className="consent"><input type="checkbox" checked={ready} onChange={e=>setReady(e.target.checked)}/><span>{lang==='ar'?'لم تتغيّر حالتي منذ إجابات الملف الصحي، ولا توجد أعراض جديدة تمنعني من التمرين.':'My health has not changed since my profile answers, and I have no new symptoms preventing exercise.'}</span></label>}<button className="cta" disabled={(stage==='rest'&&remaining>0)||(stage==='warmup'&&!run.demo&&!ready)} onClick={()=>stage==='done'?onExit():stage==='cooldown'?setStage('done'):setStage('set')}>{stage==='done'?c.exit:stage==='cooldown'?c.finish:stage==='warmup'?c.ready:c.nextSet}<Icon name="arrow" size={18}/></button></div><aside className="workout-queue"><h2>{c.program}</h2>{sets.map((e,i)=><div key={i} className={i===index?'current':i<index?'done':''}><span>{i<index?<Icon name="check" size={16}/>:fmtNum(i+1,lang)}</span><div><strong>{EXERCISES.find(x=>x.id===e.exerciseId)?.name[lang]}</strong><small>{c.set} {fmtNum(e.setNumber,lang)} · {fmtNum(e.reps,lang)} {c.reps}</small></div></div>)}</aside></main></div>;
}
