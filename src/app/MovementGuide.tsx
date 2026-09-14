import { useEffect, useMemo, useState } from 'react';
import { Lang,fmtNum } from './i18n';
import { ExerciseDef } from '../engine/types';
import { movementSteps,ui } from './experience';
import { CuePlayer,VoiceLine } from './audio';
import Icon from './Icon';
export default function MovementGuide({lang,def,pace}:{lang:Lang;def:ExerciseDef;pace:number}){
 const [step,setStep]=useState(0),[audioError,setAudioError]=useState(false);const c=ui(lang),player=useMemo(()=>new CuePlayer(lang),[lang]);
 useEffect(()=>()=>player.stop(),[player]);useEffect(()=>{player.pace=pace;},[player,pace]);useEffect(()=>{setStep(0);player.stop();},[def.id,player]);
 const side=def.id==='seated_biceps_curl',rise=def.id==='sit_to_stand';
 return <div className="movement-guide"><div className="walkthrough-header"><h3>{c.walkthrough}</h3><span>{fmtNum(step+1,lang)} / {fmtNum(3,lang)}</span></div><div className="walkthrough-steps">{movementSteps[def.id][lang].map((text,i)=><button key={i} aria-pressed={step===i} className={step===i?'active':''} onClick={()=>{player.stop();setStep(i);}}><span>{fmtNum(i+1,lang)}</span><p>{text}</p></button>)}</div><div className="walkthrough-actions"><button className="text-button" onClick={async()=>{player.stop();setAudioError(!await player.line(`${def.id}_${step}` as VoiceLine));}}><Icon name="sound" size={16}/>{c.listen}</button><button className="text-button" onClick={()=>{player.stop();setStep(step===2?1:step+1);}}>{step===2?c.previous:c.next}<Icon name="arrow" size={16}/></button></div>{audioError&&<p className="micro" role="status">{c.voiceBlocked}</p>}
 <div className="camera-compass"><svg viewBox="0 0 120 90" aria-hidden="true"><path d="M60 74 20 15h80z" fill="#e9eee6"/><path d="M60 67V29" stroke="#8ca695" strokeDasharray="3 4"/><g transform={`translate(60 24) rotate(${side?75:rise?45:0})`}><ellipse rx="19" ry="7" fill="#344d43"/><circle r="9" fill="#f8cb44"/><path d="m-4 10 4 5 4-5" fill="#344d43"/></g><rect x="47" y="65" width="26" height="17" rx="4" fill="#344d43"/><circle cx="60" cy="73" r="4" fill="#f8cb44"/></svg><div><span>{c.view}</span><strong>{side?c.side:rise?c.angle:c.front}</strong><p>{def.camera[lang]}</p></div></div></div>;
}
