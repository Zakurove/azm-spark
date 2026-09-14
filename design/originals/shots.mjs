import { chromium } from "@playwright/test";

const OUT = process.env.SHOT_DIR ?? "/private/tmp/claude-501/-Users-nasser-Desktop-Sports-Disability-Project/a47841ed-5208-4211-835e-0f05f2f39850/scratchpad";
const BASE = "http://localhost:5205";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERROR:", m.text()); });

// 1) Home — Arabic (default)
await page.goto(`${BASE}/?lang=ar`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/a5-home-ar.png` });
console.log("shot home-ar");

// 2) Home — English
await page.goto(`${BASE}/?lang=en`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/a5-home-en.png` });
console.log("shot home-en");

// 3) Full demo session — Arabic, wheelchair, shoulder press, fast calibration
await page.goto(`${BASE}/?lang=ar&demo=1&profile=wheelchair&ex=seated_shoulder_press&autostart=1&fast=1`);
await page.waitForSelector(".banner", { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/a5-framing-ar.png` });
console.log("shot framing");

await page.waitForSelector(".banner.cal", { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/a5-calibrating-ar.png` });
console.log("shot calibrating");

await page.waitForSelector(".rep-card", { timeout: 40000 });
console.log("training started");
// wait for a rep to land and ideally a cue toast
await page.waitForFunction(() => {
  const el = document.querySelector(".rep-num");
  return el && el.textContent && el.textContent.trim() !== "0" && el.textContent.trim() !== "٠";
}, { timeout: 40000 });
// catch a real coaching cue (trunk lean starts at rep 4 in the demo trace)
try {
  await page.waitForSelector(".cue-toast.warn", { timeout: 45000 });
  await page.waitForTimeout(250);
} catch { console.log("no warn cue appeared"); }
await page.screenshot({ path: `${OUT}/a5-training-ar.png` });
console.log("shot training");

// 4) run to set completion → RPE modal
await page.waitForSelector(".rpe-grid", { timeout: 90000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/a5-rpe-ar.png` });
console.log("shot rpe");
await page.click(".rpe-grid .rpe-btn:nth-child(6)"); // RPE 5
await page.click(".modal-actions .cta");
await page.waitForSelector(".sum-grid", { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/a5-summary-ar.png` });
console.log("shot summary");

// 5) English training shot (sit-to-stand, post-stroke)
await page.goto(`${BASE}/?lang=en&demo=1&profile=hemiparesis_right&ex=sit_to_stand&autostart=1&fast=1`);
await page.waitForSelector(".rep-card", { timeout: 40000 });
await page.waitForFunction(() => {
  const el = document.querySelector(".rep-num");
  return el && el.textContent && el.textContent.trim() !== "0";
}, { timeout: 60000 });
await page.screenshot({ path: `${OUT}/a5-training-en.png` });
console.log("shot training-en");

await browser.close();
console.log("ALL SHOTS DONE");
