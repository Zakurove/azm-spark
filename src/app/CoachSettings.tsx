import { useEffect, useMemo, useState } from 'react';
import { Lang } from './i18n';
import { Preferences, ui } from './experience';
import { CuePlayer } from './audio';
import Dialog from './Dialog';
import Icon from './Icon';
export default function CoachSettings({lang,value,onChange,onClose}:{lang:Lang;value:Preferences;onChange:(p:Preferences)=>void;onClose:()=>void}){
 const c=ui(lang),player=useMemo(()=>new CuePlayer(lang),[lang]);const [blocked,setBlocked]=useState(false),[playing,setPlaying]=useState(false);
 useEffect(()=>()=>player.stop(),[player]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onClose]);
 useEffect(()=>{player.pace=value.pace;},[player,value.pace]);
 return <Dialog titleId="coach-settings-title"><div className="settings-top"><span className="result-symbol"><Icon name="sound" size={28}/></span><button className="icon-button" onClick={onClose} aria-label={c.close}><Icon name="close"/></button></div><p className="eyebrow">AZM COACH</p><h2 id="coach-settings-title">{c.coachSettings}</h2><p>{c.settingsIntro}</p>
 <div className="voice-preview"><div className={`voice-wave ${playing?'playing':''}`} aria-hidden="true">{Array.from({length:17},(_,i)=><i key={i} style={{height:`${12+(Math.sin(i*1.7)+1)*15}px`,animationDelay:`${i*.07}s`}}/>)}</div><button className="ghost" disabled={playing} onClick={async()=>{player.stop();setPlaying(true);const ok=await player.line('preview');setBlocked(!ok);setPlaying(false);}}><Icon name="play" size={17}/>{c.preview}</button><small>{c.voiceNote}</small>{blocked&&<p role="status">{c.voiceBlocked}</p>}</div>
 <div className="settings-field"><div className="segmented">{(['full','essential','off'] as const).map(mode=><button key={mode} aria-pressed={value.voice===mode} className={value.voice===mode?'selected':''} onClick={()=>onChange({...value,voice:mode})}>{c[mode]}</button>)}</div></div>
 <fieldset className="settings-field"><legend>{c.pace}</legend><div className="segmented">{([.85,1,1.15]).map((pace,i)=><button key={pace} aria-pressed={value.pace===pace} className={value.pace===pace?'selected':''} onClick={()=>onChange({...value,pace})}>{[c.slow,c.normal,c.quick][i]}</button>)}</div></fieldset>
 <button className={`focus-option ${value.focus?'selected':''}`} aria-pressed={value.focus} onClick={()=>onChange({...value,focus:!value.focus})}><Icon name="focus"/><span><strong>{c.focus}</strong><small>{c.focusNote}</small></span><span className="toggle"><i/></span></button>
 <div className="modal-actions"><button className="cta" onClick={onClose}>{c.close}<Icon name="check" size={17}/></button></div></Dialog>;
}
