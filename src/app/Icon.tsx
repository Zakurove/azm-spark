export default function Icon({name,size=24}:{name:string;size?:number}) {
 const paths:Record<string,React.ReactNode>={
  health:<><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></>,logout:<><path d="M9 4H4v16h5m5-12 5 4-5 4m-6-4h11"/></>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,focus:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,download:<><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/></>,
  arrow:<><path d="m9 5 7 7-7 7"/></>, check:<path d="m5 12 4 4L19 6"/>, camera:<><rect x="3" y="6" width="18" height="14" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="3"/></>,
  shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/></>, play:<path d="m8 4 12 8-12 8z"/>,
  chair:<><path d="M6 3v12h12V9M6 10h12M6 15v6m12-6v6"/></>, wheelchair:<><circle cx="11" cy="4" r="2"/><path d="M10 8v6h7l3 6M10 10h6M7 12a6 6 0 1 0 8 8"/></>, rise:<><path d="M4 14v6h8m-8-6h6v6m7-1V5m-4 4 4-4 4 4"/></>,
  sound:<><path d="m11 4-6 5H2v6h3l6 5zM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></>, clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>, spark:<><path d="m13 2-8 12h6l-1 8 9-13h-7z"/></>, stop:<rect x="5" y="5" width="14" height="14" rx="2"/>, info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={DIRECTIONAL.has(name)?'icon-dir':undefined}>{paths[name]??paths.spark}</svg>;
}
// Glyphs that must mirror under dir=rtl; symmetric and convention-fixed glyphs (check, stop, clock) never mirror.
const DIRECTIONAL=new Set(['arrow','play','logout','sound']);
