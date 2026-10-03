/**
 * Draws Saad's sample medical report for the booth (booth v2, contract C2): public/booth/saad-report.png.
 *
 *   node scripts/booth/saad-report.mjs
 *
 * A realistic bilingual (Arabic and English) clinic report for a fictional patient at a fictional
 * clinic, clearly labelled «نموذج توضيحي» · Sample (a ribbon, a watermark and a footer line). It is
 * drawn locally in Chromium (Playwright) with the app's own Cairo font; nothing is fetched. The facts
 * match src/features/booth/story.ts (SAAD_EXTRACTION), so the live reading and the cached reading agree:
 * an incomplete spinal cord injury at T10, a full time wheelchair user, aged 22, no shoulder pain,
 * Baclofen. It never states clearance: at the booth, as at home, clearance is the person's own answer.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public", "booth", "saad-report.png");
const font = (name) => pathToFileURL(join(ROOT, "public", "fonts", name)).href;

/** One row of the report: the heading and the text in both languages. */
const ROWS = [
  {
    en: "Diagnosis",
    ar: "التشخيص",
    enText: "Incomplete spinal cord injury at T10 (AIS C), after a road traffic accident in March 2025.",
    arText: "إصابة غير كاملة في الحبل الشوكي عند الفقرة الصدرية العاشرة (T10)، تصنيف AIS C، إثر حادث مروري في مارس ٢٠٢٥.",
  },
  {
    en: "Mobility",
    ar: "الحركة",
    enText: "Full time manual wheelchair user. Independent transfers. Good sitting balance with back support.",
    arText: "يستخدم كرسيًا متحركًا يدويًا طوال الوقت. ينتقل باستقلالية، وتوازنه جالسًا جيد مع سند للظهر.",
  },
  {
    en: "Upper limbs",
    ar: "الطرفان العلويان",
    enText: "Full strength in both arms (5/5). Full shoulder range of motion. No shoulder pain.",
    arText: "قوة كاملة في الذراعين (٥/٥). مدى كامل لحركة الكتفين، ولا ألم فيهما.",
  },
  {
    en: "Medications",
    ar: "الأدوية",
    enText: "Baclofen 10 mg, three times daily.",
    arText: "باكلوفين ١٠ ملغ، ثلاث مرات يوميًا.",
  },
  {
    en: "Rehabilitation",
    ar: "التأهيل",
    enText: "Completed inpatient and outpatient rehabilitation over six months.",
    arText: "أنهى برنامج التأهيل الداخلي والخارجي على مدى ستة أشهر.",
  },
  {
    en: "Recommendation",
    ar: "التوصية",
    enText: "Encouraged to start regular adapted exercise and to explore para sport, such as wheelchair basketball.",
    arText: "يُشجَّع على ممارسة تمارين مكيّفة بانتظام، والتعرّف على الرياضات البارالمبية مثل كرة السلة على الكراسي المتحركة.",
  },
];

const META = [
  ["Patient", "المريض", "Saad M.", "سعد م."],
  ["Age", "العمر", "22", "٢٢"],
  ["Sex", "الجنس", "Male", "ذكر"],
  ["Date", "التاريخ", "14 September 2026", "١٤ سبتمبر ٢٠٢٦"],
  ["File", "رقم الملف", "S 0022", "S 0022"],
  ["Clinic", "العيادة", "Outpatient", "العيادات الخارجية"],
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Cairo; font-weight: 200 1000; src: url("${font("cairo-arabic.woff2")}") format("woff2");
  unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E; }
@font-face { font-family: Cairo; font-weight: 200 1000; src: url("${font("cairo-latin.woff2")}") format("woff2");
  unicode-range: U+0000-00FF, U+2000-206F; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1000px; height: 1414px; }
