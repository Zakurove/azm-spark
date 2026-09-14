import { createRequire } from 'node:module';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { randomBytes,randomUUID,createHash,scrypt as derive,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { createPlan,validateIntake,Plan,Prescription } from '../src/medical/plan';
const scrypt=promisify(derive);
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function createApi(path=process.env.AZM_DATABASE??'.data/azm.sqlite'){
 if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),intake TEXT NOT NULL,plan TEXT NOT NULL,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workouts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),plan TEXT NOT NULL,version INTEGER NOT NULL,demo INTEGER NOT NULL,position INTEGER DEFAULT 0,ended INTEGER DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workout_id TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(workout_id,position));`);
 const rates=new Map<string,{n:number;until:number}>();
 function limited(key:string,max=12){const now=Date.now();for(const[k,v]of rates)if(v.until<now)rates.delete(k);const v=rates.get(key)??{n:0,until:now+900000};v.n++;rates.set(key,v);return v.n>max;}
 const userView=(u:any)=>({id:u.id,name:u.name,email:u.email,role:'member'});
 const profile=(id:string)=>{const p=db.prepare('SELECT * FROM profiles WHERE user_id=?').get(id) as any;return p?{intake:JSON.parse(p.intake),plan:{...JSON.parse(p.plan),version:p.version}}:{intake:null,plan:null};};
 async function handle(req:IncomingMessage,res:ServerResponse,next?:()=>void){
  const url=new URL(req.url??'/',`http://${req.headers.host}`);const route=url.pathname;
  if(!route.startsWith('/api/'))return next?.();
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const mutation=!['GET','HEAD'].includes(req.method??'GET');
  if(mutation){const expected=process.env.AZM_ORIGIN??`http://${req.headers.host}`;if(req.headers.origin!==expected||req.headers['x-azm-request']!=='1')return json(403,{error:'ORIGIN'});}
  let body:any={};
  try{
   if(mutation){if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON_REQUIRED'});let size=0;const parts:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return json(413,{error:'TOO_LARGE'});parts.push(Buffer.from(chunk));}body=JSON.parse(Buffer.concat(parts).toString()||'{}');if(!body||typeof body!=='object'||Array.isArray(body))return json(400,{error:'INVALID'});}
   const raw=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('azm_session='))?.slice(12)??'';
   const token=digest(raw);const u=db.prepare('SELECT users.* FROM sessions JOIN users ON sessions.user_id=users.id WHERE sessions.token=? AND sessions.expires>?').get(token,Date.now()) as any;
   const cookie=(value:string,age:number)=>res.setHeader('Set-Cookie',`azm_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`);
   if(route==='/api/auth/register'||route==='/api/auth/login'){
    if(req.method!=='POST')return json(405,{error:'METHOD'});
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';const password=body.password;
    if(limited(`ip:${req.socket.remoteAddress}`,30)||limited(`email:${email}`))return json(429,{error:'RATE_LIMIT'});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<10||password.length>128)return json(400,{error:'CREDENTIAL_FORMAT'});
    let account:any;
    if(route.endsWith('register')){
     if(typeof body.name!=='string'||body.name.trim().length<2||body.name.trim().length>80)return json(400,{error:'NAME'});
     if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return json(409,{error:'ACCOUNT_EXISTS'});
     const salt=randomBytes(16).toString('hex');const hash=(await scrypt(password,salt,64)) as Buffer;
     const id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,email,body.name.trim(),`${salt}:${hash.toString('hex')}`,Date.now());account=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }else{
     account=db.prepare('SELECT * FROM users WHERE email=?').get(email) as any;
     const[salt,hash]=(account?.password??`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');const supplied=await scrypt(password,salt,64) as Buffer;
     if(!account||!timingSafeEqual(supplied,Buffer.from(hash,'hex')))return json(401,{error:'CREDENTIALS'});
    }
    db.prepare('DELETE FROM sessions WHERE token=? OR expires<?').run(token,Date.now());const fresh=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(fresh),account.id,Date.now()+86400000*7);cookie(fresh,604800);
    return json(200,{user:userView(account),...profile(account.id)});
   }
   if(!u)return json(401,{error:'AUTH_REQUIRED'});
   if(route==='/api/auth/me'&&req.method==='GET')return json(200,{user:userView(u),...profile(u.id)});
   if(route==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(token);cookie('',0);return json(200,{ok:true});}
   if(route==='/api/intake'&&req.method==='PUT'){
    if(!validateIntake(body))return json(400,{error:'INTAKE_INVALID'});
    const plan=createPlan(body);const old=db.prepare('SELECT version FROM profiles WHERE user_id=?').get(u.id) as any;const version=(old?.version??0)+1;
    db.prepare('INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET intake=excluded.intake,plan=excluded.plan,version=excluded.version').run(u.id,JSON.stringify(body),JSON.stringify(plan),version);
    return json(200,{intake:body,plan:{...plan,version}});
   }
   if(route==='/api/sessions'&&req.method==='GET'){const rows=db.prepare('SELECT data FROM results WHERE user_id=? ORDER BY rowid DESC').all(u.id) as any[];return json(200,{records:rows.map(r=>JSON.parse(r.data))});}
   if(route==='/api/workouts'&&req.method==='POST'){
    const p=profile(u.id);if(!p.plan||p.plan.status!=='ready'||body.version!==p.plan.version)return json(409,{error:'PLAN_REQUIRED'});
    const demo=body.demo===true;
    if(!demo){
     const active=db.prepare('SELECT id,position FROM workouts WHERE user_id=? AND version=? AND demo=0 AND ended=0 ORDER BY created DESC LIMIT 1').get(u.id,p.plan.version) as any;
     if(active)return json(200,{id:active.id,demo:false,plan:p.plan,nextIndex:active.position});
     const last=db.prepare('SELECT data FROM results WHERE user_id=? ORDER BY rowid DESC LIMIT 1').get(u.id) as any;
     if(last&&Date.now()-JSON.parse(last.data).endedAt<p.plan.recoveryHours*3600000)return json(409,{error:'RECOVERY'});
    }
    const id=randomUUID();db.prepare('INSERT INTO workouts(id,user_id,plan,version,demo,created) VALUES(?,?,?,?,?,?)').run(id,u.id,JSON.stringify(p.plan),p.plan.version,Number(demo),Date.now());return json(200,{id,demo,plan:p.plan});
   }
   const match=route.match(/^\/api\/workouts\/([a-f0-9-]+)\/sets$/);
   if(match&&req.method==='POST'){
    const run=db.prepare('SELECT * FROM workouts WHERE id=? AND user_id=?').get(match[1],u.id) as any;
    if(!run)return json(404,{error:'NOT_FOUND'});
    const current=profile(u.id);if(current.plan?.version!==run.version||current.plan?.status!=='ready')return json(409,{error:'PLAN_CHANGED'});
    const plan=JSON.parse(run.plan) as Plan;const sets=plan.exercises.flatMap((e:Prescription)=>Array.from({length:e.sets},()=>e));
    if(run.ended||body.index!==run.position||body.index>=sets.length)return json(409,{error:'SET_ORDER'});
    const s=body.summary,e=sets[body.index];
    if(!s||s.exerciseId!==e.exerciseId||!s.reps||!['valid','compensated','partial'].every(k=>Number.isInteger(s.reps[k])&&s.reps[k]>=0&&s.reps[k]<=100)||s.rpe!=null&&(!Number.isInteger(s.rpe)||s.rpe<0||s.rpe>10)||s.romPct!=null&&(!Number.isFinite(s.romPct)||s.romPct<0||s.romPct>100)||!Array.isArray(body.moments)||body.moments.length>300||!body.moments.every((m:any)=>m&&['valid','compensated','partial'].includes(m.cls)&&Number.isFinite(m.durSec)&&m.durSec>=0&&m.durSec<3600&&Number.isFinite(m.peakPct)&&m.peakPct>=0&&m.peakPct<10))return json(400,{error:'RESULT_INVALID'});
    if(!['valid','compensated','partial'].every(k=>body.moments.filter((m:any)=>m.cls===k).length===s.reps[k]))return json(400,{error:'RESULT_INVALID'});
    const flags=Object.fromEntries(Object.entries(s.flags??{}).filter(([k,v])=>/^[a-zA-Z0-9_-]{1,80}$/.test(k)&&Number.isInteger(v)&&Number(v)>=0&&Number(v)<=10000).slice(0,50));
    const now=Date.now();const data={exerciseId:e.exerciseId,profileId:e.setup.position==='wheelchair'?'wheelchair':e.setup.support==='none'?'standing':`hemiparesis_${e.setup.support}`,startedAt:Number.isFinite(s.startedAt)?Math.min(now,Math.max(run.created,s.startedAt)):run.created,endedAt:now,reps:s.reps,rpe:s.rpe,romPct:s.romPct,flags,moments:body.moments.map((m:any)=>({cls:m.cls,durSec:m.durSec,peakPct:m.peakPct})),mode:'camera',setup:e.setup};
    db.exec('BEGIN');try{if(!run.demo)db.prepare('INSERT INTO results VALUES(?,?,?,?,?)').run(randomUUID(),u.id,run.id,body.index,JSON.stringify(data));db.prepare('UPDATE workouts SET position=position+1,ended=? WHERE id=?').run(Number(body.index+1===sets.length||s.rpe>=8),run.id);db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}
    return json(200,{saved:!run.demo,record:run.demo?null:data});
   }
   return json(404,{error:'NOT_FOUND'});
  }catch(error){if(error instanceof SyntaxError)return json(400,{error:'INVALID_JSON'});console.error('AZM API request failed',error instanceof Error?error.name:'Error');return json(500,{error:'SERVER'});}
 }
 return {handle,close:()=>db.close()};
}
