import { Lang, fmtNum } from './i18n';
import { camCopy } from './camera-copy';
import { Position } from './product';

function PlacementArt({ lang, position }: { lang: Lang; position: Position }) {
 const seated = position !== 'rise';
 return <svg viewBox="0 0 360 210" role="img" aria-label={lang === 'ar' ? 'رسم يوضح وضع الجوال على طاولة والتمرين على بعد مترين' : 'Phone on a table, training two meters away'}>
  <defs>
   <linearGradient id="cone" x1="0" x2="1"><stop offset="0" stopColor="#f8cb44" stopOpacity=".38"/><stop offset="1" stopColor="#f8cb44" stopOpacity="0"/></linearGradient>
  </defs>
  <line x1="8" y1="176" x2="352" y2="176" stroke="#e4ddc9" strokeWidth="2" strokeLinecap="round"/>
  <path d="M84 78 L262 26 L262 176 L84 104 Z" fill="url(#cone)"/>
  <rect x="22" y="112" width="92" height="9" rx="4" fill="#d9cfb4"/>
  <line x1="34" y1="121" x2="34" y2="176" stroke="#d9cfb4" strokeWidth="6" strokeLinecap="round"/>
  <line x1="102" y1="121" x2="102" y2="176" stroke="#d9cfb4" strokeWidth="6" strokeLinecap="round"/>
  <path d="M66 112 L74 96" stroke="#9d9380" strokeWidth="4" strokeLinecap="round"/>
  <rect x="58" y="62" width="28" height="50" rx="6" fill="#1c2029"/>
  <rect x="61" y="67" width="22" height="38" rx="3" fill="#f6edd2"/>
  <circle cx="72" cy="70" r="1.8" fill="#f8cb44"/>
  {seated ? <>
   <rect x="258" y="126" width="54" height="8" rx="3" fill="#b9ae96"/>
   <rect x="306" y="80" width="7" height="54" rx="3" fill="#b9ae96"/>
   <line x1="264" y1="134" x2="264" y2="176" stroke="#b9ae96" strokeWidth="5" strokeLinecap="round"/>
   <line x1="306" y1="134" x2="306" y2="176" stroke="#b9ae96" strokeWidth="5" strokeLinecap="round"/>
   {position === 'wheelchair' && <circle cx="292" cy="152" r="24" fill="none" stroke="#8a8272" strokeWidth="5"/>}
   <g stroke="#7a62a8" strokeWidth="9" strokeLinecap="round" fill="none">
    <path d="M288 84 L290 124"/>
    <path d="M290 124 L262 128 L260 170"/>
    <path d="M286 94 L266 76 L262 50"/>
    <path d="M288 94 L306 72 L304 48"/>
   </g>
   <circle cx="287" cy="68" r="12" fill="#7a62a8"/>
  </> : <>
   <rect x="292" y="130" width="46" height="7" rx="3" fill="#b9ae96"/>
   <line x1="298" y1="137" x2="298" y2="176" stroke="#b9ae96" strokeWidth="5" strokeLinecap="round"/>
   <line x1="332" y1="137" x2="332" y2="176" stroke="#b9ae96" strokeWidth="5" strokeLinecap="round"/>
   <g stroke="#7a62a8" strokeWidth="9" strokeLinecap="round" fill="none">
    <path d="M262 58 L262 116"/>
    <path d="M262 116 L254 174"/>
    <path d="M262 116 L272 174"/>
    <path d="M262 70 L246 102"/>
    <path d="M262 70 L278 102"/>
   </g>
   <circle cx="262" cy="40" r="12" fill="#7a62a8"/>
  </>}
  <g stroke="#1c2029" strokeWidth="1.6" strokeLinecap="round">
   <line x1="98" y1="196" x2="246" y2="196"/>
   <path d="M104 191 L98 196 L104 201 M240 191 L246 196 L240 201" fill="none"/>
  </g>
  <rect x="148" y="185" width="48" height="22" rx="11" fill="#fff" stroke="#e4ddc9"/>
  <text x="172" y="200" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1c2029" fontFamily="Cairo, sans-serif">{lang === 'ar' ? `${fmtNum(2, lang)} م` : '2 m'}</text>
 </svg>;
}

export default function PlacementGuide({ lang, position, compact }: { lang: Lang; position: Position; compact?: boolean }) {
 const k = camCopy(lang);
 const tips = k.tips.map((tip, i) => (i === 1 && position === 'rise' ? { ...tip, body: k.tipRise } : tip));
 return <div className={`place ${compact ? 'compact' : ''}`}>
  <div className="place-art"><PlacementArt lang={lang} position={position}/></div>
  <ol className="place-tips">
   {tips.map((tip, i) => <li key={tip.title}><b>{fmtNum(i + 1, lang)}</b><div><strong>{tip.title}</strong><span>{tip.body}</span></div></li>)}
  </ol>
 </div>;
}
