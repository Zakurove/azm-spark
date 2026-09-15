import { adjustReps,adjustSets,calculateRestTime,getDetailedDisabilityConfig,getMinimumRecoveryHours } from './legacy-config';
import { DisabilityType } from './legacy-types';
import { Setup } from '../app/product';
export const conditions=['none','stroke','ms','cerebral_palsy','sci_complete','sci_incomplete','parkinsons','lower_limb_unilateral','upper_limb_unilateral','arthritis','cfs_moderate','cardiac','other'] as const;
export const painOptions=['shoulder','elbow','wrist','back','hip','knee'] as const;
export const restrictionOptions=['no_overhead','no_resistance','no_weight_bearing','no_exercise','balance_support'] as const;
export interface Intake {
 age:number;conditions:string[];diagnosisNotes:string;medications:string;
 mobility:'seated'|'wheelchair'|'standing'|'bed';support:'none'|'left'|'right';
 pain:string[];restrictions:string[];symptoms:'yes'|'no';recentChange:'yes'|'no';clearance:'yes'|'no'|'unsure';
 equipment:string[];goal:'mobility'|'strength'|'habit';days:number[];time:string;sessionMinutes:number;consent:boolean;
}
export interface Prescription {exerciseId:string;setup:Setup;sets:number;reps:number;restSeconds:number;reason:string}
export interface Plan {status:'ready'|'review';reasons:string[];notes:string[];exclusions:{exerciseId:string;reason:string}[];exercises:Prescription[];days:number[];time:string;warmUpMinutes:number;coolDownMinutes:number;estimatedMinutes:number;recoveryHours:number;version?:number;weekly?:import('./weekly').WeeklyPlan}
export const types:Record<string,DisabilityType>={stroke:'neurological',ms:'neurological',cerebral_palsy:'neurological',parkinsons:'neurological',sci_complete:'mobility',sci_incomplete:'mobility',lower_limb_unilateral:'amputation',upper_limb_unilateral:'amputation',arthritis:'chronic',cfs_moderate:'chronic'};
export function validateIntake(v:unknown):v is Intake {
 if(!v||typeof v!=='object')return false;const x=v as Intake;
 const list=(v:unknown,allowed:readonly unknown[],min=0)=>Array.isArray(v)&&v.length>=min&&v.length<=allowed.length&&new Set(v).size===v.length&&v.every(a=>allowed.includes(a));
 return Number.isInteger(x.age)&&x.age>=18&&x.age<=100&&list(x.conditions,conditions,1)&&!(x.conditions.length>1&&x.conditions.includes('none'))&&['diagnosisNotes','medications'].every(k=>typeof (x as unknown as Record<string,unknown>)[k]==='string'&&((x as unknown as Record<string,string>)[k]).length<=1200)&&['seated','wheelchair','standing','bed'].includes(x.mobility)&&['none','left','right'].includes(x.support)&&list(x.pain,painOptions)&&list(x.restrictions,restrictionOptions)&&['yes','no'].includes(x.symptoms)&&['yes','no'].includes(x.recentChange)&&['yes','no','unsure'].includes(x.clearance)&&list(x.equipment,['chair','weights'])&&['mobility','strength','habit'].includes(x.goal)&&list(x.days,[0,1,2,3,4,5,6],1)&&x.days.length<=4&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)&&[20,30,40].includes(x.sessionMinutes)&&x.consent===true;
}
export function scheduleFits(days:number[],recoveryHours:number){const s=[...days].sort((a,b)=>a-b);return s.every((d,i)=>((s[(i+1)%s.length]-d+7)||7)*24>=recoveryHours);}
export function createPlan(h:Intake):Plan {
 if(!validateIntake(h))throw new Error('INVALID_INTAKE');
 const configs=h.conditions.map(c=>getDetailedDisabilityConfig(types[c]??'other',c));
 const reasons:string[]=[],notes:string[]=[];
 const rest=Math.max(...configs.map(c=>calculateRestTime(30,c)));const recovery=Math.max(...configs.map(getMinimumRecoveryHours));
 const warm=Math.max(...configs.map(c=>c.warmUpMinutes)),cool=Math.max(...configs.map(c=>c.coolDownMinutes));
 if(h.conditions.includes('cardiac'))reasons.push('cardiac');
 if(h.symptoms==='yes')reasons.push('symptoms');
 if(h.recentChange==='yes')reasons.push('recent_change');
 if(h.restrictions.includes('no_exercise'))reasons.push('restriction');
 if(h.conditions.includes('other'))reasons.push('unknown_condition');
 if(configs.some(c=>c.requiresMedicalClearance)&&h.clearance!=='yes')reasons.push('clearance');
 if(configs.some(c=>c.postExertionalMalaiseRisk))reasons.push('pem');
 if(h.mobility==='bed')reasons.push('unsupported_position');
 if(!scheduleFits(h.days,recovery))reasons.push('recovery');
 if(configs.some(c=>c.thermoregulationWarning))notes.push('temperature');
 if(configs.some(c=>c.fatigueRisk==='high'))notes.push('fatigue');
 if(h.clearance==='yes')notes.push('self_reported_clearance');
 if(h.medications.trim())notes.push('medications_recorded');
 const p:Plan={status:'ready',reasons,notes,exclusions:[],exercises:[],days:[...h.days].sort((a,b)=>a-b),time:h.time,warmUpMinutes:warm,coolDownMinutes:cool,estimatedMinutes:0,recoveryHours:recovery};
 const candidate=['seated_shoulder_press','seated_biceps_curl','sit_to_stand'];
 for(const id of candidate){
  let excluded='';const upper=id!=='sit_to_stand';
  if(upper&&h.conditions.includes('upper_limb_unilateral'))excluded='tracking_limbs';
  if(upper&&h.pain.some(p=>['shoulder','elbow','wrist','back'].includes(p)))excluded='pain_upper';
  if(id==='seated_shoulder_press'&&h.restrictions.includes('no_overhead'))excluded='overhead';
  if(id==='seated_biceps_curl'&&(!h.equipment.includes('weights')||h.restrictions.includes('no_resistance')))excluded='resistance';
  if(h.mobility!=='wheelchair'&&!h.equipment.includes('chair'))excluded='chair';
  if(!upper&&(h.mobility!=='standing'||h.restrictions.some(r=>['no_weight_bearing','balance_support'].includes(r))||h.pain.some(p=>['hip','knee','back'].includes(p))||h.conditions.includes('lower_limb_unilateral')))excluded='standing';
  if(excluded){p.exclusions.push({exerciseId:id,reason:excluded});continue;}
  const sets=Math.min(...configs.map(c=>adjustSets(3,c))),reps=Math.min(...configs.map(c=>adjustReps(upper?10:5,c)),upper?10:5);
  p.exercises.push({exerciseId:id,setup:{position:upper?(h.mobility==='wheelchair'?'wheelchair':'chair'):'rise',support:h.support},sets,reps,restSeconds:rest,reason:upper?'seated_match':'standing_match'});
 }
 if(!p.exercises.length)reasons.push('no_exercises');
 // Goal changes order, never overrides the safety filter.
 if(h.goal==='mobility')p.exercises.sort((a,b)=>Number(b.exerciseId==='sit_to_stand')-Number(a.exerciseId==='sit_to_stand'));
 const duration=()=>warm+cool+p.exercises.reduce((n,e)=>n+(e.sets*e.reps*4+(e.sets-1)*e.restSeconds)/60,0);
 const limit=Math.min(h.sessionMinutes,...configs.map(c=>c.maxSessionMinutes));
 while(duration()>limit&&p.exercises.some(e=>e.sets>1)){const e=[...p.exercises].reverse().find(e=>e.sets>1)!;e.sets--;}
 if(duration()>limit)reasons.push('duration');
 p.estimatedMinutes=Math.ceil(duration());
 if(reasons.length){p.status='review';p.exercises=[];}
 return p;
}
