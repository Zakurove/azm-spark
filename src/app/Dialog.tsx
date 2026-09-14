import { ReactNode, useEffect, useRef } from 'react';
export default function Dialog({titleId,children}:{titleId:string;children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.focus();return()=>previous?.focus();},[]);
 return <div className="modal"><div ref={ref} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={e=>{if(e.key!=='Tab')return;const els=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled),[href],input:not(:disabled)'));const first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first?.focus();}}}>{children}</div></div>;
}
