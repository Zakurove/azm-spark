import { useEffect, useState } from 'react';
import { Lang } from './i18n';
import { camCopy } from './camera-copy';
import { Preferences } from './experience';
import { Position } from './product';
import { preloadPoseAssets } from './poseSource';
import { primeAudio } from './audio';
import Brand from './Brand';
import Icon from './Icon';
import PlacementGuide from './PlacementGuide';
import Session from './Session';

const ART: Record<Position, string> = {
 chair: '/illustrations/landing/chair-press.webp',
 wheelchair: '/illustrations/landing/wheelchair-press.webp',
 rise: '/illustrations/landing/standing.webp',
};

/** No-account camera trial: choose a position, set up the phone, then a real camera session. */
export default function TryCamera({ lang, onLanguage, onExit, onSimulate, onRegister, preferences, onPreferences }: {
 lang: Lang; onLanguage: () => void; onExit: () => void; onSimulate: () => void; onRegister: () => void;
 preferences: Preferences; onPreferences: (p: Preferences) => void;
}) {
 const k = camCopy(lang);
 const [step, setStep] = useState<'pose' | 'place' | 'session'>('pose');
 const [position, setPosition] = useState<Position>('chair');
 const [run, setRun] = useState(0);
 useEffect(() => { if (step === 'place') preloadPoseAssets(); }, [step]);
 useEffect(() => { window.scrollTo(0, 0); }, [step]);

 if (step === 'session') {
  return <Session key={run} lang={lang} setup={{ position, support: 'none' }} exerciseId={position === 'rise' ? 'sit_to_stand' : 'seated_shoulder_press'}
   demo={false} trial targetReps={position === 'rise' ? 4 : 6} preferences={preferences} onPreferences={onPreferences}
   onExit={() => setStep('place')} onRestart={() => setRun(r => r + 1)} onDemo={onSimulate} onRegister={onRegister}/>;
 }

 const stepIndex = step === 'pose' ? 0 : 1;
 return <div className="try-shell">
  <header className="try-header">
   <button type="button" className="brand-link" onClick={onExit} aria-label={lang === 'ar' ? 'العودة إلى الصفحة الرئيسية' : 'Back to the home page'}><Brand/></button>
   <div className="try-progress" aria-hidden>{k.steps.map((label, i) => <span key={label} className={i <= stepIndex ? 'on' : ''}><i/>{label}</span>)}</div>
   <button className="language" onClick={onLanguage}>{lang === 'ar' ? 'English' : 'العربية'}</button>
  </header>
  <main className="try-main">
   {step === 'pose' && <section className="try-card">
    <h1>{k.poseTitle}</h1>
    <p>{k.poseBody}</p>
    <div className="try-poses">
     {(['chair', 'wheelchair', 'rise'] as const).map(p => <button key={p} type="button" className={`try-pose ${position === p ? 'selected' : ''}`} aria-pressed={position === p} onClick={() => setPosition(p)}>
      <img src={ART[p]} alt=""/>
      <div><b>{k.poses[p].title}</b><span>{k.poses[p].body}</span></div>
      <i className="try-pose-check"><Icon name="check" size={14}/></i>
     </button>)}
    </div>
    <div className="try-actions">
     <button className="cta" onClick={() => setStep('place')}>{k.next}<Icon name="arrow" size={17}/></button>
     <button className="ghost" onClick={onExit}>{k.back}</button>
    </div>
   </section>}
   {step === 'place' && <section className="try-card">
    <h1>{k.placeTitle}</h1>
    <p>{k.placeBody}</p>
    <PlacementGuide lang={lang} position={position}/>
    <div className="try-actions">
     <button className="cta try-start" onClick={() => { if (preferences.voice !== 'off') primeAudio(lang); setStep('session'); }}><Icon name="camera" size={19}/>{k.start}</button>
     <button className="ghost" onClick={() => setStep('pose')}>{k.back}</button>
    </div>
    <button className="text-button try-sim" onClick={onSimulate}>{k.simulate}</button>
    <p className="try-privacy"><Icon name="shield" size={15}/>{k.privacy}</p>
   </section>}
  </main>
 </div>;
}
