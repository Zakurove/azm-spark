// Renders a voice pack of the coaching cues with Google's Gemini text to speech (gemini-3.8-flash-tts).
// Build-time only: the key comes from the environment or .env.local, only the public coaching
// script is sent, and the browser never contacts a speech service at runtime. How to: scripts/VOICE.md.
//
// Usage: node scripts/generate-voice.mjs --pack ID [--voice-ar NAME --voice-en NAME] [--only id1,id2]
//                                        [--model ID] [--dry-run] [--verify [MODEL]]
// Needs GEMINI_API_KEY (environment or .env.local) and ffmpeg on PATH. The key is never printed.
//
// A pack is one voice per language: public/cues/packs/<pack>/{ar,en}/<cue>.mp3 with its provenance in
// <pack>/manifest.json. A new pack names both voices; a later run on the same pack keeps them. Every
// pack carries the welcome (preview), the sample the coach settings play. After a run the pack is
// listed in public/cues/packs/index.json (its line count and whether it is complete); the "default"
// there is edited by hand. The app plays a line missing from a pack from the default pack.
//
// Pipeline per cue: Gemini returns 24 kHz 16-bit mono WAV → ffmpeg trims leading and trailing
// silence gently, normalizes loudness (EBU R128, two pass, -16 LUFS integrated, -1.5 dBTP) and
// encodes MP3 (mono, 44.1 kHz, 64 kbps).
// Input text: arTts ?? ar in Arabic, enTts ?? en in English (a text used only for speech, such as
// the welcome that says the brand name clearly).
//
// --verify is the render gate of the voice audition decision (fix 8): a Gemini text model
// transcribes every render, and the render is kept only when the words heard equal the words sent
// (any added, dropped or changed word fails, such as تَسْتَطِيعُهُ) and a long Arabic line is not
// read faster than 6.3 letters per second. A failed render is tried once more, then reported; the
// cue already on disk is left as it was. Each verified cue costs one extra transcription call.
import {readFile,writeFile,mkdir,mkdtemp,rm,rename,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const run=promisify(execFile);
const ROOT=fileURLToPath(new URL('..',import.meta.url));

export const PROVIDER='Google Gemini API text to speech';
export const MODEL='gemini-3.8-flash-tts';
export const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
export const PACKS_DIR=join(ROOT,'public/cues/packs');
// The provider named in the pack index (the manifest records PROVIDER in full).
export const PACK_PROVIDER='Google Gemini';
// Delivery notes go in speech_metadata.style; the text field is read verbatim. Google advises
// keeping style short, so each is a single compact brief.
export const INSTRUCTIONS={
 ar:'A calm, warm, encouraging Saudi fitness coach guiding gentle exercises. Unhurried, gentle, steady delivery with soft pauses at commas and full stops. Clear Arabic that follows every diacritic exactly as written; never add words.',
 en:'A calm, warm, encouraging fitness coach guiding gentle exercises. Unhurried, gentle, steady delivery with soft pauses at punctuation, clear and natural. Read exactly as written; never add words.',
 count:'Say only this one number, crisp and encouraging, about one second long.',
};
const LOUDNESS={I:-16,TP:-1.5,LRA:11};
export const DELIVERY='local bundled MP3 (mono, 44.1 kHz, 64 kbps), EBU R128 loudness normalized to -16 LUFS integrated (-1.5 dBTP), leading and trailing silence trimmed gently';
// Keep 80 ms before speech and 150 ms after it; anything quieter than -50 dB counts as silence.
const TRIM='silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse';
const RETRYABLE=new Set([408,429,500,502,503,504]);
const NUMBER_WORDS=['one','two','three','four','five','six','seven','eight','nine','ten'];

export function styleFor(lang,id){
 const base=INSTRUCTIONS[lang];
 return id.startsWith('count_')?`${base} ${INSTRUCTIONS.count}`:base;
}
export function inputFor(lang,id,line){
 if(lang==='ar')return line.arTts??line.ar;
 return id.startsWith('count_')?NUMBER_WORDS[Number(id.slice(6))-1]:line.enTts??line.en;
}

export async function loadKey(){
 if(process.env.GEMINI_API_KEY)return process.env.GEMINI_API_KEY.trim();
 try{
  for(const raw of (await readFile(join(ROOT,'.env.local'),'utf8')).split(/\r?\n/)){
   const m=raw.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*)\s*$/);
   if(m)return m[1].replace(/^(['"])(.*)\1$/,'$2').trim();
  }
 }catch{}
 return '';
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function scrub(text,key){return key?String(text).split(key).join('[redacted]'):String(text);}
function retryDelayMs(res,body,attempt){
 const header=Number(res?.headers?.get('retry-after'));
 if(header>0)return header*1000;
 // Google hints the wait either as RetryInfo ("retryDelay": "21s") or in the message ("retry in 6s").
 const hinted=/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"|retry in (\d+(?:\.\d+)?)\s*s/i.exec(body??'');
 if(hinted)return Math.ceil(Number(hinted[1]??hinted[2])*1000)+1000+Math.floor(Math.random()*1000);
 return Math.min(60000,2000*2**(attempt-1))+Math.floor(Math.random()*500);
}

// One text to speech call. Returns the WAV bytes (24 kHz, 16-bit, mono) Gemini sends back.
export async function synthesize({key,text,voice,style,model=MODEL,attempts=8,label=''}){
 const body=JSON.stringify({
  model,
  input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style}]}]}],
  response_format:{type:'audio',mime_type:'audio/wav'},
  generation_config:{speech_config:[{voice}]},
 });
 for(let attempt=1;;attempt++){
  let res,raw='',retry=false,message;
  try{
   res=await fetch(ENDPOINT,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(120000)});
   raw=await res.text();
   if(res.ok){
    const data=JSON.parse(raw);
    const audio=(data.steps??[]).filter(s=>s.type==='model_output').flatMap(s=>s.content??[]).filter(c=>c.type==='audio'&&c.data).at(-1);
    if(audio&&data.status!=='failed')return Buffer.from(audio.data,'base64');
    retry=true;message=`no audio in response (status ${data.status??'unknown'})`;
   }else if(res.status===429&&/per day/i.test(raw)){
    // A daily cap does not lift in seconds, whatever the "retry in" hint says. Stop the run.
    const err=new Error(scrub(`daily quota reached for ${model}: ${raw.slice(0,300)}`,key));
    err.daily=true;throw err;
   }else{
    retry=RETRYABLE.has(res.status);message=`HTTP ${res.status} ${raw.slice(0,300)}`;
   }
  }catch(err){if(err.daily)throw err;retry=true;message=err.message;}
  if(!retry||attempt>=attempts)throw new Error(scrub(message,key));
  const wait=retryDelayMs(res,raw,attempt);
  console.error(`\n${label} retry ${attempt}/${attempts-1} in ${Math.round(wait/1000)} s: ${scrub(message,key).slice(0,120)}`);
  await sleep(wait);
 }
}

