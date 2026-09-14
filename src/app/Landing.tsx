import {Lang} from './i18n';
import Brand from './Brand';
import Icon from './Icon';

const copy={
 ar:{
  kicker:'AZM SPARK · مساعد الحركة الشخصي',
  title:'ذكاء اصطناعي يتكيّف\nمع حالتك الصحية أنت.',
  body:'سبارك يبدأ من حالتك الصحية — سكتة دماغية، إصابة نخاعية، بتر، أو غيرها — فيبني خطة تمرين آمنة بجرعة محسوبة عليها. ثم يراقب حركتك بالكاميرا ويصحّحها على مداك أنت، لا على قالب جاهز. بالعربية، من أي متصفح، ودون أن يغادر الفيديو جهازك.',
  demo:'جرّب العرض المباشر',
  start:'سجّل الآن',
  login:'تسجيل الدخول',
  featuresTitle:'ثلاث ركائز، منتج واحد',
  features:[
   {icon:'health',title:'خطة مبنية على حالتك الصحية',body:'تاريخك الصحي — أو تقريرك الطبي — يحدد التمارين المناسبة والجرعة الآمنة، وقواعد طبية واضحة توقف الجلسة عند الحاجة.'},
   {icon:'spark',title:'تصحيح على مداك أنت',body:'في أول جلسة يقيس سبارك مدى حركتك أنت، ثم يحسب كل عدّة على هذا المدى ويلتقط الحركات التعويضية.'},
   {icon:'shield',title:'خصوصية كاملة',body:'تحليل الحركة يعمل داخل جهازك. فيديو الكاميرا لا يُرفع ولا يُخزَّن.'},
  ],
  benefitsTitle:'حركة أكثر، صحة أفضل',
  benefitsLead:'كل جلسة مع سبارك ترفع نشاطك البدني، والنشاط البدني المنتظم من أفضل ما تقدّمه لصحتك.',
  benefits:[
   {icon:'health',title:'قلب أقوى',body:'الحركة المنتظمة تحسّن صحة القلب والدورة الدموية، وتساعد على ضبط الضغط والسكر.'},
   {icon:'spark',title:'مزاج أصفى',body:'التمرين يخفّف التوتر ويحسّن المزاج، ويقلّل أعراض القلق والاكتئاب.'},
   {icon:'rise',title:'قوة واستقلالية',body:'عضلات أقوى وتوازن أفضل يعنيان حركة يومية أسهل وثقة أكبر بنفسك.'},
   {icon:'clock',title:'نوم أعمق',body:'من يتحرّك بانتظام ينام أسرع وأعمق، ويستيقظ بطاقة أفضل ليومه.'},
  ],
  stepsTitle:'من التسجيل إلى التمرين في دقائق',
  steps:[
   {title:'أدخل حالتك الصحية',body:'أربع خطوات بسيطة، أو ارفع تقريرك الطبي وسيعبّئ محركنا إجاباتك عنك.'},
   {title:'استلم خطتك',body:'تمارين وجرعات محسوبة على حالتك، مع أيام أسبوعك.'},
   {title:'تمرّن أمام الكاميرا',body:'عدّ مباشر، تصحيح فوري بالصوت، وسجل لكل جلسة.'},
  ],
  note:'سبارك لا يشخّص ولا يعالج، والتصريح بممارسة الرياضة ذاتي الإبلاغ. الحالات غير المدعومة تُحوَّل للمراجعة.',
  footer:'عزم سبارك · إحدى منصات جيم وايز',
 },
 en:{
  kicker:'AZM SPARK · PERSONAL MOVEMENT',
  title:'AI that adapts to\nyour medical condition.',
  body:'SPARK starts from your health condition — stroke, spinal cord injury, amputation, or others — and builds a safe exercise plan dosed to it. Then it watches your movement through the camera and corrects it to your own range, not a generic template. In Arabic, in any browser, and the video never leaves your device.',
  demo:'Try the live demo',
  start:'Sign up now',
  login:'Sign in',
  featuresTitle:'Three pillars, one product',
  features:[
   {icon:'health',title:'A plan built on your condition',body:'Your health history — or your medical report — picks the right movements and a safe dose, with clear medical rules that stop a session when needed.'},
   {icon:'spark',title:'Corrects to your own range',body:'In your first session SPARK measures your own range, then scores every repetition against it and catches compensations.'},
   {icon:'shield',title:'Complete privacy',body:'Movement analysis runs on your device. Camera video is never uploaded or stored.'},
  ],
  benefitsTitle:'More movement, better health',
  benefitsLead:'Every SPARK session raises your physical activity, and regular physical activity is one of the best things you can do for your health.',
  benefits:[
   {icon:'health',title:'A stronger heart',body:'Regular movement improves heart health and circulation, and helps manage blood pressure and blood sugar.'},
   {icon:'spark',title:'A clearer mood',body:'Exercise relieves stress, lifts mood, and reduces symptoms of anxiety and depression.'},
   {icon:'rise',title:'Strength and independence',body:'Stronger muscles and better balance mean easier daily movement and more confidence.'},
   {icon:'clock',title:'Deeper sleep',body:'People who move regularly fall asleep faster, sleep deeper, and wake with more energy.'},
  ],
  stepsTitle:'From sign-up to training in minutes',
  steps:[
   {title:'Enter your health',body:'Four simple steps, or upload your medical report and our engine fills your answers for you.'},
   {title:'Get your plan',body:'Movements and doses sized to your condition, mapped to your week.'},
   {title:'Train with the camera',body:'Live counting, spoken corrections, and a record per session.'},
  ],
  note:'SPARK does not diagnose or treat, and exercise clearance is self-reported. Unsupported cases are referred for review.',
  footer:'Azm SPARK · a Gymwise platform',
 },
};

