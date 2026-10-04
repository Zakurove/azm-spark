/*
 * Vendored for Azm from digital-filter 2.4.2, file iir/butterworth.js of the published npm package
 * (https://registry.npmjs.org/digital-filter/-/digital-filter-2.4.2.tgz, sha1
 * cdf14064bce93c81576c1c285e85a14580302689). Repository: https://github.com/scijs/digital-filter
 * (formerly audiojs/digital-filter). Licence: MIT, Copyright (c) Dmitry Iv; the full licence text
 * is in src/engine/signal/vendor/digital-filter/LICENSE.
 * Modified for Azm: not modified. Only this header was added; the upstream file follows verbatim.
 */
/**
 * Nth-order Butterworth filter → cascaded SOS
 * Maximally flat magnitude response
 *
 * @module  digital-filter/butterworth
 */

let {sin, floor, PI} = Math
import { polesSos } from '../core/transform.js'

/**
 * Design Nth-order Butterworth filter as cascaded second-order sections.
 *
 * @param {number} order - Filter order
 * @param {number} fc - Cutoff frequency in Hz
 * @param {number} [fs=44100] - Sample rate in Hz
 * @param {string} [type='lowpass'] - Filter type: 'lowpass', 'highpass', 'bandpass', 'bandstop'
 * @returns {Array<{b0:number,b1:number,b2:number,a1:number,a2:number}>} SOS sections
 */
export default function butterworth (order, fc, fs, type) {
	if (!type) type = 'lowpass'
	if (!fs) fs = 44100

	return polesSos(butterworthPoles(order), fc, fs, type)
}

// Butterworth prototype poles (normalized LP at 1 rad/s, unit circle)
export { butterworthPoles as poles }  // pre-2.4 subpath export kept
function butterworthPoles (N) {
	let poles = []
	for (let m = 0; m < floor(N / 2); m++) {
		let theta = PI * (2 * m + 1) / (2 * N)
		poles.push([-sin(theta), Math.cos(theta)])
	}
	if (N % 2 === 1) poles.push([-1, 0])
	return poles
}