async function probeDuration(file){
 const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file]);
 return Number(stdout.trim());
}

// WAV bytes → trimmed, loudness normalized MP3 at outPath. Returns the MP3 duration in seconds.
export async function encodeCue(wav,outPath,workDir){
 const src=join(workDir,`${Math.random().toString(36).slice(2)}.wav`);
 await writeFile(src,wav);
 try{
  const loud=`loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
  const {stderr}=await run('ffmpeg',['-hide_banner','-nostats','-i',src,'-af',`${TRIM},${loud}:print_format=json`,'-f','null','-']);
  const m=JSON.parse(stderr.slice(stderr.lastIndexOf('{'),stderr.lastIndexOf('}')+1));
  const measured=Number.isFinite(Number(m.input_i))
   ?`:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`:'';
  const tmp=`${outPath}.part.mp3`;
  await run('ffmpeg',['-hide_banner','-nostats','-y','-i',src,'-af',`${TRIM},${loud}${measured},aresample=44100`,
   '-ac','1','-ar','44100','-c:a','libmp3lame','-b:a','64k','-map_metadata','-1',tmp]);
  await rename(tmp,outPath);
  return probeDuration(outPath);
 }finally{await rm(src,{force:true});}
}

// Rough pace check so truncated or padded renders stand out (it cannot judge pronunciation).
const DIACRITICS=/[\u064B-\u0652\u0670\u0640]/g;
export function paceWarning(lang,text,seconds){
 if(lang==='ar'){
  const letters=text.replace(DIACRITICS,'').replace(/[^\u0621-\u064A]/g,'').length;
  if(letters<8)return '';
  const rate=letters/seconds;
  return rate>16?`only ${seconds.toFixed(2)} s for ${letters} letters, possibly truncated`:rate<3?`${seconds.toFixed(2)} s for ${letters} letters, possibly padded or added words`:'';
 }
 const words=text.split(/\s+/).filter(Boolean).length;
 if(words<3)return '';
 const rate=words/seconds;
 return rate>4.5?`only ${seconds.toFixed(2)} s for ${words} words, possibly truncated`:rate<0.8?`${seconds.toFixed(2)} s for ${words} words, possibly padded or added words`:'';
}

// Pace gate (voice audition decision, fix 8): a long Arabic line read faster than about 6.3
// letters per second is rendered again (today's cues run at about 5.5).
export const PACE_GATE={maxArLettersPerSec:6.3,minLetters:20};
export function arLetters(text){return text.replace(DIACRITICS,'').replace(/[^\u0621-\u064A]/g,'').length;}
export function paceGate(lang,text,seconds){
 if(lang!=='ar'||!(seconds>0))return '';
 const letters=arLetters(text);
 if(letters<PACE_GATE.minLetters)return '';
 const rate=letters/seconds;
 return rate>PACE_GATE.maxArLettersPerSec?`${rate.toFixed(1)} letters/s is faster than ${PACE_GATE.maxArLettersPerSec}`:'';
}

// Transcript gate: the words heard must equal the words sent. Arabic compares the unvocalized
// skeleton of each word (hamza seats, alef maqsura and ta marbuta folded), so a missing or extra
// case ending is not a failure but an added pronoun (تستطيعه) or a changed word is. English
// compares lower case words, digits read as words.
export const TRANSCRIBE_MODEL='gemini-3.8-flash';
const TRANSCRIBE_PROMPT={
 ar:'Transcribe this Arabic speech exactly as spoken, word for word. Write numbers as Arabic words exactly as spoken, never as digits. Do not correct, complete or normalize anything. Output only the transcript.',
 en:'Transcribe this English speech exactly as spoken, word for word. Write numbers as words. Do not correct, complete or normalize anything. Output only the transcript.',
};
export function spokenWords(lang,text){
 if(lang==='ar')return text.replace(DIACRITICS,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[^\u0621-\u064A\s]/g,' ').split(/\s+/).filter(Boolean);
 return text.toLowerCase().replace(/[’']/g,'').replace(/\b(10|[1-9])\b/g,d=>NUMBER_WORDS[Number(d)-1])
  .replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(Boolean);
}
export function transcriptGate(lang,sent,heard){
 if(typeof heard!=='string'||!heard.trim())return 'no transcript';
 const a=spokenWords(lang,sent),b=spokenWords(lang,heard);
 return a.length===b.length&&a.every((w,i)=>w===b[i])?'':`heard «${heard.trim()}»`;
}
export async function transcribe({key,audio,mime='audio/wav',lang,model=TRANSCRIBE_MODEL,attempts=4}){
 const body=JSON.stringify({contents:[{role:'user',parts:[{inline_data:{mime_type:mime,data:Buffer.from(audio).toString('base64')}},{text:TRANSCRIBE_PROMPT[lang]}]}],generationConfig:{temperature:0}});
 for(let attempt=1;;attempt++){
  let res,raw='',message,fatal=false;
  try{
   res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(90000)});
   raw=await res.text();
   if(res.ok){
    const j=JSON.parse(raw);
    return (j.candidates?.[0]?.content?.parts??[]).filter(p=>!p.thought).map(p=>p.text??'').join('').trim();
   }
   message=`HTTP ${res.status} ${raw.slice(0,300)}`;
   fatal=!RETRYABLE.has(res.status)||/per day/i.test(raw);
  }catch(err){message=err.message;}
  if(fatal||attempt>=attempts)throw new Error(scrub(message,key));
  await sleep(retryDelayMs(res,raw,attempt));
 }
}

export function parseArgs(argv){
 const opts={pack:null,voices:{ar:null,en:null},only:null,model:MODEL,dryRun:false,verify:null};
 for(let i=0;i<argv.length;i++){
  const a=argv[i],next=()=>{const v=argv[++i];if(!v||v.startsWith('--'))throw new Error(`${a} needs a value`);return v;};
  if(a==='--pack')opts.pack=next();
  else if(a==='--voice-ar')opts.voices.ar=next();
  else if(a==='--voice-en')opts.voices.en=next();
  else if(a==='--only')opts.only=next().split(',').map(s=>s.trim()).filter(Boolean);
  else if(a==='--model')opts.model=next();
  else if(a==='--dry-run')opts.dryRun=true;
  else if(a==='--verify')opts.verify=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:TRANSCRIBE_MODEL;
  else throw new Error(`unknown option ${a}`);
 }
 if(!opts.pack)throw new Error('--pack ID is required, such as --pack gemini-achird');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.pack))throw new Error('a pack id is lower case letters and digits joined by single hyphens');
 return opts;
}

// One voice per pack: a new pack names both voices; an existing pack keeps its own, and only a
// pack this generator made can be added to.
export function packVoices(existing,voices){
 if(!existing){
  if(!voices.ar||!voices.en)throw new Error('a new pack needs --voice-ar and --voice-en');
  return {ar:voices.ar,en:voices.en};
 }
 const v=existing.voices;
 if(existing.provider!==PACK_PROVIDER||(voices.ar&&voices.ar!==v.ar)||(voices.en&&voices.en!==v.en))
  throw new Error(`pack ${existing.id} is ${existing.provider} ar=${v.ar} en=${v.en}; use a new --pack id for other voices`);
 return {ar:v.ar,en:v.en};
}

// The pack's line in the index: cueCount counts the script lines it has in both languages.
export function packEntry(id,voices,ids,has){
 const cueCount=ids.filter(line=>has('ar',line)&&has('en',line)).length;
 return {id,label:voices.ar===voices.en?voices.ar:`${voices.ar} / ${voices.en}`,provider:PACK_PROVIDER,voices,cueCount,complete:cueCount===ids.length};
}

// The index with the pack added (or replaced where it was). The default stays; a first pack is it.
export function withPack(index,entry){
 const packs=[...(index?.packs??[])];
 const at=packs.findIndex(p=>p.id===entry.id);
 if(at<0)packs.push(entry);else packs[at]=entry;
 return {default:index?.default??entry.id,packs};
}

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}

async function main(){
 let opts;
 try{opts=parseArgs(process.argv.slice(2));}catch(err){console.error(err.message);process.exit(2);}
 const script=JSON.parse(await readFile(join(ROOT,'src/app/voice-script.json'),'utf8'));
 const indexPath=join(PACKS_DIR,'index.json');
 const index=await readJson(indexPath);
 let voices;
 try{voices=packVoices(index?.packs?.find(p=>p.id===opts.pack),opts.voices);}catch(err){console.error(err.message);process.exit(2);}
 const dir=join(PACKS_DIR,opts.pack);
 const has=(lang,id)=>existsSync(join(dir,lang,`${id}.mp3`));
 const ids=opts.only??Object.keys(script);
 const unknown=ids.filter(id=>!script[id]);
 if(unknown.length){console.error(`unknown cue ids: ${unknown.join(', ')}`);process.exit(2);}
 if(!ids.includes('preview')&&!(has('ar','preview')&&has('en','preview'))){
  ids.unshift('preview');
  console.log('adding preview: every pack carries the welcome the coach settings play');
 }
 const jobs=ids.flatMap(id=>['ar','en'].map(lang=>({id,lang,voice:voices[lang],text:inputFor(lang,id,script[id]),style:styleFor(lang,id),path:join(dir,lang,`${id}.mp3`)})));

 if(opts.dryRun){
  console.log(`${opts.model} via ${ENDPOINT}\npack ${opts.pack}: voices ar=${voices.ar} en=${voices.en}\nout ${dir} (index.json will list it)${opts.verify?`\nverify with ${opts.verify}`:''}`);
  for(const j of jobs)console.log(`${j.path}  [${j.voice}]  ${j.text}`);
  console.log(`${jobs.length} cues, nothing sent (dry run)`);
  return;
 }
 const key=await loadKey();
 if(!key){console.error('GEMINI_API_KEY is required (environment or .env.local)');process.exit(1);}
 try{await run('ffmpeg',['-version']);}catch{console.error('ffmpeg is required on PATH');process.exit(1);}

 await mkdir(join(dir,'ar'),{recursive:true});
 await mkdir(join(dir,'en'),{recursive:true});
 const work=await mkdtemp(join(tmpdir(),'azm-voice-'));
 const written=[];let failed=0,halted=false;
 const queue=[...jobs];
 try{
  await Promise.all(Array.from({length:2},async()=>{
   while(queue.length&&!halted){
    const job=queue.shift();
    try{
     const label=`${job.lang}/${job.id}`;
     let ok=false;
     for(let take=1;take<=(opts.verify?2:1)&&!ok;take++){
      const wav=await synthesize({key,model:opts.model,text:job.text,voice:job.voice,style:job.style,label});
      if(!opts.verify){
       const seconds=await encodeCue(wav,job.path,work);
       const warn=paceWarning(job.lang,job.text,seconds)||paceGate(job.lang,job.text,seconds);
       if(warn)console.error(`\nCHECK ${label}: ${warn}`);
       ok=true;break;
      }
      // Gated: encode into the work folder and copy into place only when both gates pass.
      const staged=join(work,`${job.lang}-${job.id}-${take}.mp3`);
      const seconds=await encodeCue(wav,staged,work);
      const heard=await transcribe({key,audio:wav,lang:job.lang,model:opts.verify});
      const fail=transcriptGate(job.lang,job.text,heard)||paceGate(job.lang,job.text,seconds);
      if(fail){console.error(`\nREJECTED ${label} take ${take}: ${fail}`);continue;}
      await copyFile(staged,job.path);
      ok=true;
     }
     if(!ok)throw new Error('failed the render gate twice; the file on disk is unchanged');
     written.push(job);
     process.stdout.write(`\r${written.length}/${jobs.length} rendered`);
    }catch(err){
     failed++;console.error(`\nFAILED ${job.lang}/${job.id}: ${err.message}`);
     if(err.daily){halted=true;console.error('Stopping: rerun later with --only for the missing ids, or raise the API tier.');}
    }
   }
  }));
 }finally{await rm(work,{recursive:true,force:true});}
 console.log(`\n${written.length} rendered, ${failed} failed${halted?`, ${queue.length} not attempted`:''}`);

 if(written.length){
  // Per cue provenance survives partial (--only) runs; cues not rendered here keep their record.
  const cues=(await readJson(join(dir,'manifest.json')))?.cues??{};
  const generatedAt=new Date().toISOString();
  for(const j of written)(cues[j.id]??={})[j.lang]={model:opts.model,voice:j.voice,generatedAt,text:j.text};
  await writeFile(join(dir,'manifest.json'),JSON.stringify({
   provider:PROVIDER,endpoint:ENDPOINT,voices,instructions:INSTRUCTIONS,delivery:DELIVERY,generatedAt,cues,
  },null,2)+'\n');
  const entry=packEntry(opts.pack,voices,Object.keys(script),has);
  await writeFile(indexPath,JSON.stringify(withPack(index,entry),null,2)+'\n');
  console.log(`pack ${opts.pack}: ${entry.cueCount} of ${Object.keys(script).length} lines${entry.complete?' (complete)':''}; index.json updated`);
 }
 if(failed||halted)process.exit(1);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
