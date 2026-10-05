/**
 * The performance budgets the overlay marks and the smoke page records (product v7 contract section
 * 9, mid range phones). The frame rate floors are read where the app reads them (the focus camera's
 * probe floors: C-10 for range, the gait data's processed frame rates for the walk); the rest are the
 * section 9 table's engineering budgets, not clinical numbers.
 */
import { capture } from "../../movements/gait/gait-v7.json";
import { PROBE_FLOOR_FPS } from "../focus/camera";

export const BUDGETS = {
  /** Full sustains this for range (C-10); under it the check measures with Lite. */
  romFps: PROBE_FLOOR_FPS.rom,
  /** Full sustains this for the walk (gait data processedFps.full). */
  gaitFps: PROBE_FLOOR_FPS.gait,
  /** 20 to 24 fps gives timing only (gait data processedFps.timingOnly). */
  gaitTimingOnlyFps: capture.common.processedFps.timingOnly,
  /** RomRunner.feed with QualityMonitor and compensations, p95 per frame. */
  romFeedMsP95: 2,
  /** GaitRecorder.push and LiveStepCounter.feed, p95 per frame. */
  gaitPushMsP95: 1,
  /** analyseGaitView for a 30 s view, p95, after capture only. */
  analyseMsP95: 200,
  /** Main thread long tasks during capture: none over this besides the model call. */
  longTaskMs: 50,
  /** Overlay drawing, p95. */
  overlayMsP95: 4,
} as const;

/**
 * Budgets of the User Timing measures a stream may add (performance.measure with these names): the
 * overlay marks a p95 over its budget, and the smoke page writes the first two itself.
 */
export const MEASURE_BUDGETS: Readonly<Record<string, number>> = {
  "azm:rom_feed": BUDGETS.romFeedMsP95,
  "azm:gait_push": BUDGETS.gaitPushMsP95,
  "azm:gait_analyse": BUDGETS.analyseMsP95,
  "azm:overlay_draw": BUDGETS.overlayMsP95,
};

/** Heap growth over a 15 minute check (section 9 memory budget), MB. */
export const HEAP_GROWTH_MB = 50;
