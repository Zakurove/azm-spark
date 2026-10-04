/**
 * The performance overlay (product v7 contract section 9, stream G, step G1): on a VITE_E2E=1 build,
 * /?perf=1 shows the section 9 measures over whatever page the URL opens (the focus check, a coached
 * session, the smoke page), for the runs on the reference phones:
 *
 *   the pose rate (frames the model processed per second), the model's time per frame, the display's
 *   frame time, long tasks, the JS heap and any User Timing measure named azm:* a stream adds.
 *
 * A value outside its budget is marked (budgets.ts). The numbers come from perfProbe.ts: the model's
 * detectForVideo is timed by wrapping it, so no stream's file carries a hook (A6a-5).
 * window.__azmPerf.snapshot() gives the same numbers to a script (G3). src/app/App.tsx mounts this
 * over every page in a VITE_E2E=1 build only, so a default build has no chunk for it. It measures in
 * the browser only: a server render is empty.
 */
import { useEffect, useState } from "react";
import { BUDGETS, HEAP_GROWTH_MB, MEASURE_BUDGETS } from "./budgets";
import { PerfMeter, type PerfSnapshot, type Spread } from "./perf";
import { attachMeter } from "./perfProbe";
import "./smoke.css";

type Lang = "ar" | "en";

const LABELS = {
  ar: {
    title: "الأداء",
    pose: "تتبع الجسم",
    model: "زمن النموذج",
    frame: "زمن الإطار",
    long: "مهام طويلة",
    heap: "الذاكرة",
    none: "لا إطارات من النموذج بعد",
    max: "الأطول",
  },
  en: {
    title: "Performance",
    pose: "Pose",
    model: "Model",
    frame: "Frame",
    long: "Long tasks",
    heap: "Heap",
    none: "no model frames yet",
    max: "max",
  },
} as const;

const one = (v: number | null) => (v === null ? "0" : (Math.round(v * 10) / 10).toFixed(1));
const spreadText = (s: Spread) => `p50 ${one(s.p50)} · p95 ${one(s.p95)} ms`;

function Row({ label, value, over }: { label: string; value: string; over?: boolean }) {
  return (
    <div className="perf-row" data-over={over ? "true" : undefined}>
      <dt>{label}</dt>
      <dd dir="ltr">{value}</dd>
    </div>
  );
}

/** The panel for one snapshot. */
export function PerfPanel({ snapshot: s, lang }: { snapshot: PerfSnapshot; lang: Lang }) {
  const t = LABELS[lang];
  const longOver = s.longTasks.maxMs !== null && s.longTasks.maxMs > BUDGETS.longTaskMs;
  return (
    <aside className="perf-overlay" aria-label={t.title} dir={lang === "ar" ? "rtl" : "ltr"}>
      <h2>{t.title}</h2>
      <dl>
        {s.poseFps === null ? (
          <Row label={t.pose} value={t.none} />
        ) : (
          <Row label={t.pose} value={`${one(s.poseFps)} fps`} over={s.poseFps < BUDGETS.romFps} />
        )}
        {s.modelMs.n > 0 && <Row label={t.model} value={spreadText(s.modelMs)} />}
        <Row label={t.frame} value={spreadText(s.frameMs)} />
        <Row
          label={t.long}
          value={s.longTasks.count ? `${s.longTasks.count} · ${t.max} ${one(s.longTasks.maxMs)} ms` : "0"}
          over={longOver}
        />
        {s.heapMB !== null && (
          <Row
            label={t.heap}
            value={`${one(s.heapMB)} MB${s.heapGrowthMB ? ` (+${one(s.heapGrowthMB)})` : ""}`}
            over={(s.heapGrowthMB ?? 0) > HEAP_GROWTH_MB}
          />
        )}
        {Object.entries(s.measures).map(([name, m]) => (
          <Row
            key={name}
            label={name}
            value={spreadText(m)}
            over={MEASURE_BUDGETS[name] !== undefined && (m.p95 ?? 0) > MEASURE_BUDGETS[name]}
          />
        ))}
      </dl>
    </aside>
  );
}

const pageLang = (): Lang =>
  document.documentElement.lang === "en" || new URLSearchParams(location.search).get("lang") === "en"
    ? "en"
    : "ar";

export default function PerfOverlay() {
  const [view, setView] = useState<{ snapshot: PerfSnapshot; lang: Lang } | null>(null);
  useEffect(() => {
    const meter = new PerfMeter(240);
    const release = attachMeter(meter);
    const w = window as Window & { __azmPerf?: { snapshot(): PerfSnapshot; reset(): void } };
    const api = { snapshot: () => meter.snapshot(), reset: () => meter.reset() };
    w.__azmPerf = api;
    const update = () => setView({ snapshot: meter.snapshot(), lang: pageLang() });
    update();
    const id = setInterval(update, 500);
    return () => {
      clearInterval(id);
      release();
      if (w.__azmPerf === api) delete w.__azmPerf;
    };
  }, []);
  return view ? <PerfPanel snapshot={view.snapshot} lang={view.lang} /> : null;
}
