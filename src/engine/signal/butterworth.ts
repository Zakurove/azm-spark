/**
 * Butterworth low pass design and zero phase filtering (product v7 contract 2.12 and 6.1), a thin
 * wrapper over the vendored digital-filter 2.4.2 files (MIT, Copyright (c) Dmitry Iv; see
 * src/engine/signal/vendor/digital-filter/LICENSE). Pure, no DOM.
 *
 * Behaviour follows SciPy, checked against tests/golden/butter_filtfilt.json (scripts/golden/make_golden.py):
 *   - lowpassSos(order, cutoffHz, fs) is the same filter as scipy.signal.butter(order, cutoffHz,
 *     fs=fs, output="sos"). `order` is the design order, as SciPy's N: filtfilt runs it twice, so
 *     the gait rule "4th order zero lag, 5 Hz (2nd order filtfilt)" is lowpassSos(2, 5, fs). Rows
 *     are SciPy's layout [b0, b1, b2, a0 = 1, a1, a2]. The cascade equals SciPy's; the split into
 *     sections can differ for more than one section (digital-filter gives each section unit gain at
 *     0 Hz and puts the least damped pole pair first; SciPy puts the gain in the first section and
 *     that pair last).
 *   - filtfilt(xs, sos) is scipy.signal.sosfiltfilt(sos, xs) with its defaults: odd reflection
 *     padding of filtfiltPadlen(sos) samples on each end and steady state initial conditions on
 *     both passes. Like SciPy it refuses a signal no longer than the pad.
 */
import butterworth, { type Section } from "./vendor/digital-filter/iir/butterworth.js";
import vendoredFiltfilt from "./vendor/digital-filter/core/filtfilt.js";

/** Second order sections of a Butterworth low pass, rows [b0, b1, b2, 1, a1, a2] (SciPy layout). */
export function lowpassSos(order: number, cutoffHz: number, fs: number): number[][] {
  if (!Number.isInteger(order) || order < 1)
    throw new RangeError(`lowpassSos: order ${order} is not a whole number of 1 or more`);
  if (!(fs > 0) || !Number.isFinite(fs))
    throw new RangeError(`lowpassSos: sampling rate ${fs} is not above 0`);
  if (!(cutoffHz > 0 && cutoffHz < fs / 2))
    throw new RangeError(`lowpassSos: cutoff ${cutoffHz} Hz is not between 0 and half the sampling rate`);
  return butterworth(order, cutoffHz, fs, "lowpass").map((s) => [s.b0, s.b1, s.b2, 1, s.a1, s.a2]);
}

function sections(sos: readonly (readonly number[])[]): Section[] {
  if (!sos.length) throw new RangeError("filtfilt: no sections");
  return sos.map((row, i) => {
    if (row.length !== 6 || !row.every(Number.isFinite))
      throw new RangeError(`filtfilt: section ${i} is not six finite numbers`);
    if (row[3] !== 1) throw new RangeError(`filtfilt: section ${i} has a0 ${row[3]}, not 1`);
    return { b0: row[0], b1: row[1], b2: row[2], a1: row[4], a2: row[5] };
  });
}

/**
 * The pad length of filtfilt on each end, as scipy.signal.sosfiltfilt: 3 * (2 * sections + 1),
 * less 3 for each first order section that SciPy pads to second order (b2 = 0 and a2 = 0).
 */
export function filtfiltPadlen(sos: readonly (readonly number[])[]): number {
  const b2Zero = sos.filter((r) => r[2] === 0).length;
  const a2Zero = sos.filter((r) => r[5] === 0).length;
  return 3 * (2 * sos.length + 1 - Math.min(b2Zero, a2Zero));
}

/** Zero phase low pass filtering, SciPy sosfiltfilt behaviour. Returns a new array; the input is left alone. */
export function filtfilt(xs: Float64Array | number[], sos: number[][]): Float64Array {
  const coefs = sections(sos);
  const padlen = filtfiltPadlen(sos);
  if (xs.length <= padlen)
    throw new RangeError(`filtfilt: ${xs.length} samples, SciPy needs more than the pad of ${padlen}`);
  return vendoredFiltfilt(Float64Array.from(xs), { coefs, padlen });
}
