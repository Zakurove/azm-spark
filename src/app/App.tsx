import {useEffect,useState} from 'react';
import {Lang,fmtNum,fmtTime} from './i18n';
import {labels,optionNames,reasonText,errorText} from './platform-copy';
import {api,AccountState} from './api';
import {Intake,Plan} from '../medical/plan';
import {Preferences,readPreferences,savePreferences} from './experience';
import {EXERCISES} from '../exercises/defs';
import {SavedSession,Setup} from './product';
import Brand from './Brand';
import Landing from './Landing';
import Auth from './Auth';
import TryCamera from './TryCamera';
import WeeklyPlanView from './WeeklyPlan';
import {WeeklyPlan} from '../medical/weekly';
import IntakeForm from './IntakeForm';
import Workout,{WorkoutRun} from './Workout';
import Session from './Session';
import History from './History';
import CoachSettings from './CoachSettings';
import Icon from './Icon';
const qs=new URLSearchParams(location.search);
export default function App(){
 const [lang,setLang]=useState<Lang>(qs.get('lang')==='en'?'en':'ar'),[account,setAccount]=useState<AccountState|null>(null),[loading,setLoading]=useState(true),[page,setPage]=useState<'today'|'program'|'health'|'history'>('today'),[editing,setEditing]=useState(false),[error,setError]=useState('');
 const [preferences,setPreferences]=useState(readPreferences),[settings,setSettings]=useState(false),[records,setRecords]=useState<SavedSession[]>([]),[run,setRun]=useState<WorkoutRun|null>(null),[busy,setBusy]=useState(false),[demo,setDemo]=useState(qs.get('demo')==='1'&&qs.get('autostart')==='1'),[authView,setAuthView]=useState(qs.get('app')==='1'),[authRegister,setAuthRegister]=useState(false),[tryCam,setTryCam]=useState(qs.get('try')==='1');
 const c=labels(lang);const updatePreferences=(p:Preferences)=>{setPreferences(p);savePreferences(p);};
 useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';},[lang]);
 useEffect(()=>{let active=true;api<AccountState>('/auth/me').then(s=>{if(active)setAccount(s);}).catch(()=>{}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 useEffect(()=>{if(account&&!run)api<{records:SavedSession[]}>('/sessions').then(x=>setRecords(x.records)).catch(()=>setRecords([]));},[account,run]);
 useEffect(()=>{window.scrollTo(0,0);},[page,editing,run]);
 const onWeekly=(w:WeeklyPlan)=>setAccount(a=>a&&a.plan?{...a,plan:{...a.plan,weekly:w}}:a);
 const onSaved=(s:{intake:Intake;plan:Plan})=>{setAccount(a=>a?{...a,...s}:null);setEditing(false);setPage('program');};
 const start=async(isDemo:boolean)=>{setBusy(true);setError('');try{setRun(await api<WorkoutRun>('/workouts',{version:account?.plan?.version,demo:isDemo}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 if(demo){const ex=EXERCISES.find(e=>e.id===qs.get('ex'))??EXERCISES[0];const setup:Setup={position:ex.id==='sit_to_stand'?'rise':qs.get('profile')==='wheelchair'?'wheelchair':'chair',support:qs.get('profile')==='hemiparesis_right'?'right':qs.get('profile')==='hemiparesis_left'?'left':'none'};return <Session lang={lang} setup={setup} exerciseId={ex.id} demo preferences={preferences} onPreferences={updatePreferences} onExit={()=>{setDemo(false);history.replaceState({},'','/');}} onRestart={()=>{setDemo(false);setTimeout(()=>setDemo(true),0);}} onDemo={()=>{}}/>;}
 if(tryCam)return <TryCamera lang={lang} onLanguage={()=>setLang(lang==='ar'?'en':'ar')} preferences={preferences} onPreferences={updatePreferences} onExit={()=>{setTryCam(false);history.replaceState({},'','/');}} onSimulate={()=>{setTryCam(false);setDemo(true);}} onRegister={()=>{setTryCam(false);setAuthRegister(true);setAuthView(true);history.replaceState({},'','/');}}/>;
 if(loading)return <div className="portal-loading"><Brand/><p>{c.loading}</p></div>;
 if(!account&&!authView)return <Landing lang={lang} onLanguage={()=>setLang(lang==='ar'?'en':'ar')} onEnter={register=>{setAuthRegister(register===true);setAuthView(true);}} onDemo={()=>setTryCam(true)}/>;
 if(!account)return <Auth lang={lang} onLanguage={()=>setLang(lang==='ar'?'en':'ar')} onSuccess={setAccount} onDemo={()=>setTryCam(true)} initialRegister={authRegister} onBack={()=>{setAuthView(false);history.replaceState({},'','/');}}/>;
 if(run)return <Workout run={run} lang={lang} preferences={preferences} onPreferences={updatePreferences} onExit={()=>setRun(null)}/>;
 const h=account.intake,p=account.plan;const intake=!h||editing;
 const weekdays=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return d;});
 const upcoming=weekdays.find(d=>p?.days.includes(d.getDay()))??weekdays[0];
 const reason=(key:string)=>reasonText[key]?.[lang]??key;
 const planDetails=p&&<><div className="plan-measures"><div><b>{fmtNum(p.days.length,lang)}</b><span>{c.session} / {lang==='ar'?'أسبوع':'week'}</span></div><div><b>{fmtNum(p.estimatedMinutes,lang)}</b><span>{c.minutes}</span></div><div><b>{fmtNum(p.exercises.reduce((s,e)=>s+e.sets,0),lang)}</b><span>{c.sets}</span></div></div><div className="prescriptions">{p.exercises.map((e,i)=>{const def=EXERCISES.find(x=>x.id===e.exerciseId)!;return <article className="prescription" key={e.exerciseId}><span className="prescription-number">{fmtNum(i+1,lang)}</span><div><h3>{def.name[lang]}</h3><p>{reason(e.reason)}</p><div className="dose"><b>{fmtNum(e.sets,lang)} {c.sets}</b><span>×</span><b>{fmtNum(e.reps,lang)} {c.reps}</b><span>·</span><span>{fmtNum(e.restSeconds,lang)} {c.seconds} {c.rest}</span></div></div><Icon name={e.setup.position} size={29}/></article>;})}</div></>;
 return <div className="portal-shell"><aside className="portal-sidebar"><button className="logo-link" onClick={()=>setPage('today')}><Brand/></button><nav>{(['today','program','health','history'] as const).map((key,i)=><button key={key} className={page===key?'active':''} onClick={()=>{setPage(key);setEditing(false);}}><Icon name={['spark','calendar','health','clock'][i]} size={20}/>{c[key]}</button>)}</nav><div className="sidebar-account"><span className="account-avatar">{account.user.name.slice(0,1)}</span><div><strong>{account.user.name}</strong><small>{account.user.email}</small></div></div><button className="logout" onClick={async()=>{try{await api('/auth/logout',{});setAccount(null);setRecords([]);setAuthRegister(false);}catch{setError('LOGOUT');}}}><Icon name="logout" size={18}/>{c.logout}</button></aside>
 <div className="portal-content"><header className="portal-topbar"><span>{c[page]}</span><div><button className="icon-button" onClick={()=>setSettings(true)} aria-label={c.neural}><Icon name="settings" size={19}/></button><button className="language" onClick={()=>setLang(lang==='ar'?'en':'ar')}>{lang==='ar'?'English':'العربية'}</button></div></header><main className="portal-main">
 {intake?<IntakeForm lang={lang} initial={h} onSaved={onSaved} onCancel={h?()=>setEditing(false):undefined}/>:<>
 <div className="page-heading"><div><p className="section-kicker">{page==='today'?`${c.welcome}، ${account.user.name}`:c.reported}</p><h1>{page==='today'?(lang==='ar'?'خطوتك القادمة تبدأ هنا.':'Your next move starts here.'):c[page]}</h1></div>{page!=='history'&&<button className="ghost" onClick={()=>{setPage('health');setEditing(true);}}><Icon name="health" size={17}/>{c.edit}</button>}</div>
 {error&&<p className="form-error" role="alert">{error==='LOGOUT'?c.signOutError:errorText(error,lang)}</p>}
 {(page==='today'||page==='program')&&p&&<>
 {p.status==='review'?<section className="medical-review"><span className="review-icon"><Icon name="health" size={30}/></span><h2>{c.planReview}</h2><p>{c.planReviewBody}</p><ul>{p.reasons.map(r=><li key={r}>{reason(r)}</li>)}</ul><button className="cta" onClick={()=>setEditing(true)}>{c.edit}<Icon name="arrow" size={17}/></button></section>:<>
 {page==='today'&&<section className="next-workout"><div><p className="section-kicker">{c.nextSession} · {new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{calendar:'gregory',weekday:'long',day:'numeric',month:'long'}).format(upcoming)}</p><h2>{optionNames[h.goal]?.[lang]}</h2><p>{h.conditions.map(v=>optionNames[v]?.[lang]).join(' · ')}</p><div className="hero-dose"><span>{fmtNum(p.exercises.length,lang)} {lang==='ar'?'حركات':'movements'}</span><span>{fmtNum(p.estimatedMinutes,lang)} {c.minutes}</span><span><bdi>{fmtTime(p.time,lang)}</bdi></span></div><button className="cta" onClick={()=>void start(false)} disabled={busy}>{busy?c.busy:c.start}<Icon name="play" size={17}/></button><button className="hero-preview" onClick={()=>void start(true)} disabled={busy}>{c.preview}</button></div><div className="workout-art"><img src={h.mobility==='wheelchair'?'/illustrations/wheelchair-press.png':h.mobility==='standing'?'/illustrations/standing.png':'/illustrations/chair-press.png'} alt={lang==='ar'?'رسم توضيحي للتمرين':'Exercise illustration'}/></div></section>}
 {page==='today'&&<WeeklyPlanView lang={lang} plan={p} compact onLoaded={onWeekly} onOpen={()=>setPage('program')}/>}<section className="schedule-card"><div className="card-heading"><h2>{c.schedule}</h2><span><bdi>{fmtTime(p.time,lang)}</bdi></span></div><div className="week-strip">{weekdays.map((d,i)=>{const active=p.days.includes(d.getDay());return <div className={`${active?'training-day':''} ${i===0?'current-day':''}`} key={i}><span>{new Intl.DateTimeFormat(lang==='ar'?'ar-SA':'en-GB',{weekday:'short'}).format(d)}</span><b>{fmtNum(d.getDate(),lang)}</b><small>{active?c.workoutDay:c.restDay}</small>{active&&<i/>}</div>;})}</div></section>
 <section className="plan-card"><div className="card-heading"><h2>{c.program}</h2><span>{c.planReady}</span></div>{planDetails}<div className="preparation-row"><span><Icon name="clock" size={17}/>{c.warmup}: {fmtNum(p.warmUpMinutes,lang)} {c.minutes}</span><span>{c.cooldown}: {fmtNum(p.coolDownMinutes,lang)} {c.minutes}</span></div>{page==='program'&&<div className="plan-actions"><button className="cta" disabled={busy} onClick={()=>void start(false)}>{c.start}<Icon name="play" size={16}/></button><button className="ghost" disabled={busy} onClick={()=>void start(true)}>{c.preview}</button></div>}</section>{page==='program'&&<WeeklyPlanView lang={lang} plan={p} onLoaded={onWeekly}/>}
 </>}
 {(p.notes.length>0||p.exclusions.length>0)&&<section className="plan-notes"><h2>{c.reasons}</h2>{p.notes.map(n=><p key={n}>{reason(n)}</p>)}{p.exclusions.length>0&&<details><summary>{c.excluded} ({fmtNum(p.exclusions.length,lang)})</summary>{p.exclusions.map(e=><p key={e.exerciseId}><strong>{EXERCISES.find(x=>x.id===e.exerciseId)?.name[lang]}:</strong> {reason(e.reason)}</p>)}</details>}</section>}
 </>}
 {page==='health'&&<section className="health-card"><div className="health-heading"><Icon name="health" size={28}/><h2>{c.health}</h2></div><dl className="intake-review">{[[c.age,fmtNum(h.age,lang)],[c.condition,h.conditions.map(v=>optionNames[v]?.[lang]).join('، ')],[c.mobility,optionNames[h.mobility]?.[lang]],[c.pain,h.pain.map(v=>optionNames[v]?.[lang]).join('، ')||c.noItems],[c.restriction,h.restrictions.map(v=>optionNames[v]?.[lang]).join('، ')||c.noItems],[c.clearance,h.clearance==='yes'?c.yes:h.clearance==='no'?c.no:c.unsure],[c.medications,h.medications||'—'],[c.diagnosis,h.diagnosisNotes||'—']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="field-help">{c.recordNote}</p><button className="cta" onClick={()=>setEditing(true)}>{c.edit}</button></section>}
 {page==='history'&&<History lang={lang} records={records} onStart={()=>setPage('today')}/>}
 <p className="medical-footnote">{c.medicalNote}</p>
 </>}
 </main></div>{settings&&<CoachSettings lang={lang} value={preferences} onChange={updatePreferences} onClose={()=>setSettings(false)}/>}</div>;
}
