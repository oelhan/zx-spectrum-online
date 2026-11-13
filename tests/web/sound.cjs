// Sound test for the web build: runs a snapshot that toggles the speaker at
// a known rate and checks the samples have the right count and pitch, then
// checks the ROM's BEEP plays middle C.
//
//   node tests/web/sound.cjs
'use strict';

const path = require('path');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

const RATE = 48000;
const CPU_HZ = 69888 * 50;

const le16 = (n) => [n & 0xFF, n >> 8];

// Square wave at 0x8000, interrupts off so nothing else takes time:
//   DI : LD A,0x10
//   loop: OUT (254),A : LD B,100 : d: DJNZ d : XOR 0x10 : JR loop
// Half a period is 11 + 7 + 13*99 + 8 + 7 + 12 = 1332 T-states.
const HALF_PERIOD = 1332;
function sna() {
	const ram = new Uint8Array(49152);
	ram.set([0xF3, 0x3E, 0x10,
		0xD3, 0xFE, 0x06, 100, 0x10, 0xFE, 0xEE, 0x10, 0x18, 0xF6], 0x4000);
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

// ZX_KEY_* values from src/zxem/zxio.h
const K = { SHIFT: 1, SYM: 37, Z: 2, N: 39, N0: 21, N1: 16, ENTER: 31 };

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

let failures = 0;
const check = (name, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
	if (!ok) failures++;
};

createZXEM().then((zx) => {
	zx._zx_init();
	const frames = (n) => { for (let i = 0; i < n; i++) zx._zx_run_frame(); };
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

	frames(10);
	check('no samples while sound is off', take().length === 0);

	zx._zx_audio_init(RATE);
	frames(150);
	take();
	let s = record(50);
	const peak = s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
	check('one second of frames gives one second of samples', Math.abs(s.length - RATE) <= 1,
		`${s.length} samples`);
	check('idle ROM is silent', peak < 0.01, `peak ${peak.toFixed(4)}`);

	const bytes = sna();
	const ptr = zx._malloc(bytes.length);
	zx.HEAPU8.set(bytes, ptr);
	zx.ccall('zx_load', 'number', ['number', 'number', 'string'], [ptr, bytes.length, 'sna']);
	zx._free(ptr);
	frames(10);
	take();
	s = record(50);

	let rising = 0;
	for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) rising++;
	const expected = CPU_HZ / (2 * HALF_PERIOD);
	check('square wave has the right pitch', Math.abs(rising - expected) <= 2,
		`${rising} Hz, expected ${expected.toFixed(1)}`);
	const high = s.reduce((m, v) => Math.max(m, v), 0);
	check('square wave is loud enough', high > 0.15 && high < 1, `peak ${high.toFixed(3)}`);

	// BEEP 1,0 is middle C, timed by the ROM in T-states
	zx._zx_reset();
	frames(150);
	const press = (keys) => {
		keys.forEach((k) => zx._zx_key(k, 1));
		frames(5);
		keys.forEach((k) => zx._zx_key(k, 0));
		frames(5);
	};
	press([K.SHIFT, K.SYM]);   // extended mode
	press([K.SYM, K.Z]);       // BEEP
	press([K.N1]);
	press([K.SYM, K.N]);       // ,
	press([K.N0]);
	take();
	zx._zx_key(K.ENTER, 1);
	s = record(40);
	zx._zx_key(K.ENTER, 0);
	const hz = pitch(s.subarray(RATE / 10));
	check('BEEP 1,0 plays middle C', Math.abs(hz - 261.63) < 261.63 * 0.01, `${hz.toFixed(1)} Hz`);
	frames(50);

	// Nobody taking samples (e.g. during a tape autoload) must not overrun
	frames(100);
	const n = zx._zx_audio_take();
	check('unread samples are capped', n > 0 && n <= 16384, `${n} samples`);

	zx._zx_audio_init(0);
	frames(10);
	check('sound can be turned off again', zx._zx_audio_take() === 0);

	process.exit(failures ? 1 : 0);
});