export default function Landing({lang,onLanguage,onEnter,onDemo}:{lang:Lang;onLanguage:()=>void;onEnter:(register?:boolean)=>void;onDemo:()=>void}){
 const c=copy[lang];
 return <div className="landing-shell">
  <header className="portal-header landing-header"><Brand/><div className="landing-header-actions"><button className="language" onClick={onLanguage}>{lang==='ar'?'English':'العربية'}</button><button className="ghost landing-login" onClick={()=>onEnter(false)}>{c.login}</button><button className="cta landing-register" onClick={()=>onEnter(true)}>{c.start}</button></div></header>
  <main>
   <section className="landing-hero">
    <div className="landing-editorial">
     <span className="section-kicker">{c.kicker}</span>
     <h1>{c.title}</h1>
     <p>{c.body}</p>
     <div className="landing-ctas">
      <button className="cta" onClick={onDemo}><Icon name="play" size={17}/>{c.demo}</button>
      <button className="ghost" onClick={()=>onEnter(true)}>{c.start}<Icon name="arrow" size={16}/></button>
     </div>
    </div>
    <div className="auth-athlete landing-athlete">
     <img src="/illustrations/wheelchair-press.png" alt={lang==='ar'?'رسم توضيحي لتمرين على كرسي متحرك':'Wheelchair exercise illustration'}/>
     <span className="auth-orbit"/>
     <div className="auth-index"><span>SPARK</span><b>{lang==='ar'?'يفهم حالتك.\nويصحّح عليها.':'Knows your condition.\nCorrects to it.'}</b></div>
    </div>
   </section>
   <section className="landing-features">
    <h2>{c.featuresTitle}</h2>
    <div className="landing-feature-grid">
     {c.features.map(f=><article key={f.title}><span className="landing-feature-icon"><Icon name={f.icon} size={22}/></span><h3>{f.title}</h3><p>{f.body}</p></article>)}
    </div>
   </section>
   <section className="landing-benefits">
    <h2>{c.benefitsTitle}</h2>
    <p className="landing-benefits-lead">{c.benefitsLead}</p>
    <div className="landing-feature-grid landing-benefit-grid">
     {c.benefits.map(b=><article key={b.title}><span className="landing-feature-icon"><Icon name={b.icon} size={22}/></span><h3>{b.title}</h3><p>{b.body}</p></article>)}
    </div>
   </section>
   <section className="landing-steps">
    <h2>{c.stepsTitle}</h2>
    <div className="landing-step-grid">
     {c.steps.map((s,i)=><article key={s.title}><b>{lang==='ar'?['١','٢','٣'][i]:i+1}</b><h3>{s.title}</h3><p>{s.body}</p></article>)}
    </div>
    <div className="landing-ctas landing-ctas-center">
     <button className="cta" onClick={onDemo}><Icon name="play" size={17}/>{c.demo}</button>
     <button className="ghost" onClick={()=>onEnter(true)}>{c.start}<Icon name="arrow" size={16}/></button>
    </div>
   </section>
  </main>
  <footer className="landing-footer"><p className="medical-footnote">{c.note}</p><span>{c.footer}</span></footer>
 </div>;
}
