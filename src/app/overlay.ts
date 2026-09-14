import { Frame, LM } from '../engine/types';
export interface OverlayState {
 contextLandmarks:Set<number>; flashJoints:Set<number>; mirrored:boolean;
 demo?:boolean; sourceWidth?:number; sourceHeight?:number;
}
/** A single projection shared by every joint and connection. Demo traces use
 * uniform units; real landmarks follow the video's object-fit:contain mapping. */
export function projection(width:number,height:number,st:Pick<OverlayState,'demo'|'sourceWidth'|'sourceHeight'|'mirrored'>) {
 const sourceW=st.demo?1:st.sourceWidth||width,sourceH=st.demo?1:st.sourceHeight||height;
 const scale=Math.min(width/sourceW,height/sourceH);
 const w=sourceW*scale,h=sourceH*scale;
 return (x:number,y:number)=>({x:(width-w)/2+(st.mirrored?1-x:x)*w,y:(height-h)/2+y*h});
}
export function drawOverlay(ctx:CanvasRenderingContext2D,frame:Frame,st:OverlayState) {
 const {width:W,height:H}=ctx.canvas;ctx.clearRect(0,0,W,H);if(!W||!H)return;
 const project=projection(W,H,st),p=(i:number)=>project(frame.lm[i].x,frame.lm[i].y);
 const u=Math.min(W,H),bones=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]];
 ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
 for(const[a,b]of bones){if(frame.lm[a].visibility<.35||frame.lm[b].visibility<.35)continue;const A=p(a),B=p(b);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.strokeStyle=st.demo?'#A0ADA9':'#FFFFFFA8';ctx.lineWidth=Math.max(1.5,u*.007);ctx.stroke();}
 if(st.demo){const l=p(LM.l_ear),r=p(LM.r_ear);ctx.beginPath();ctx.arc((l.x+r.x)/2,(l.y+r.y)/2,u*.045,0,Math.PI*2);ctx.strokeStyle='#A0ADA9';ctx.lineWidth=u*.007;ctx.stroke();}
 for(const i of [11,12,13,14,15,16,23,24,25,26,27,28]){if(frame.lm[i].visibility<.35)continue;const q=p(i),flag=st.flashJoints.has(i),dim=st.contextLandmarks.has(i)||frame.lm[i].visibility<.5;const radius=u*(st.demo?.017:.009);if(flag){ctx.beginPath();ctx.arc(q.x,q.y,radius*2,0,Math.PI*2);ctx.fillStyle='#DD861D40';ctx.fill();}ctx.beginPath();ctx.arc(q.x,q.y,radius,0,Math.PI*2);ctx.fillStyle=flag?'#CF7715':dim?'#AAB2AE':'#258568';ctx.fill();ctx.strokeStyle='#FFFFFF';ctx.lineWidth=Math.max(1,u*.003);ctx.stroke();if(flag){ctx.beginPath();ctx.moveTo(q.x,q.y-radius*.4);ctx.lineTo(q.x,q.y+radius*.3);ctx.stroke();}}
 ctx.restore();
}
