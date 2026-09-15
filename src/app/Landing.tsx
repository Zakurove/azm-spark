import {useEffect,useState} from 'react';
import {Lang,fmtNum} from './i18n';
import Brand from './Brand';
import Icon from './Icon';

const copy={
 ar:{
  eyebrow:'لكل جسمٍ طريقته',
  heroTitle:'الرياضة ما زالت لك،\nمهما تغيّر جسمك',
  heroBody:'ابدأ بصورة من تقريرك الطبي. يقرؤها عزم سبارك ويعبّئ عنك أغلب الإجابات، ثم يبني تمرينًا يناسب حالتك الطبية، حركةً وعددًا وراحةً. وحين تتمرن، تعدّ الكاميرا تكراراتك مباشرة وتصحح لك على مداك أنت، لا على قالب جاهز، ومعك صوت عربي هادئ في كل مجموعة. كل هذا من متصفحك، جالسًا أو واقفًا أو من كرسيك المتحرك.',
  ctaDemo:'جرّب تمرينًا الآن',
  ctaStart:'ابدأ مجانًا',
  ctaLogin:'تسجيل الدخول',
  chips:['بلا تطبيق ولا معدات','الفيديو لا يغادر جهازك','تقريرك لا يُحفظ'],
  howTitle:'من تقريرك إلى أول تكرار',
  how:[
   {title:'صورة واحدة تكفي',body:'صوّر تقريرك الطبي بجوالك أو الصق نصّه. يقرؤه عزم سبارك مرة واحدة، يعبّئ منه إجاباتك، ثم يسألك عن الناقص فقط.'},
   {title:'خطة تحترم حالتك الطبية',body:'قواعد طبية واضحة تختار الحركات التي تناسبك، وتحدد المجموعات والتكرارات والراحة الآمنة لك. وإن كان الأسلم أن تتوقف، توقفت الجلسة من نفسها.'},
   {title:'الكاميرا تعدّ معك',body:'تحسب تكراراتك لحظة بلحظة، وتصحح لك على مداك الذي قاسته منك، لا على قالب عام، وتنتبه لحركات التعويض إن تسلّلت. وطوال الجلسة يرافقك صوت هادئ بالعربية، مجموعة بعد مجموعة.'},
  ],
  healthTitle:'كل جسمك يستفيد، حتى نومك',
  healthBody:'الحركة المنتظمة تشتغل بهدوء في الخلفية. قلبك يقوى على مهل، ومزاجك يصفو بعد الجلسة ولو كانت قصيرة، وبعد أسابيع تلاحظ أن حمل الأغراض صار أخف، وأن وقفتك أثبت، وأن نومك أعمق وأهنأ. جسمك ما نسي كيف يتحسن، كان فقط ينتظر بداية تناسبه.',
  healthChips:['قلبك أقوى','نومك أعمق','خطوتك أثبت'],
  closeTitle:'جسمك تغيّر، وعزمك باقٍ',
  closeBody:'ابدأ مجانًا، لنفسك أو لأحد أهلك، وسيُسجَّل تقدمك جلسة بعد جلسة، لتراه أنت ويراه معك مدربك أو طبيبك إن أحببت.',
  note:'عزم سبارك رفيق تمرين، لا عيادة. لا يشخّص ولا يعالج، وجاهزيتك للتمرين أنت من يقرّها. وإن كانت حالتك الطبية خارج ما نغطيه اليوم، نقولها لك بوضوح ونحيلها للمراجعة أولًا.',
  footer:'عزم سبارك. الرياضة ما زالت لك.',
 },
 en:{
  eyebrow:'Every body has its own way',
  heroTitle:'Training is still yours,\nwhatever your body has been through',
  heroBody:'Start with a photo of your medical report. AZM SPARK reads it, prefills your answers, and builds training that fits your medical condition. The camera counts your reps live, correcting to your measured range, not a template, while a calm Arabic voice guides every set. All in your browser, seated, standing, or from a wheelchair.',
  ctaDemo:'Try a workout now',
  ctaStart:'Start free',
  ctaLogin:'Log in',
  chips:['No app, no equipment','Video stays on device','Report read, never stored'],
  howTitle:'From your report to your first rep',
  how:[
   {title:'One photo is enough',body:'Photograph your medical report with your phone, or paste the text. AZM SPARK reads it once, fills your answers from it, then asks only for what is missing.'},
   {title:'A plan that respects your medical condition',body:'Clear medical rules choose the movements that fit you and decide safe sets, reps, and rest. When stopping is the safer call, the session stops itself.'},
   {title:'The camera counts with you',body:'It counts each rep as it happens and corrects you to the range it measured on you, not a generic template, noticing compensation movements when they creep in. Through the whole session, a calm Arabic voice stays with you, set after set.'},
  ],
  healthTitle:'It shows up everywhere, even in your sleep',
  healthBody:'Regular movement works quietly. Your heart grows stronger at its own pace, your mood clears after a session, even a short one, and within weeks you notice the groceries feel lighter, your stance steadier, your sleep deeper and more restful. Your body has not forgotten how to improve. It was waiting for a start that fits.',
  healthChips:['A stronger heart','Deeper sleep','A steadier step'],
  closeTitle:'Your body changed. Your resolve did not.',
  closeBody:'Start free, for yourself or for a parent, and every session records your progress so you can see it build and share it with your coach or doctor when you choose.',
  note:'AZM SPARK is a training companion, not a clinic. It does not diagnose or treat, your clearance to exercise is yours to confirm, and if your medical condition sits outside what we cover today, we say so plainly and refer it for review first.',
  footer:'AZM SPARK. Training is still yours.',
 },
};

