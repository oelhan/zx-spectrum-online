// AY sound test for the web build: small programs set up the AY through
// ports 0xFFFD/0xBFFD, and the samples are checked for pitch, level,
// noise and envelope. Also checks register read-back and that save states
// keep the AY.
//
//   node tests/web/ay.cjs
'use strict';

const path = require('path');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

const RATE = 48000;
const AY_CLOCK = 1773400;
const le16 = (n) => [n & 0xFF, n >> 8];

// 48K snapshot running at 0x8000:
//   DI : LD BC,0xFFFD
//   for each register: LD A,reg : OUT (C),A : LD B,0xBF : LD A,value : OUT (C),A : LD B,0xFF
//   LD A,readReg : OUT (C),A : IN A,(C) : LD (0x4000),A    (read back into screen memory)
//   JR $
function sna(writes, readReg = 0) {
	const code = [0xF3, 0x01, 0xFD, 0xFF];
	for (const [reg, value] of writes) {
		code.push(0x3E, reg, 0xED, 0x79, 0x06, 0xBF, 0x3E, value, 0xED, 0x79, 0x06, 0xFF);
	}
	code.push(0x3E, readReg, 0xED, 0x79, 0xED, 0x78, 0x32, 0x00, 0x40, 0x18, 0xFE);
	const ram = new Uint8Array(49152);
	ram.fill(0x38, 0x1800, 0x1B00);             // black ink on white paper
	ram.set(code, 0x4000);
	const sp = 0xFF00;
	ram.set(le16(0x8000), sp - 0x4000);
	const h = new Uint8Array(27);
	h[0] = 0x3F;
	h.set(le16(0x5C3A), 15);
	h.set(le16(sp), 23);
	h[25] = 1;
	h[26] = 7;
	return Uint8Array.from([...h, ...ram]);
}

// Tone A only, full volume
const toneA = (period) => [[0, period & 0xFF], [1, period >> 8], [7, 0x3E], [8, 15]];

// Frequency from the first to the last rising zero crossing
function pitch(s) {
	let first = -1, last = -1, n = 0;
	for (let i = 1; i < s.length; i++) {
		if (s[i - 1] < 0 && s[i] >= 0) {
			if (first < 0) first = i;
			last = i;
			n++;
		}
	}
	return n > 1 ? (n - 1) * RATE / (last - first) : 0;
}
const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (s) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);

let failures = 0;
const check = (name, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
	if (!ok) failures++;
};

createZXEM().then((zx) => {
	zx._zx_init();
	zx._zx_audio_init(RATE);
	const take = () => {
		const n = zx._zx_audio_take();
		return new Float32Array(zx.HEAPU8.buffer, zx._zx_audio_buffer(), n).slice();
	};
	// Run frames taking the samples after each one, like the page does
	const record = (n) => {
		const parts = [];
		for (let i = 0; i < n; i++) {
			zx._zx_run_frame();
			parts.push(...take());
		}
		return Float32Array.from(parts);
	};
	const copyIn = (bytes) => {
		const ptr = zx._malloc(bytes.length);
		zx.HEAPU8.set(bytes, ptr);
		return ptr;
	};
	// Load a program, let it run and the DC blocker settle, then record 1s
	const run = (writes, readReg) => {
		const bytes = sna(writes, readReg);
		const ptr = copyIn(bytes);
		zx.ccall('zx_load', 'number', ['number', 'number', 'string'], [ptr, bytes.length, 'sna']);
		zx._free(ptr);
		record(25);
		return record(50);
	};

	let s = run(toneA(100));
	let expected = AY_CLOCK / (16 * 100);
	check('tone A has the right pitch', Math.abs(pitch(s) - expected) <= 2,
		`${pitch(s).toFixed(1)} Hz, expected ${expected.toFixed(1)}`);
	const loud = peak(s);
	check('full volume tone is loud enough', loud > 0.1 && loud < 1, `peak ${loud.toFixed(3)}`);

	s = run([[2, 50], [3, 0], [7, 0x3D], [9, 15]]);
	expected = AY_CLOCK / (16 * 50);
	check('tone B works on its own', Math.abs(pitch(s) - expected) <= 3,
		`${pitch(s).toFixed(1)} Hz, expected ${expected.toFixed(1)}`);

	s = run([...toneA(100).slice(0, 3), [8, 8]]);
	const ratio = peak(s) / loud;
	check('volume 8 is much quieter than 15 (AY levels are logarithmic)',
		ratio > 0.1 && ratio < 0.25, `ratio ${ratio.toFixed(3)}, table says 0.169`);

	s = run([[6, 1], [7, 0x37], [8, 15]]);
	check('noise makes sound with no steady pitch', rms(s) > 0.05, `rms ${rms(s).toFixed(3)}`);

	// Envelope shape 14 (/\/\) on channel A with tone and noise off: the
	// output follows the envelope, a triangle of two 16 step ramps
	s = run([[11, 10], [12, 0], [7, 0x3F], [8, 0x10], [13, 14]]);
	expected = AY_CLOCK / (256 * 10 * 2);
	check('envelope triangle has the right pitch', Math.abs(pitch(s) - expected) <= 2,
		`${pitch(s).toFixed(1)} Hz, expected ${expected.toFixed(1)}`);

	// Envelope shape 0 (\___): one ramp down, then silence
	s = run([[11, 10], [12, 0], [7, 0x3F], [8, 0x10], [13, 0]]);
	check('one-shot envelope ends in silence', peak(s.subarray(RATE / 2)) < 0.01,
		`peak ${peak(s.subarray(RATE / 2)).toFixed(4)}`);

	// Register read-back: the program reads register 1 into 0x4000, which
	// shows as pixels. Only 4 bits of register 1 exist: 0xAB reads as 0x0B.
	run([[1, 0xAB]], 1);
	const w = zx._zx_fb_width(), h = zx._zx_fb_height();
	const border = (h - 192) / 2;
	const fb = zx.HEAPU8.slice(zx._zx_framebuffer(), zx._zx_framebuffer() + w * h * 4);
	let byte = 0;
	for (let x = 0; x < 8; x++) byte = (byte << 1) | (fb[(border * w + border + x) * 4] === 0 ? 1 : 0);
	check('register reads back through 0xFFFD with unused bits cleared', byte === 0x0B,
		`read 0x${byte.toString(16)}`);

	// Save state keeps the AY: save while a tone plays, reset, restore
	run(toneA(100));
	const n = zx._zx_save_state();
	const state = zx.HEAPU8.slice(zx._zx_state_buffer(), zx._zx_state_buffer() + n);
	zx._zx_reset();
	record(50);
	check('reset silences the AY', peak(record(25)) < 0.01);
	const ptr = copyIn(state);
	zx._zx_restore_state(ptr, state.length);
	zx._free(ptr);
	record(25);
	s = record(50);
	check('restored save state plays the same tone', Math.abs(pitch(s) - AY_CLOCK / 1600) <= 2,
		`${pitch(s).toFixed(1)} Hz`);

	zx._zx_audio_init(0);
	process.exit(failures ? 1 : 0);
});
