import { CueId, Severity } from '../engine/types';
import { Lang } from './i18n';
import voiceScript from './voice-script.json';
export type VoiceLine = keyof typeof voiceScript;
const priority: Record<Severity,number>={praise:0,info:1,warn:2,safety:3};

/** Packaged neural recordings. No speech service is contacted during a session. */
export class CuePlayer {
 private fileCache=new Map<string,Promise<HTMLAudioElement|null>>();
 private activeAudio?:HTMLAudioElement;
 private generation=0;
 private isMuted=false;
 private activePriority=-1;
 private rate=1;
 guidanceOnly=false;
 constructor(private lang:Lang) {}
 get muted(){return this.isMuted;}
 set muted(value:boolean){this.isMuted=value;if(value)this.stop();}
 set pace(value:number){this.rate=Math.max(.75,Math.min(1.25,value));if(this.activeAudio)this.activeAudio.playbackRate=this.rate;}
 setLang(lang:Lang){this.stop();this.lang=lang;}
 stop(){this.generation++;this.activeAudio?.pause();this.activeAudio=undefined;this.activePriority=-1;if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();}
 private file(id:VoiceLine):Promise<HTMLAudioElement|null>{
  const key=`${this.lang}/${id}`;
  if(!this.fileCache.has(key))this.fileCache.set(key,new Promise(resolve=>{
   const el=new Audio(`/cues/${key}.mp3`);
   const timeout=setTimeout(()=>{this.fileCache.delete(key);resolve(null);},5000);
   const done=(value:HTMLAudioElement|null)=>{clearTimeout(timeout);resolve(value);};
   el.oncanplaythrough=()=>done(el);el.onerror=()=>{this.fileCache.delete(key);done(null);};el.load();
  }));
  return this.fileCache.get(key)!;
 }
 async line(id:VoiceLine,severity:Severity='info'):Promise<boolean>{
  const rank=priority[severity];
  if(this.muted||this.activePriority>rank||(this.activePriority===rank&&rank<3))return false;
  this.stop();const generation=this.generation;this.activePriority=rank;
  const finish=()=>{if(generation===this.generation){this.activePriority=-1;this.activeAudio=undefined;}};
  const el=await this.file(id);
  if(this.muted||generation!==this.generation)return false;
  if(el){
   this.activeAudio=el;el.currentTime=0;el.playbackRate=this.rate;el.onended=finish;el.onerror=finish;
   try{await el.play();return true;}catch{finish();return false;}
  }
  if(typeof speechSynthesis==='undefined'){finish();return false;}
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.toLowerCase().startsWith(this.lang));
  if(!voice){finish();return false;}
  const u=new SpeechSynthesisUtterance(voiceScript[id][this.lang]);u.lang=this.lang==='ar'?'ar-SA':'en-GB';u.voice=voice;u.rate=this.rate;u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);return true;
 }
 cue(id:CueId,severity:Severity=id==='stop_rest'?'safety':'warn'){return this.line(id,severity);}
 count(n:number){return this.guidanceOnly||n<1||n>10?Promise.resolve(false):this.line(`count_${n}` as VoiceLine,'praise');}
}