const chipIcons=['sound','shield','chair'] as const;
const healthIcons=['health','spark','clock'] as const;

function JointsMark(){
 return <svg width="46" height="52" viewBox="0 0 46 52" fill="none" aria-hidden className="ld-mock-joints">
  <path d="M23 10v14m0 0 -9 7m9 -7 9 7m-9 -7v13" stroke="#c9c2ae" strokeWidth="1.6" strokeLinecap="round"/>
  <circle cx="23" cy="6" r="4" fill="#f2c33c"/>
  <circle cx="23" cy="24" r="3.4" fill="#8065ad"/>
  <circle cx="14" cy="31" r="3" fill="#8065ad"/>
  <circle cx="32" cy="31" r="3" fill="#8065ad"/>
  <circle cx="23" cy="37" r="3" fill="#c9c2ae"/>
  <circle cx="23" cy="47" r="3" fill="#c9c2ae"/>
 </svg>;
}

export default function Landing({lang,onLanguage,onEnter,onDemo}:{lang:Lang;onLanguage:()=>void;onEnter:(register?:boolean)=>void;onDemo:()=>void}){
 const c=copy[lang];
 const [rep,setRep]=useState(3);
 useEffect(()=>{const id=setInterval(()=>setRep(r=>r%8+1),1150);return()=>clearInterval(id);},[]);
 return <div className="ld-shell">
  <header className="ld-header"><div className="ld-header-inner"><Brand/><div className="landing-header-actions">
   <button className="language" onClick={onLanguage}>{lang==='ar'?'English':'العربية'}</button>
   <button className="ghost ld-login" onClick={()=>onEnter(false)}>{c.ctaLogin}</button>
   <button className="cta ld-start-sm" onClick={()=>onEnter(true)}>{c.ctaStart}</button>
  </div></div></header>
  <main>
   <section className="ld-hero">
    <span className="ld-glow ld-glow-gold" aria-hidden/>
    <span className="ld-glow ld-glow-violet" aria-hidden/>
    <div>
     <span className="ld-eyebrow">{c.eyebrow}</span>
     <h1>{c.heroTitle}</h1>
     <p className="ld-hero-body">{c.heroBody}</p>
     <div className="ld-ctas">
      <button className="cta ld-cta-demo" onClick={onDemo}><Icon name="play" size={18}/>{c.ctaDemo}</button>
      <button className="ghost ld-cta-ghost" onClick={()=>onEnter(true)}>{c.ctaStart}<Icon name="arrow" size={16}/></button>
     </div>
     <div className="ld-chips">{c.chips.map((chip,i)=><span className="ld-chip" key={chip}><Icon name={chipIcons[i]} size={14}/>{chip}</span>)}</div>
    </div>
    <div className="ld-stage" aria-hidden>
     <span className="ld-stage-disc"/><span className="ld-stage-ring"/>
     <img className="ld-stage-img" src="/illustrations/landing/wheelchair-press.webp" alt=""/>
     <div className="ld-card ld-card-live">
      <div className="ld-live-head"><span className="ld-live-dot"/>{lang==='ar'?'جلسة مباشرة':'Live session'}</div>
      <div className="ld-live-name">{lang==='ar'?'ضغط الكتف جالسًا':'Seated shoulder press'}</div>
      <div className="ld-live-count"><b>{fmtNum(rep,lang)}</b><span>/ {fmtNum(8,lang)}</span></div>
      <div className="ld-bar"><i style={{width:`${rep/8*100}%`}}/></div>
      <div className="ld-live-range"><span>{lang==='ar'?'ضمن مداك':'Within your range'}</span><b>{fmtNum(96,lang)}٪</b></div>
     </div>
     <div className="ld-card ld-card-report">
      <div className="ld-report-head"><Icon name="check" size={17}/>{lang==='ar'?'قرأنا تقريرك الطبي':'We read your report'}</div>
      <div className="ld-report-chips">
       <span>{lang==='ar'?'سكتة دماغية':'Stroke'}</span>
       <span>{lang==='ar'?'الجانب الأيمن':'Right side'}</span>
       <span>{fmtNum(58,lang)} {lang==='ar'?'سنة':'yrs'}</span>
      </div>
      <div className="ld-report-foot">{lang==='ar'?'بقي سؤالان فقط لنكمل خطتك':'Two questions left to finish your plan'}</div>
     </div>
    </div>
   </section>

   <section className="ld-how">
    <h2>{c.howTitle}</h2>
    <div className="ld-how-flow">
     {c.how.map((step,i)=><article className="ld-step" key={step.title}>
      <div className="ld-step-num">{fmtNum(i+1,lang).padStart(2,lang==='ar'?'٠':'0')}</div>
      <h3>{step.title}</h3><p>{step.body}</p>
      <div className="ld-mock">
       {i===0&&<div className="ld-mock-doc"><i style={{width:'92%'}}/><i/><i/><span className="ld-mock-stamp"><Icon name="check" size={12}/>{lang==='ar'?'قُرئ وفُهم':'Read and understood'}</span></div>}
       {i===1&&<div className="ld-mock-dose">
        <span>{fmtNum(3,lang)} {lang==='ar'?'مجموعات':'sets'}</span>
        <span>{fmtNum(8,lang)} {lang==='ar'?'عدّات':'reps'}</span>
        <span>{lang==='ar'?`راحة ${fmtNum(90,lang)} ث`:`${fmtNum(90,lang)}s rest`}</span>
       </div>}
       {i===2&&<div className="ld-mock-cam"><JointsMark/><div className="ld-mock-cam-lines"><b>{lang==='ar'?'عدّ وتصحيح مباشر':'Live count and correction'}</b><span>{lang==='ar'?'بصوت عربي هادئ':'In a calm Arabic voice'}</span></div></div>}
      </div>
     </article>)}
    </div>
   </section>

   <section className="ld-health">
    <div className="ld-health-inner">
     <div>
      <h2>{c.healthTitle}</h2>
      <p className="ld-health-body">{c.healthBody}</p>
      <div className="ld-health-chips">{c.healthChips.map((chip,i)=><span className="ld-chip" key={chip}><Icon name={healthIcons[i]} size={14}/>{chip}</span>)}</div>
     </div>
     <div className="ld-health-img" aria-hidden><img src="/illustrations/landing/standing.webp" alt=""/></div>
    </div>
   </section>

   <section className="ld-close">
    <h2>{c.closeTitle}</h2>
    <p>{c.closeBody}</p>
    <div className="ld-ctas">
     <button className="cta ld-cta-demo" onClick={onDemo}><Icon name="play" size={18}/>{c.ctaDemo}</button>
     <button className="ghost ld-cta-ghost" onClick={()=>onEnter(true)}>{c.ctaStart}<Icon name="arrow" size={16}/></button>
    </div>
   </section>
  </main>
  <footer className="ld-footer"><div className="ld-footer-inner"><p className="ld-note">{c.note}</p><span className="ld-brandline">{c.footer}</span></div></footer>
 </div>;
}
