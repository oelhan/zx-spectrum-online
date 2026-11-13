/* app.js
 *
 * Browser front end for zxem.wasm: drives the 50Hz frame loop, draws the
 * framebuffer to a canvas and feeds keyboard state into the emulator.
 */
'use strict';

const FRAME_MS = 20;    // Spectrum runs at 50 frames a second
const MAX_CATCHUP = 4;  // frames to run at once after a stall (e.g. hidden tab)

// ZX_KEY_* values from src/zxem/zxio.h
const ZX = {
	SHIFT: 1, Z: 2, X: 3, C: 4, V: 5,
	A: 6, S: 7, D: 8, F: 9, G: 10,
	Q: 11, W: 12, E: 13, R: 14, T: 15,
	N1: 16, N2: 17, N3: 18, N4: 19, N5: 20,
	N0: 21, N9: 22, N8: 23, N7: 24, N6: 25,
	P: 26, O: 27, I: 28, U: 29, Y: 30,
	ENTER: 31, L: 32, K: 33, J: 34, H: 35,
	SPACE: 36, SYM: 37, M: 38, N: 39, B: 40,
};

// KeyboardEvent.code -> list of Spectrum keys held while it is down
const KEYMAP = {
	ShiftLeft: [ZX.SHIFT], ShiftRight: [ZX.SHIFT],
	ControlLeft: [ZX.SYM], ControlRight: [ZX.SYM], AltLeft: [ZX.SYM], AltRight: [ZX.SYM],
	Enter: [ZX.ENTER], Space: [ZX.SPACE],
	Backspace: [ZX.SHIFT, ZX.N0],
	ArrowLeft: [ZX.SHIFT, ZX.N5], ArrowDown: [ZX.SHIFT, ZX.N6],
	ArrowUp: [ZX.SHIFT, ZX.N7], ArrowRight: [ZX.SHIFT, ZX.N8],
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEYMAP['Key' + c] = [ZX[c]];
for (const d of '0123456789') KEYMAP['Digit' + d] = [ZX['N' + d]];

// Kempston joystick bits, used for the arrow keys when selected
const JOY = {
	ArrowRight: 0x01, ArrowLeft: 0x02, ArrowDown: 0x04, ArrowUp: 0x08, Tab: 0x10,
};

const canvas = document.getElementById('screen');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');

function fitCanvas(w, h) {
	// Largest whole-number scale that fits, so pixels stay square and crisp
	const scale = Math.max(1, Math.floor(Math.min(
		(window.innerWidth - 32) / w, (window.innerHeight - 120) / h)));
	canvas.style.width = (w * scale) + 'px';
	canvas.style.height = (h * scale) + 'px';
}

createZXEM().then((zx) => {
	if (!zx._zx_init()) {
		statusEl.textContent = 'Failed to start the emulator';
		return;
	}

	const w = zx._zx_fb_width();
	const h = zx._zx_fb_height();
	canvas.width = w;
	canvas.height = h;
	fitCanvas(w, h);
	window.addEventListener('resize', () => fitCanvas(w, h));

	const image = ctx.createImageData(w, h);
	const fbPtr = zx._zx_framebuffer();

	// Count how many Spectrum keys each held PC key holds down, so combos like
	// Backspace (CAPS+0) and a real Shift can overlap without releasing early
	const held = new Map();
	const pressed = new Set();
	const arrowsEl = document.getElementById('arrows');
	let joy = 0;

	function joyBit(code) {
		return arrowsEl.value === 'kempston' ? JOY[code] : undefined;
	}
	function setJoy(bit, down) {
		joy = down ? joy | bit : joy & ~bit;
		zx._zx_joy(joy);
	}

	function setKeys(keys, down) {
		for (const k of keys) {
			const n = (held.get(k) || 0) + (down ? 1 : -1);
			held.set(k, Math.max(0, n));
			zx._zx_key(k, n > 0 ? 1 : 0);
		}
	}

	window.addEventListener('keydown', (e) => {
		if (e.target === arrowsEl) return;
		const bit = joyBit(e.code);
		const keys = KEYMAP[e.code];
		if (!bit && !keys) return;
		e.preventDefault();
		if (pressed.has(e.code)) return; // auto-repeat
		pressed.add(e.code);
		if (bit) setJoy(bit, true);
		else setKeys(keys, true);
	});
	window.addEventListener('keyup', (e) => {
		if (!pressed.delete(e.code)) return;
		e.preventDefault();
		const bit = joyBit(e.code);
		if (bit) setJoy(bit, false);
		else setKeys(KEYMAP[e.code], false);
	});
	function releaseAll() {
		for (const code of pressed) {
			if (KEYMAP[code]) setKeys(KEYMAP[code], false);
		}
		pressed.clear();
		joy = 0;
		zx._zx_joy(0);
	}
	// Release everything if focus leaves the page mid-press
	window.addEventListener('blur', releaseAll);
	arrowsEl.addEventListener('change', () => {
		releaseAll();
		arrowsEl.blur();
	});

	document.getElementById('reset').addEventListener('click', (e) => {
		zx._zx_reset();
		e.target.blur();
	});

	let last = performance.now();
	let acc = 0;
	function tick(now) {
		acc += now - last;
		last = now;
		let frames = Math.floor(acc / FRAME_MS);
		acc -= frames * FRAME_MS;
		if (frames > MAX_CATCHUP) frames = MAX_CATCHUP;
		if (frames > 0) {
			for (let i = 0; i < frames; i++) zx._zx_run_frame();
			image.data.set(zx.HEAPU8.subarray(fbPtr, fbPtr + w * h * 4));
			ctx.putImageData(image, 0, 0);
		}
		requestAnimationFrame(tick);
	}
	statusEl.textContent = 'Ready. Type on your keyboard.';
	requestAnimationFrame(tick);
});
