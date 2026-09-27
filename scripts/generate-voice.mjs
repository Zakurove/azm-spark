// Regenerates the bundled coaching cues with Google's Gemini text to speech (gemini-3.8-flash-tts).
// Build-time only: the key comes from the environment or .env.local, only the public coaching
// script is sent, and the browser never contacts a speech service at runtime.
//
// Usage: node scripts/generate-voice.mjs [--voice-ar NAME] [--voice-en NAME] [--only id1,id2]
//                                        [--out DIR] [--model ID] [--dry-run]
// Needs GEMINI_API_KEY (environment or .env.local) and ffmpeg on PATH. The key is never printed.
//
// Pipeline per cue: Gemini returns 24 kHz 16-bit mono WAV → ffmpeg trims leading and trailing
// silence gently, normalizes loudness (EBU R128, two pass, -16 LUFS integrated, -1.5 dBTP) and
// encodes MP3 (mono, 44.1 kHz, 64 kbps) under the same file names in <out>/{ar,en}.
import {readFile,writeFile,mkdir,mkdtemp,rm,rename} from 'node:fs/promises';
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
// Featured prebuilt voices (both male, low pitch in Google's voice library). Provisional until
// the voice audition is signed off; override per run with --voice-ar / --voice-en.
export const DEFAULT_VOICES={ar:'Algieba',en:'Achird'};
// Delivery notes go in speech_metadata.style; the text field is read verbatim. Google advises
// keeping style short, so each is a single compact brief.
export const INSTRUCTIONS={
 ar:'A calm, warm, encouraging Saudi fitness coach guiding gentle exercises. Unhurried pace with soft pauses at commas and full stops. Clear Arabic that follows every diacritic exactly as written; never add words.',
 en:'A calm, warm, encouraging fitness coach guiding gentle exercises. Unhurried pace with soft pauses at punctuation, clear and natural. Read exactly as written; never add words.',
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
 return id.startsWith('count_')?NUMBER_WORDS[Number(id.slice(6))-1]:line.en;
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

function parseArgs(argv){
 const opts={voices:{...DEFAULT_VOICES},only:null,out:join(ROOT,'public/cues'),model:MODEL,dryRun:false};
 for(let i=0;i<argv.length;i++){
  const a=argv[i],next=()=>{const v=argv[++i];if(!v||v.startsWith('--'))throw new Error(`${a} needs a value`);return v;};
  if(a==='--voice-ar')opts.voices.ar=next();
  else if(a==='--voice-en')opts.voices.en=next();
  else if(a==='--only')opts.only=next().split(',').map(s=>s.trim()).filter(Boolean);
  else if(a==='--out')opts.out=resolve(next());
  else if(a==='--model')opts.model=next();
  else if(a==='--dry-run')opts.dryRun=true;
  else throw new Error(`unknown option ${a}`);
 }
 return opts;
}

async function main(){
 let opts;
 try{opts=parseArgs(process.argv.slice(2));}catch(err){console.error(err.message);process.exit(2);}
 const script=JSON.parse(await readFile(join(ROOT,'src/app/voice-script.json'),'utf8'));
 const ids=opts.only??Object.keys(script);
 const unknown=ids.filter(id=>!script[id]);
 if(unknown.length){console.error(`unknown cue ids: ${unknown.join(', ')}`);process.exit(2);}
 const jobs=ids.flatMap(id=>['ar','en'].map(lang=>({id,lang,voice:opts.voices[lang],text:inputFor(lang,id,script[id]),style:styleFor(lang,id),path:join(opts.out,lang,`${id}.mp3`)})));
 const writesManifest=resolve(opts.out)===resolve(ROOT,'public/cues');

 if(opts.dryRun){
  console.log(`${opts.model} via ${ENDPOINT}\nvoices ar=${opts.voices.ar} en=${opts.voices.en}\nout ${opts.out}${writesManifest?' (manifest will be updated)':''}`);
  for(const j of jobs)console.log(`${j.path}  [${j.voice}]  ${j.text}`);
  console.log(`${jobs.length} cues, nothing sent (dry run)`);
  return;
 }
 const key=await loadKey();
 if(!key){console.error('GEMINI_API_KEY is required (environment or .env.local)');process.exit(1);}
 try{await run('ffmpeg',['-version']);}catch{console.error('ffmpeg is required on PATH');process.exit(1);}

 await mkdir(join(opts.out,'ar'),{recursive:true});
 await mkdir(join(opts.out,'en'),{recursive:true});
 const work=await mkdtemp(join(tmpdir(),'azm-voice-'));
 const written=[];let failed=0,halted=false;
 const queue=[...jobs];
 try{
  await Promise.all(Array.from({length:2},async()=>{
   while(queue.length&&!halted){
    const job=queue.shift();
    try{
     const wav=await synthesize({key,model:opts.model,text:job.text,voice:job.voice,style:job.style,label:`${job.lang}/${job.id}`});
     const seconds=await encodeCue(wav,job.path,work);
     const warn=paceWarning(job.lang,job.text,seconds);
     if(warn)console.error(`\nCHECK ${job.lang}/${job.id}: ${warn}`);
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

 if(writesManifest&&written.length){
  // Per cue provenance survives partial (--only) runs; cues not rendered here keep their record.
  let prev={};
  try{prev=JSON.parse(await readFile(join(opts.out,'manifest.json'),'utf8'));}catch{}
  const cues={};
  for(const id of Object.keys(script))for(const lang of ['ar','en']){
   const rec=prev.cues?.[id]?.[lang]??(prev.model?{provider:prev.provider??'OpenAI speech API',model:prev.model,voice:prev.voices?.[lang]}:null);
   if(rec)(cues[id]??={})[lang]=rec;
  }
  const generatedAt=new Date().toISOString();
  for(const j of written)(cues[j.id]??={})[j.lang]={provider:PROVIDER,model:opts.model,voice:j.voice,generatedAt};
  await writeFile(join(opts.out,'manifest.json'),JSON.stringify({
   provider:PROVIDER,model:opts.model,endpoint:ENDPOINT,voices:opts.voices,instructions:INSTRUCTIONS,
   delivery:DELIVERY,generatedAt,cues,script,
  },null,2)+'\n');
  console.log('manifest updated');
 }
 if(failed||halted)process.exit(1);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
