import { useEffect, useState } from 'react';
import { T, Lang, fmtNum } from './i18n';
import { EXERCISES } from '../exercises/defs';
import { availableFor, copy, illustration, Position, readSessions, Setup, Support } from './product';
import Icon from './Icon';
import SessionScreen from './Session';

const qs = new URLSearchParams(location.search);
const initialSetup: Setup = { position: qs.get('profile') === 'wheelchair' ? 'wheelchair' : qs.get('ex') === 'sit_to_stand' ? 'rise' : 'chair', support: qs.get('profile') === 'hemiparesis_left' ? 'left' : qs.get('profile') === 'hemiparesis_right' ? 'right' : 'none' };
export default function App() {
 const [lang,setLang]=useState<Lang>(qs.get('lang')==='en'?'en':'ar');
 const [setup,setSetup]=useState<Setup>(initialSetup);
 const [exerciseId,setExercise]=useState(availableFor(initialSetup).find(e=>e.id===qs.get('ex'))?.id??availableFor(initialSetup)[0].id);
 const [step,setStep]=useState(0),[page,setPage]=useState<'practice'|'history'>('practice');
 const [session,setSession]=useState<{demo:boolean;key:number}|null>(qs.get('autostart')==='1'?{demo:qs.get('demo')!=='0',key:0}:null);
 const c=copy(lang), t=(k:keyof typeof T)=> (T[k] as {ar:string;en:string})[lang];
 useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';},[lang]);
 useEffect(()=>{window.scrollTo(0,0);},[step,page]);
 const def=EXERCISES.find(e=>e.id===exerciseId)!;
 const choosePosition=(position:Position)=>{const next={...setup,position};setSetup(next);if(!availableFor(next).some(e=>e.id===exerciseId))setExercise(availableFor(next)[0].id);};
 const begin=(demo:boolean)=>setSession({demo,key:Date.now()});
 if(session)return <SessionScreen key={session.key} lang={lang} setup={setup} exerciseId={exerciseId} demo={session.demo} onExit={()=>{setSession(null);setStep(2);}} onRestart={()=>begin(session.demo)} onDemo={()=>begin(true)}/>;
 const records=readSessions();
 return <div className="app-shell">
  <a className="skip-link" href="#main">{lang==='ar'?'انتقل إلى المحتوى':'Skip to content'}</a>
  <header className="app-header">
   <button className="brand" onClick={()=>{setPage('practice');setStep(0);}} aria-label={t('home')}><span className="brand-mark">ع</span><span className="brand-word">عَزم <bdi>SPARK</bdi></span></button>
   <nav aria-label={lang==='ar'?'التنقل الرئيسي':'Main navigation'}><button className={page==='practice'?'active':''} onClick={()=>setPage('practice')}>{c.practice}</button><button className={page==='history'?'active':''} onClick={()=>setPage('history')}>{c.history}</button></nav>
   <button className="language" onClick={()=>setLang(lang==='ar'?'en':'ar')}>{lang==='ar'?'English':'العربية'}</button>
  </header>
  <main id="main" className="product-main">
  {page==='practice'?<>
   <div className="journey" aria-label={lang==='ar'?'خطوات الإعداد':'Setup steps'}>{c.steps.map((label,i)=><button key={label} className={step===i?'current':step>i?'done':''} disabled={i>step} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}><span>{i<step?<Icon name="check" size={14}/>:fmtNum(i+1,lang)}</span>{label}</button>)}</div>
   <div className={`workspace setup-step-${step}`}>
    <section className="setup-content">
     <div className="eyebrow"><span/> {c.eyebrow}</div>
     <h1>{step===0?c.hero:step===1?c.exerciseTitle:c.readyTitle}</h1>
     <p className="lead">{step===0?c.intro:step===1?c.exerciseBody:c.readyBody}</p>
     {step===0?<>
      <fieldset><legend>{c.setupTitle}</legend><div className="position-options">{(['chair','wheelchair','rise'] as Position[]).map(pos=><button className={`position-option ${setup.position===pos?'selected':''}`} key={pos} onClick={()=>choosePosition(pos)} aria-pressed={setup.position===pos}><Icon name={pos} size={25}/><span><strong>{c[pos]}</strong><small>{c[`${pos}Note`]}</small></span><span className="selection-dot">{setup.position===pos&&<Icon name="check" size={12}/>}</span></button>)}</div></fieldset>
      {setup.position!=='rise'&&<fieldset className="support-field"><legend>{c.supportTitle}</legend><div className="segmented">{(['none','left','right'] as Support[]).map(s=><button key={s} aria-pressed={setup.support===s} className={setup.support===s?'selected':''} onClick={()=>setSetup({...setup,support:s})}>{c[s]}</button>)}</div><p className="micro">{c.supportBody}</p></fieldset>}
      <button className="cta next" onClick={()=>setStep(1)}>{c.next}<Icon name="arrow" size={19}/></button>
     </>:step===1?<>
      <div className="exercise-list">{availableFor(setup).map((e,i)=><button key={e.id} aria-pressed={exerciseId===e.id} className={`exercise-option ${exerciseId===e.id?'selected':''}`} onClick={()=>setExercise(e.id)}><span className="exercise-index">{fmtNum(i+1,lang).padStart(lang==='en'?2:1,'0')}</span><span><strong>{e.name[lang]}</strong><small>{e.description[lang]}</small><em>{fmtNum(e.targetReps,lang)} {t('reps')}</em></span><span className="selection-dot">{exerciseId===e.id&&<Icon name="check" size={12}/>}</span></button>)}</div>
      <div className="actions"><button className="cta" onClick={()=>setStep(2)}>{c.ready}<Icon name="arrow" size={19}/></button><button className="text-button" onClick={()=>setStep(0)}>{c.back}</button></div>
     </>:<>
      <div className="ready-facts"><div><span className="fact-icon"><Icon name="camera"/></span><div><h3>{t('framingTitle')}</h3><p>{def.camera[lang]}</p></div></div><div><span className="fact-icon"><Icon name="spark"/></span><div><h3>{c.calibration}</h3><p>{t('calibBody')}</p></div></div></div>
      <button className="cta camera-start" onClick={()=>begin(false)}><Icon name="camera" size={21}/>{c.cameraAction}</button><p className="micro">{c.cameraBody}</p>
      <div className="demo-entry"><button onClick={()=>begin(true)} className="text-button"><Icon name="play" size={16}/>{c.demoAction}</button><p>{c.demoBody}</p></div>
      <button className="text-button back" onClick={()=>setStep(1)}>{c.back}</button>
     </>}
    </section>
    <aside className="guide-panel">
      <div className="guide-top"><span>{c.guide}</span><span className="guide-position"><Icon name={setup.position} size={16}/>{c[setup.position]}</span></div>
      <img className="athlete-image" src={illustration(setup,exerciseId)} alt={`${c.illustration}: ${def.name[lang]}`} />
      <div className="guide-description"><span className="guide-number">{fmtNum(def.targetReps,lang)}<small>{t('reps')}</small></span><div><h2>{def.name[lang]}</h2><p>{step===2?def.description[lang]:t('yourBaseline')}</p></div></div>
      <p className="illustration-label">{c.illustration}</p>
    </aside>
   </div>
   <div className="trust-row"><div><Icon name="shield"/><strong>{c.privacyTitle}</strong><span>{t('privacy')}</span></div><div><Icon name="spark"/><strong>{t('yourBaseline')}</strong></div><div><span className="arabic-glyph">ض</span><strong>{t('arabicFirst')}</strong></div></div>
  </>:<section className="history-page"><div className="eyebrow">{c.local}</div><h1>{c.history}</h1>{records.length===0?<div className="empty-history"><Icon name="clock" size={38}/><h2>{c.noHistory}</h2><p>{c.noHistoryBody}</p><button className="cta" onClick={()=>{setPage('practice');setStep(0);}}>{c.emptyAction}</button></div>:<div className="history-list">{records.map((r,i)=><article key={`${r.endedAt}-${i}`}><span className="history-symbol"><Icon name="check"/></span><div><h2>{EXERCISES.find(e=>e.id===r.exerciseId)?.name[lang]}</h2><p>{new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(r.endedAt)}</p></div><div><strong>{fmtNum(r.reps.valid,lang)}</strong><span>{t('validReps')}</span></div><div><strong>{r.romPct==null?'—':`${fmtNum(r.romPct,lang)}%`}</strong><span>{t('bestRom')}</span></div></article>)}</div>}</section>}
  </main>
  <footer className="app-footer"><span>{t('disclaimer')}</span><bdi>AZM SPARK</bdi></footer>
 </div>;
}
