// Regenerates every bundled coaching cue with the OpenAI speech API (gpt-4o-mini-tts).
// Build-time only: the key comes from the environment, only the public coaching script is
// sent, and the browser never contacts a speech service at runtime.
// Usage: OPENAI_API_KEY=... node scripts/generate-voice.mjs
import {readFile,writeFile,mkdir} from 'node:fs/promises';

const key=process.env.OPENAI_API_KEY;
if(!key){console.error('OPENAI_API_KEY is required');process.exit(1);}
const script=JSON.parse(await readFile('src/app/voice-script.json','utf8'));
const VOICE='ash';
const INSTRUCTIONS={
 ar:'You are a calm, warm Saudi fitness coach guiding gentle exercises. Speak Modern Standard Arabic with clear, natural delivery. Read the text EXACTLY as written, honoring every diacritic (tashkeel) precisely, including sukun at pause. Slow, unhurried pace; short pauses at commas and periods; low, reassuring, encouraging energy. Never add or repeat words.',
 en:'You are a calm, warm fitness coach guiding gentle exercises. Speak British English (en-GB). Unhurried pace, clear articulation, short pauses at punctuation, reassuring and encouraging tone. Read the text exactly as written; never add words.',
 count:'Say only this single number, crisply and encouragingly, about one second long.',
};

const jobs=[];
for(const [id,line] of Object.entries(script)){
 const isCount=id.startsWith('count_');
 jobs.push({path:`public/cues/ar/${id}.mp3`,input:line.arTts??line.ar,instructions:isCount?`${INSTRUCTIONS.ar} ${INSTRUCTIONS.count}`:INSTRUCTIONS.ar});
 jobs.push({path:`public/cues/en/${id}.mp3`,input:isCount?numberWord(id):line.en,instructions:isCount?`${INSTRUCTIONS.en} ${INSTRUCTIONS.count}`:INSTRUCTIONS.en});
}
function numberWord(id){return ['one','two','three','four','five','six','seven','eight','nine','ten'][Number(id.slice(6))-1];}

await mkdir('public/cues/ar',{recursive:true});
await mkdir('public/cues/en',{recursive:true});
let done=0,failed=0;
async function render(job,attempt=1){
 try{
  const r=await fetch('https://api.openai.com/v1/audio/speech',{
   method:'POST',
   headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   body:JSON.stringify({model:'gpt-4o-mini-tts',voice:VOICE,input:job.input,instructions:job.instructions,response_format:'mp3'}),
  });
  if(!r.ok)throw new Error(`${r.status} ${(await r.text()).slice(0,200)}`);
  await writeFile(job.path,Buffer.from(await r.arrayBuffer()));
  done++;process.stdout.write(`\r${done}/${jobs.length} rendered`);
 }catch(err){
  if(attempt<3){await new Promise(x=>setTimeout(x,1500*attempt));return render(job,attempt+1);}
  failed++;console.error(`\nFAILED ${job.path}: ${err.message}`);
 }
}
const queue=[...jobs];
await Promise.all(Array.from({length:3},async()=>{while(queue.length)await render(queue.shift());}));
console.log(`\n${done} rendered, ${failed} failed`);
if(failed)process.exit(1);

await writeFile('public/cues/manifest.json',JSON.stringify({
 model:'gpt-4o-mini-tts',voices:{ar:VOICE,en:VOICE},instructions:INSTRUCTIONS,
 delivery:'local bundled MP3',script,
},null,2)+'\n');
console.log('manifest updated');
