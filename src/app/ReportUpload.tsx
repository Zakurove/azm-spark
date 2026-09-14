import { useRef, useState } from 'react';
import { Lang } from './i18n';
import { labels, errorText } from './platform-copy';
import { api } from './api';
import Icon from './Icon';

export interface ReportResult {
 document:string;
 extracted:{age:number|null;conditions:string[];diagnosisNotes:string;medications:string;mobility:string;support:string;pain:string[];restrictions:string[];symptoms:string;recentChange:string};
 missing:string[];questions:string[];summary:string;confidence:string;
}

/** Optional medical-report analysis panel shown at the top of a fresh intake.
 * The image is downscaled client-side; on any failure the form continues manually. */
export default function ReportUpload({lang,onExtracted}:{lang:Lang;onExtracted:(r:ReportResult)=>void}){
 const c=labels(lang);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(true),[text,setText]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 if(!open)return null;

 const analyze=async(body:{kind:'text';text:string}|{kind:'image';image:string})=>{
  setBusy(true);setError('');
  try{
   const result=await api<ReportResult>('/medical-report',{...body,lang});
   if(result.document==='not_medical'||result.document==='unreadable'){setError('NOT_MEDICAL');return;}
   onExtracted(result);setOpen(false);
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 };

 const onFile=async(file:File)=>{
  const image=await downscale(file);
  if(!image){setError('REPORT_INVALID');return;}
  await analyze({kind:'image',image});
 };

 return <section className="report-upload" aria-label={c.reportTitle}>
  <div className="report-heading"><span className="landing-feature-icon report-icon"><Icon name="health" size={19}/></span><div><h3>{c.reportTitle}</h3><p>{c.reportBody}</p></div></div>
  {busy?<div className="report-busy"><span className="report-spinner" aria-hidden/>{c.reportBusy}</div>:<>
  <div className="report-actions">
   <button type="button" className="ghost" onClick={()=>fileRef.current?.click()}><Icon name="camera" size={16}/>{c.reportUpload}</button>
   <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void onFile(f);e.target.value='';}}/>
  </div>
  <label className="field report-paste"><span>{c.reportPaste}</span><textarea rows={3} maxLength={20000} value={text} onChange={e=>setText(e.target.value)}/></label>
  {text.trim().length>0&&<button type="button" className="cta report-analyze" onClick={()=>void analyze({kind:'text',text:text.trim()})}>{c.reportAnalyze}<Icon name="arrow" size={16}/></button>}
  {error&&<p className="form-error" role="alert">{error==='NOT_MEDICAL'?c.reportNotMedical:errorText(error,lang)}</p>}
  <div className="report-foot"><button type="button" className="text-button" onClick={()=>setOpen(false)}>{c.reportSkip}</button></div>
  <p className="field-help report-privacy">{c.reportPrivacy}</p>
  </>}
 </section>;
}

async function downscale(file:File):Promise<string|null>{
 try{
  const url=URL.createObjectURL(file);
  const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=url;});
  URL.revokeObjectURL(url);
  const long=Math.max(img.width,img.height),scale=Math.min(1,1600/long);
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.8);
 }catch{return null;}
}
