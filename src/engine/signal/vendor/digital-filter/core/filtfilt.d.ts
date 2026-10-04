/**
 * Type shim for the vendored digital-filter 2.4.2 core/filtfilt.js (product v7 contract 6.2): the
 * project has no allowJs, so this types exactly what src/engine/signal/butterworth.ts imports. Azm
 * code, not part of the upstream package.
 */
import type { Section } from "../iir/butterworth";

/**
 * Zero phase forward and backward filtering with odd reflection padding and steady state initial
 * conditions. Filters `data` in place and returns it; `padlen` overrides the default pad length.
 */
export default function filtfilt(data: Float64Array, params: { coefs: Section[]; padlen?: number }): Float64Array;
