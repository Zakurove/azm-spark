import {Lang} from './i18n';
import Brand from './Brand';
import Icon from './Icon';

const copy={
 ar:{
  kicker:'AZM SPARK · مساعد الحركة الشخصي',
  title:'مدرب ذكي يرى جسدك،\nويصحّح التمرين عليه.',
  body:'سبارك يبني خطة تمرين تناسب حالتك الصحية، ثم يراقب حركتك بالكاميرا ويصحّحها على مداك أنت، لا على قالب جاهز. بالعربية، من أي متصفح، ودون أن يغادر الفيديو جهازك.',
  demo:'جرّب العرض المباشر',
  start:'ابدأ حسابك',
  login:'دخول',
  featuresTitle:'ثلاث ركائز، منتج واحد',
  features:[
   {icon:'spark',title:'يصحّح لجسدك',body:'في أول جلسة يقيس سبارك مدى حركتك أنت، ثم يحسب كل عدّة على هذا المدى ويلتقط الحركات التعويضية.'},
   {icon:'health',title:'خطة على حالتك الصحية',body:'التاريخ الصحي يحدد التمارين المناسبة والجرعة الآمنة، وقواعد طبية واضحة توقف الجلسة عند الحاجة.'},
   {icon:'shield',title:'خصوصية كاملة',body:'تحليل الحركة يعمل داخل جهازك. الفيديو لا يُرفع ولا يُخزَّن، ولا نطلب أي تقارير طبية.'},
  ],
  stepsTitle:'من التسجيل إلى التمرين في دقائق',
  steps:[
   {title:'سجّل حالتك الصحية',body:'أربع خطوات بسيطة: الحالة، الحركة، القيود، والأهداف.'},
   {title:'استلم خطتك',body:'تمارين وجرعات محسوبة على حالتك، مع أيام أسبوعك.'},
   {title:'تمرّن أمام الكاميرا',body:'عدّ مباشر، تصحيح فوري بالصوت، وسجل لكل جلسة.'},
  ],
  note:'سبارك لا يشخّص ولا يعالج، والتصريح بممارسة الرياضة ذاتي الإبلاغ. الحالات غير المدعومة تُحوَّل للمراجعة.',
  footer:'عزم سبارك · إحدى منصات جيم وايز',
 },
 en:{
  kicker:'AZM SPARK · PERSONAL MOVEMENT',
  title:'An AI coach that sees your body,\nand corrects to it.',
  body:'SPARK builds a plan that fits your health condition, then watches your movement through the camera and corrects it to your own range, not a generic template. In Arabic, in any browser, and the video never leaves your device.',
  demo:'Watch the live demo',
  start:'Create your account',
  login:'Sign in',
  featuresTitle:'Three pillars, one product',
  features:[
   {icon:'spark',title:'Corrects to your body',body:'In your first session SPARK measures your own range, then scores every repetition against it and catches compensations.'},
   {icon:'health',title:'A plan for your condition',body:'Your health history picks the right movements and a safe dose, with clear medical rules that stop a session when needed.'},
   {icon:'shield',title:'Complete privacy',body:'Movement analysis runs on your device. Video is never uploaded or stored, and we never ask for medical reports.'},
  ],
  stepsTitle:'From sign-up to training in minutes',
  steps:[
   {title:'Record your health',body:'Four simple steps: condition, movement, restrictions, goals.'},
   {title:'Get your plan',body:'Movements and doses sized to your condition, on your week.'},
   {title:'Train with the camera',body:'Live counting, spoken corrections, and a record per session.'},
  ],
  note:'SPARK does not diagnose or treat, and exercise clearance is self-reported. Unsupported cases are referred for review.',
  footer:'Azm SPARK · a Gymwise platform',
 },
};

export default function Landing({lang,onLanguage,onEnter,onDemo}:{lang:Lang;onLanguage:()=>void;onEnter:()=>void;onDemo:()=>void}){
 const c=copy[lang];
 return <div className="landing-shell">
  <header className="portal-header landing-header"><Brand/><div className="landing-header-actions"><button className="language" onClick={onLanguage}>{lang==='ar'?'English':'العربية'}</button><button className="ghost landing-login" onClick={onEnter}>{c.login}</button></div></header>
  <main>
   <section className="landing-hero">
    <div className="landing-editorial">
     <span className="section-kicker">{c.kicker}</span>
     <h1>{c.title}</h1>
     <p>{c.body}</p>
     <div className="landing-ctas">
      <button className="cta" onClick={onDemo}><Icon name="play" size={17}/>{c.demo}</button>
      <button className="ghost" onClick={onEnter}>{c.start}<Icon name="arrow" size={16}/></button>
     </div>
    </div>
    <div className="auth-athlete landing-athlete">
     <img src="/illustrations/wheelchair-press.png" alt={lang==='ar'?'رسم توضيحي لتمرين على كرسي متحرك':'Wheelchair exercise illustration'}/>
     <span className="auth-orbit"/>
     <div className="auth-index"><span>SPARK</span><b>{lang==='ar'?'يقيس مداك أنت.\nويصحّح عليه.':'Measures your range.\nCorrects to it.'}</b></div>
    </div>
   </section>
   <section className="landing-features">
    <h2>{c.featuresTitle}</h2>
    <div className="landing-feature-grid">
     {c.features.map(f=><article key={f.title}><span className="landing-feature-icon"><Icon name={f.icon} size={22}/></span><h3>{f.title}</h3><p>{f.body}</p></article>)}
    </div>
   </section>
   <section className="landing-steps">
    <h2>{c.stepsTitle}</h2>
    <div className="landing-step-grid">
     {c.steps.map((s,i)=><article key={s.title}><b>{lang==='ar'?['١','٢','٣'][i]:i+1}</b><h3>{s.title}</h3><p>{s.body}</p></article>)}
    </div>
    <div className="landing-ctas landing-ctas-center">
     <button className="cta" onClick={onDemo}><Icon name="play" size={17}/>{c.demo}</button>
     <button className="ghost" onClick={onEnter}>{c.start}<Icon name="arrow" size={16}/></button>
    </div>
   </section>
  </main>
  <footer className="landing-footer"><p className="medical-footnote">{c.note}</p><span>{c.footer}</span></footer>
 </div>;
}