body { font-family: Cairo, sans-serif; color: #1f2a3a; background: #fdfdfb; position: relative; overflow: hidden; }
.page { position: absolute; inset: 0; padding: 56px 64px 40px; display: flex; flex-direction: column; }
.band { position: absolute; inset: 0 0 auto 0; height: 10px; background: linear-gradient(90deg, #2d6f7e, #5fa3a8); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1.5px solid #d7e3e4; }
.brand { display: flex; align-items: center; gap: 16px; }
.mark { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(140deg, #2d6f7e, #6fb0b0); display: grid; place-items: center; }
.mark svg { width: 38px; height: 38px; }
.names b { display: block; font-size: 23px; font-weight: 800; color: #24525d; line-height: 1.35; }
.names span { display: block; font-size: 15.5px; font-weight: 600; color: #4d6a70; letter-spacing: 0.01em; }
.addr { text-align: end; font-size: 13.5px; color: #5d6f74; line-height: 1.7; }
.title { margin: 28px 0 18px; display: flex; align-items: baseline; justify-content: space-between; }
.title h1 { font-size: 30px; font-weight: 800; color: #1f2a3a; }
.title h2 { font-size: 30px; font-weight: 800; color: #1f2a3a; direction: rtl; }
.meta { display: grid; grid-template-columns: 1.3fr 0.85fr 1fr; gap: 0; border: 1.5px solid #d7e3e4; border-radius: 14px; overflow: hidden; background: #fff; }
.meta div { padding: 12px 16px; border-inline-end: 1px solid #e4ecec; border-bottom: 1px solid #e4ecec; }
.meta div:nth-child(3n) { border-inline-end: 0; }
.meta div:nth-last-child(-n+3) { border-bottom: 0; }
.meta small { display: flex; justify-content: space-between; font-size: 12.5px; color: #6a7c80; font-weight: 600; }
.meta p { display: flex; justify-content: space-between; gap: 8px; font-size: 16px; font-weight: 700; margin-top: 2px; white-space: nowrap; }
.rows { margin-top: 24px; display: grid; gap: 0; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; padding: 17px 2px; border-bottom: 1px solid #e6eded; }
.row:last-child { border-bottom: 0; }
.en, .ar { font-size: 16.5px; line-height: 1.72; }
.ar { direction: rtl; text-align: right; font-size: 17.5px; line-height: 1.85; }
.row h3 { font-size: 13.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #2d6f7e; font-weight: 800; margin-bottom: 3px; }
.ar h3 { text-transform: none; letter-spacing: 0; font-size: 15px; }
.sign { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; padding-top: 24px; }
.doctor { font-size: 15px; line-height: 1.6; color: #34474c; }
.doctor b { display: block; font-size: 17px; color: #1f2a3a; }
.scrawl { font-family: "Snell Roundhand", "Segoe Script", cursive; font-size: 34px; color: #26557a; transform: rotate(-4deg); margin-bottom: 4px; }
.stamp { width: 132px; height: 132px; border-radius: 50%; border: 3px solid #4a6fa5; color: #4a6fa5; display: grid; place-items: center; text-align: center; transform: rotate(-12deg); opacity: 0.85; font-weight: 800; font-size: 13px; line-height: 1.4; }
.stamp i { display: block; font-style: normal; font-size: 18px; letter-spacing: 0.12em; }
.foot { margin-top: 18px; padding-top: 12px; border-top: 1.5px solid #d7e3e4; display: flex; justify-content: space-between; font-size: 13px; color: #6a7c80; }
.foot span:last-child { direction: rtl; }
.side { display: grid; justify-items: end; gap: 10px; }
.pill { display: inline-flex; gap: 8px; align-items: center; padding: 6px 16px; border-radius: 999px; background: #6d4fa0; color: #fff; font-weight: 800; font-size: 15px; letter-spacing: 0.02em; box-shadow: 0 6px 18px rgba(60, 40, 110, 0.22); }
.wm { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 2; }
.wm span { transform: rotate(-30deg); font-size: 96px; font-weight: 900; color: rgba(109, 79, 160, 0.075); white-space: nowrap; letter-spacing: 0.02em; }
</style></head>
<body>
<div class="band"></div>
<div class="wm"><span>نموذج توضيحي · SAMPLE</span></div>
<div class="page">
  <div class="head">
    <div class="brand">
      <div class="mark"><svg viewBox="0 0 40 40" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"><path d="M8 28c6-2 10-8 12-16 2 8 6 14 12 16"/><circle cx="20" cy="9" r="3.2" fill="#fff" stroke="none"/></svg></div>
      <div class="names">
        <b>مركز رُواء للطب الطبيعي والتأهيل</b>
        <span>Ruwaa Center for Physical Medicine and Rehabilitation</span>
      </div>
    </div>
    <div class="side">
      <span class="pill"><bdi dir="rtl">نموذج توضيحي</bdi> · SAMPLE</span>
      <div class="addr">Riyadh, Saudi Arabia<br><bdi dir="rtl">الرياض، المملكة العربية السعودية</bdi></div>
    </div>
  </div>
  <div class="title"><h1>Medical Report</h1><h2>تقرير طبي</h2></div>
  <div class="meta">
    ${META.map(([en, ar, v, va]) => `<div><small><span>${en}</span><bdi dir="rtl">${ar}</bdi></small><p><span>${v}</span><bdi dir="rtl">${va}</bdi></p></div>`).join("")}
  </div>
  <div class="rows">
    ${ROWS.map((r) => `<div class="row"><div class="en"><h3>${r.en}</h3>${r.enText}</div><div class="ar"><h3>${r.ar}</h3>${r.arText}</div></div>`).join("")}
  </div>
  <div class="sign">
    <div class="doctor">
      <div class="scrawl">Lina H.</div>
      <b>Dr. Lina H. · <bdi dir="rtl">د. لينا ح.</bdi></b>
      Consultant, Physical Medicine and Rehabilitation<br><bdi dir="rtl">استشارية الطب الطبيعي والتأهيل</bdi>
    </div>
    <div class="stamp"><div><i>SAMPLE</i>RUWAA<br>نموذج</div></div>
  </div>
  <div class="foot">
    <span>Fictional patient and clinic, made for the Azm booth.</span>
    <span>مريض ومركز من نسج الخيال، أُعدّا لجناح عزم.</span>
  </div>
</div>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1414 }, deviceScaleFactor: 1.2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: "png" });
  console.log(`Saad's sample report written to ${OUT}`);
} finally {
  await browser.close();
}
