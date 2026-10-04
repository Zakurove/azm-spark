/**
 * Type shim for the vendored digital-filter 2.4.2 iir/butterworth.js (product v7 contract 6.2): the
 * project has no allowJs, so this types exactly what src/engine/signal/butterworth.ts imports, the
 * low pass design. Azm code, not part of the upstream package.
 */

/** One second order section in direct form II transposed, a0 = 1. */
export interface Section {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Nth order Butterworth low pass as cascaded second order sections (cutoff and rate in Hz). */
export default function butterworth(order: number, fc: number, fs: number, type: "lowpass"): Section[];
