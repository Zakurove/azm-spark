// One-off port of the Azm 2.0 adaptive exercise library into a static bilingual JSON.
// Source: ~/Development/Azm2.0/server/seed-exercises.ts (self-authored, proprietary).
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {transform} from 'esbuild';

const src=await readFile(`${homedir()}/Development/Azm2.0/server/seed-exercises.ts`,'utf8');
const {code}=await transform(src,{loader:'ts',format:'esm'});
const {exerciseData}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const seen=new Set();
const library=exerciseData.map(e=>{
 let id=slug(e.name);while(seen.has(id))id+='_2';seen.add(id);
 return {
  id,
  name:{ar:e.nameAr,en:e.name},
  description:{ar:e.descriptionAr,en:e.description},
  category:e.category,
  muscles:e.targetMuscles??[],
  equipment:e.equipment??[],
  difficulty:e.difficulty,
  minutes:e.duration,
  steps:{ar:e.instructionsAr??[],en:e.instructions??[]},
  tags:e.disabilityTags??[],
  contraindications:e.contraindications??[],
 };
});
await writeFile('src/exercises/library.json',JSON.stringify(library,null,1)+'\n');
const by=library.reduce((m,e)=>(m[e.category]=(m[e.category]??0)+1,m),{});
console.log(`${library.length} exercises`,by);
