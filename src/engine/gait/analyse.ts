/**
 * The gait analysis (product v7 contract 2.8, stream C, step C1): preprocessing (resample 30 Hz,
 * visibility, Hampel 7/2, gaps up to 0.12 s, Butterworth 5 Hz zero lag, swaps, facing, turns),
 * events (Zeni side; ankle fallback; Stenum front), the event order check, cycles, metrics, scaling
 * and quality. Pure; never during capture.
 *
 * Placeholder of step A5 (contract 1.3), replaced by C1: every function throws; nothing in stream A
 * calls them.
 */
import type {
  GaitAnalysis,
  GaitSetup,
  GaitViewInput,
  GaitViewResult,
  StaticStanceInput,
  StaticStanceResult,
} from "./types";

function notBuilt(): never {
  throw new Error("The gait analysis is not built yet (stream C)");
}

export function analyseGaitView(_input: GaitViewInput): GaitViewResult {
  return notBuilt();
}

export function analyseStaticStance(_input: StaticStanceInput): StaticStanceResult {
  return notBuilt();
}

/** Also picks the one replay cycle and nulls the per view replays. */
export function combineViews(
  _views: readonly GaitViewResult[],
  _stance: readonly StaticStanceResult[],
  _setup: GaitSetup,
): GaitAnalysis {
  return notBuilt();
}
