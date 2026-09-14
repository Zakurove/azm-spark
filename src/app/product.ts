import { Lang } from './i18n';
import { EXERCISES } from '../exercises/defs';
import { profileById } from '../engine/profiles';
import { RepMoment } from './experience';
import { SessionSummary } from '../engine/types';
export type Position = 'chair' | 'wheelchair' | 'rise';
export type Support = 'none' | 'left' | 'right';
export interface Setup { position: Position; support: Support }
export function sessionProfile(setup: Setup) {
  const id = setup.position === 'wheelchair' ? 'wheelchair' : setup.support === 'none' ? 'standing' : `hemiparesis_${setup.support}`;
  return { ...profileById(id), ...(setup.support !== 'none' ? { expectedAsymmetry: setup.support } : {}) };
}
export function availableFor(setup: Setup) { return EXERCISES.filter(e => setup.position === 'rise' ? e.id === 'sit_to_stand' : e.id !== 'sit_to_stand'); }
export function illustration(setup: Setup, exerciseId?: string) {
  if (setup.position === 'rise') return '/illustrations/standing.png';
  return `/illustrations/${setup.position}-${exerciseId === 'seated_biceps_curl' ? 'curl' : 'press'}.png`;
}
export type SavedSession = SessionSummary & { mode: 'camera'; setup: Setup; moments?: RepMoment[] };
export function readSessions(): SavedSession[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('azm5.sessions') ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((s): s is SavedSession => s?.mode === 'camera' && EXERCISES.some(e => e.id === s.exerciseId) && Number.isFinite(s.endedAt) && s.reps && ['valid','partial','compensated'].every(k=>Number.isFinite(s.reps[k]))).reverse();
  } catch { return []; }
}
const en = {
  practice:'Practice', history:'My sessions', eyebrow:'MOVEMENT, ON YOUR TERMS', hero:'Start with\nyour movement.', intro:'Find your starting position. We’ll learn your range and guide you, one movement at a time.',
  steps:['Your setup','Your exercise','Ready to move'], setupTitle:'How will you move today?', setupBody:'Your position helps us show the right exercises and guidance.',
  chair:'Seated on a chair', wheelchair:'Using a wheelchair', rise:'From sitting to standing', chairNote:'Seated upper-body exercises', wheelchairNote:'Upper-body focus', riseNote:'Practice sit-to-stand',
  supportTitle:'Would you like us to account for a difference between sides?', supportBody:'This adjusts how differences between your arms are treated.', none:'No adjustment', left:'Left-side weakness', right:'Right-side weakness',
  next:'Choose an exercise', back:'Back', exerciseTitle:'A movement that fits.', exerciseBody:'Choose from the exercises supported for your setup.', ready:'Prepare for this exercise',
  readyTitle:'Your space. Your pace.', readyBody:'Check the movement and camera position before you begin.', guide:'Movement guide', illustration:'Illustration · exercise reference',
  cameraTitle:'Train with your camera', cameraBody:'See your own movement with live feedback. Camera access starts only when you continue.', cameraAction:'Open camera & begin', demoAction:'Explore without a camera',
  demoBody:'A simulated session to explore the coaching. It does not assess your movement.', calibration:'First, we learn your range', calibrationBody:'A few comfortable movements establish your personal baseline before the set begins.',
  privacyTitle:'Private by design', privacyBody:'Camera processing stays on this device. Your video is never recorded or uploaded.',
  stageLabels:['Position','Personal range','Your set'], demo:'Coaching preview', live:'Your movement', demoNotice:'Simulated movement · these results are not yours', demoGuide:'Exercise reference · not an animated mirror',
  signals:'Simulated tracking', signalNote:'Live trace driving the demo engine', coaching:'Your coach', waiting:'Follow the movement at your own comfortable pace.',
  demoWaiting:'Watch the movement and its feedback.',
  progress:'Set progress', range:'Your movement range', adjustment:'Movement support', noHistory:'Your next session starts here.', noHistoryBody:'Your recorded training sessions appear here. Demo sessions are kept out of your progress.',
  local:'ON THIS DEVICE', emptyAction:'Find an exercise', demoSummary:'Demo complete', demoNotSaved:'Simulated results. This demo is not saved to your sessions.', saveFailed:'This session could not be saved on this device.',
  newSession:'Choose another exercise', repeat:'Repeat this exercise', easy:'Very easy', hard:'Maximum effort', resultIntro:'A moment to notice your movement.', finish:'Finish & review',
  cameraFallback:'Explore the demo instead', preview:'Preview', restart:'Start again', loading:'Preparing your session', rangeHint:'Relative to your calibration',
  total:'Completed repetitions', details:'Movement details', setupShort:'Your setup', cameraHelp:'You stay in control. Stop ends camera access immediately.',
};
const ar: typeof en = {
  practice:'التمرين', history:'جلساتي', eyebrow:'حركتك هي البداية', hero:'ابدأ من\nحركتك.', intro:'ابدأ من الوضعية المناسبة لك. نضبط التدريب على مداك، ونرشدك خطوة بخطوة.',
  steps:['وضعيتك','تمرينك','استعد للحركة'], setupTitle:'كيف ستتمرّن اليوم؟', setupBody:'نستخدم وضعيتك لعرض التمارين والإرشادات المناسبة.',
  chair:'جالسًا على كرسي', wheelchair:'باستخدام كرسي متحرك', rise:'من الجلوس إلى الوقوف', chairNote:'تمارين الجزء العلوي جالسًا', wheelchairNote:'التركيز على الجزء العلوي', riseNote:'التدرّب على النهوض والجلوس',
  supportTitle:'هل تحتاج إلى مراعاة اختلاف الجانبين؟', supportBody:'يضبط هذا الخيار طريقة التعامل مع اختلاف حركة الذراعين.', none:'دون تعديل', left:'ضعف الجانب الأيسر', right:'ضعف الجانب الأيمن',
  next:'اختر تمرينك', back:'رجوع', exerciseTitle:'حركة تناسبك.', exerciseBody:'اختر من التمارين المتاحة لوضعيتك.', ready:'استعد لهذا التمرين',
  readyTitle:'مساحتك. إيقاعك.', readyBody:'تعرّف على الحركة وموضع الكاميرا قبل أن تبدأ.', guide:'دليل الحركة', illustration:'رسم توضيحي للتمرين',
  cameraTitle:'تمرّن بالكاميرا', cameraBody:'شاهد حركتك مع ملاحظات مباشرة. لا تُفتح الكاميرا إلا عند المتابعة.', cameraAction:'افتح الكاميرا وابدأ', demoAction:'استكشف دون كاميرا',
  demoBody:'جلسة محاكاة للتعرّف على التدريب، لا تُقيّم حركتك.', calibration:'نتعرّف أولًا على مداك', calibrationBody:'تحدّد بضع حركات مريحة مداك الشخصي قبل بدء المجموعة.',
  privacyTitle:'خصوصيتك محفوظة', privacyBody:'تُعالج صورة الكاميرا على هذا الجهاز. لا يُسجّل الفيديو ولا يُرفع.',
  stageLabels:['الوضعية','مدى الحركة','المجموعة'], demo:'استكشف التدريب', live:'حركتك', demoNotice:'حركة محاكاة — هذه النتائج ليست نتائجك', demoGuide:'دليل للتمرين — لا يعكس حركتك',
  signals:'حركة المحاكاة', signalNote:'تتحرّك المحاكاة، فتستجيب الملاحظات', coaching:'مدرّبك', waiting:'تحرّك بإيقاع مريح لك.',
  demoWaiting:'راقب الحركة واستجابة المدرّب لها.',
  progress:'تقدّم المجموعة', range:'مدى حركتك', adjustment:'دعم الحركة', noHistory:'جلستك القادمة تبدأ هنا.', noHistoryBody:'تظهر هنا جلساتك المسجّلة. لا تُضاف العروض التجريبية إلى تقدّمك.',
  local:'على هذا الجهاز', emptyAction:'اختر تمرينًا', demoSummary:'انتهى العرض التجريبي', demoNotSaved:'نتائج محاكاة. لا يُحفظ هذا العرض ضمن جلساتك.', saveFailed:'تعذّر حفظ هذه الجلسة على الجهاز.',
  newSession:'اختر تمرينًا آخر', repeat:'كرّر هذا التمرين', easy:'سهل جدًا', hard:'أقصى جهد', resultIntro:'لحظة للتأمّل في حركتك.', finish:'إنهاء ومراجعة',
  cameraFallback:'استكشف العرض التجريبي', preview:'معاينة', restart:'ابدأ من جديد', loading:'نجهّز جلستك', rangeHint:'مقارنةً بالمعايرة',
  total:'التكرارات المكتملة', details:'تفاصيل الحركة', setupShort:'وضعيتك', cameraHelp:'أنت المتحكّم. ينهي زر الإيقاف الوصول إلى الكاميرا فورًا.',
};
export const copy = (lang: Lang) => lang === 'ar' ? ar : en;
