import {beforeAll,afterAll,it,expect} from 'vitest';
import {createServer,Server} from 'node:http';
import {createApi} from '../server/api';
import {Intake} from '../src/medical/plan';
const h:Intake={age:30,conditions:['none'],diagnosisNotes:'',medications:'',mobility:'seated',support:'none',pain:[],restrictions:[],symptoms:'no',recentChange:'no',clearance:'no',equipment:['chair'],goal:'habit',days:[0,2,4],time:'09:00',sessionMinutes:30,consent:true};
let origin:string,server:Server,service:ReturnType<typeof createApi>,a='',b='';
async function call(path:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST',extra={}){const r=await fetch(origin+'/api'+path,{method,headers:{origin,'Content-Type':'application/json','X-Azm-Request':'1',cookie,...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]??'',header:r.headers.get('set-cookie')};}
beforeAll(async()=>{service=createApi(':memory:');server=createServer((req,res)=>void service.handle(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${(server.address() as any).port}`;});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));service.close();});
it('requires authentication and sets a real HttpOnly session with a server-assigned role',async()=>{expect((await call('/sessions')).status).toBe(401);const r=await call('/auth/register',{name:'Test Athlete',email:'a@example.test',password:'test-password-9281',role:'admin'});a=r.cookie;expect(r.status).toBe(200);expect(r.data.user.role).toBe('member');expect(r.data.user.password).toBeUndefined();expect(r.header).toMatch(/HttpOnly; SameSite=Strict/);const r2=await call('/auth/register',{name:'Second Athlete',email:'b@example.test',password:'test-password-7719'});b=r2.cookie;});
it('rejects wrong credentials and foreign origins',async()=>{expect((await call('/auth/login',{email:'a@example.test',password:'incorrect-pass'})).status).toBe(401);expect((await call('/intake',h,a,'PUT',{origin:'https://other.test'})).status).toBe(403);});
it('does not allow a session before medical intake',async()=>{expect((await call('/workouts',{version:1},a)).status).toBe(409);});
it('isolates medical records and enforces plan version and workout ownership',async()=>{const p=await call('/intake',h,a,'PUT');expect(p.status).toBe(200);expect((await call('/auth/me',undefined,b)).data.intake).toBeNull();const r=await call('/workouts',{version:p.data.plan.version,demo:false},a);expect(r.status).toBe(200);expect((await call(`/workouts/${r.data.id}/sets`,{},b)).status).toBe(404);const changed=await call('/intake',{...h,conditions:['cardiac']},a,'PUT');expect(changed.data.plan.status).toBe('review');expect((await call(`/workouts/${r.data.id}/sets`,{},a)).data.error).toBe('PLAN_CHANGED');expect((await call('/workouts',{version:changed.data.plan.version},a)).status).toBe(409);});
it('demo sets never enter personal history and set ordering is enforced',async()=>{const p=await call('/intake',h,b,'PUT');const r=await call('/workouts',{version:p.data.plan.version,demo:true},b);const ex=r.data.plan.exercises[0];const body={index:0,summary:{exerciseId:ex.exerciseId,reps:{valid:1,compensated:0,partial:0},rpe:4,romPct:90},moments:[{cls:'valid',durSec:2.4,peakPct:.9}]};expect((await call(`/workouts/${r.data.id}/sets`,{...body,index:1},b)).status).toBe(409);expect((await call(`/workouts/${r.data.id}/sets`,body,b)).data.saved).toBe(false);expect((await call('/sessions',undefined,b)).data.records).toEqual([]);});
it('logout revokes the session on the server',async()=>{expect((await call('/auth/logout',{},a)).status).toBe(200);expect((await call('/auth/me',undefined,a)).status).toBe(401);});
it('persists only owned real results, rejects inconsistent counts, resumes and ends high-effort runs',async()=>{
 const p=(await call('/auth/me',undefined,b)).data.plan;
 const r=await call('/workouts',{version:p.version,demo:false},b),ex=r.data.plan.exercises[0];
 const body={index:0,summary:{exerciseId:ex.exerciseId,reps:{valid:1,compensated:0,partial:0},rpe:8,romPct:90,flags:{trunk_lean:1}},moments:[{cls:'valid',durSec:2.4,peakPct:.9}]};
 expect((await call('/workouts',{version:p.version,demo:false},b)).data.id).toBe(r.data.id);
 expect((await call(`/workouts/${r.data.id}/sets`,{...body,moments:[]},b)).status).toBe(400);
 expect((await call(`/workouts/${r.data.id}/sets`,body,b)).data.saved).toBe(true);
 const records=(await call('/sessions',undefined,b)).data.records;expect(records).toHaveLength(1);expect(records[0].flags.trunk_lean).toBe(1);
 expect((await call(`/workouts/${r.data.id}/sets`,{...body,index:1},b)).status).toBe(409);
 expect((await call('/workouts',{version:p.version,demo:false},b)).data.error).toBe('RECOVERY');
});
