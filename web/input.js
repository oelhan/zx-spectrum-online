/* input.js
 *
 * Everything that presses Spectrum keys or moves a joystick: the PC
 * keyboard, gamepads, the touch d-pad and fire button, and the on-screen
 * Spectrum keyboard.
 *
 * Several sources can hold the same Spectrum key (Backspace is CAPS+0 while
 * a real Shift is also CAPS), so each key counts how many sources hold it
 * and is only released when the last one lets go.
 */

// ZX_KEY_* values from src/zxem/zxio.h
export const ZX = {
	SHIFT: 1, Z: 2, X: 3, C: 4, V: 5,
	A: 6, S: 7, D: 8, F: 9, G: 10,
	Q: 11, W: 12, E: 13, R: 14, T: 15,
	N1: 16, N2: 17, N3: 18, N4: 19, N5: 20,
	N0: 21, N9: 22, N8: 23, N7: 24, N6: 25,
	P: 26, O: 27, I: 28, U: 29, Y: 30,
	ENTER: 31, L: 32, K: 33, J: 34, H: 35,
	SPACE: 36, SYM: 37, M: 38, N: 39, B: 40,
};

// KeyboardEvent.code -> Spectrum keys held while it is down
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

// Joystick bits (Kempston order): right, left, down, up, fire
const RIGHT = 1, LEFT = 2, DOWN = 4, UP = 8, FIRE = 16;

// PC keys that move the joystick when one is selected
const JOY_CODES = { ArrowRight: RIGHT, ArrowLeft: LEFT, ArrowDown: DOWN, ArrowUp: UP, Tab: FIRE };

// Joysticks that are really keys, in joystick bit order
const JOY_KEYS = {
	cursor: [ZX.N8, ZX.N5, ZX.N6, ZX.N7, ZX.N0],
	sinclair: [ZX.N7, ZX.N6, ZX.N8, ZX.N9, ZX.N0], // Interface 2, port 1
};

// Modifier flags on a KeyboardEvent and the keys behind them
const MODIFIERS = [
	['shiftKey', ['ShiftLeft', 'ShiftRight']],
	['ctrlKey', ['ControlLeft', 'ControlRight']],
	['altKey', ['AltLeft', 'AltRight']],
];

// On-screen keys: label, Spectrum key, and whether it latches until the
// next key (CAPS SHIFT and SYMBOL SHIFT, so one finger can type combos)
const SCREEN_KEYS = [
	[...'1234567890'].map((d) => [d, ZX['N' + d]]),
	[...'QWERTYUIOP'].map((c) => [c, ZX[c]]),
	[...[...'ASDFGHJKL'].map((c) => [c, ZX[c]]), ['Enter', ZX.ENTER]],
	[['Caps', ZX.SHIFT, true], ...[...'ZXCVBNM'].map((c) => [c, ZX[c]]),
		['Sym', ZX.SYM, true], ['Space', ZX.SPACE]],
];

// A tap shorter than this could fall between two keyboard scans
const MIN_TAP_MS = 60;

function isFormField(el) {
	return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ||
		(el instanceof HTMLInputElement && el.id !== 'keysink') || el?.isContentEditable;
}

export function createInput(zx) {
	const held = new Map(); // Spectrum key -> how many sources hold it

	function setKeys(keys, down) {
		for (const k of keys) {
			const n = Math.max(0, (held.get(k) || 0) + (down ? 1 : -1));
			held.set(k, n);
			zx._zx_key(k, n > 0 ? 1 : 0);
		}
	}

	// --- Joystick ---------------------------------------------------------

	let mode = 'keys';                      // keys, kempston, sinclair or cursor
	const joy = { keys: 0, pad: 0, touch: 0 }; // bits from each source
	let joyHeld = [];                       // keys held for a key joystick

	function updateJoy() {
		const bits = joy.keys | joy.pad | joy.touch;
		// With no joystick selected, gamepads and touch act as a cursor joystick
		const map = mode === 'kempston' ? null : JOY_KEYS[mode] ?? JOY_KEYS.cursor;
		zx._zx_joy(map ? 0 : bits);
		const keys = map ? map.filter((k, i) => bits & (1 << i)) : [];
		setKeys(joyHeld, false);
		setKeys(keys, true);
		joyHeld = keys;
	}

	// --- PC keyboard ------------------------------------------------------

	const pressed = new Map(); // KeyboardEvent.code -> what it pressed

	function press(code) {
		if (mode !== 'keys' && JOY_CODES[code]) {
			const bit = JOY_CODES[code];
			pressed.set(code, { bit });
			joy.keys |= bit;
			updateJoy();
		} else if (KEYMAP[code]) {
			pressed.set(code, { keys: KEYMAP[code] });
			setKeys(KEYMAP[code], true);
		} else {
			return false;
		}
		return true;
	}

	function release(code) {
		const p = pressed.get(code);
		if (!p) return false;
		pressed.delete(code);
		if (p.bit) {
			joy.keys &= ~p.bit;
			updateJoy();
		} else {
			setKeys(p.keys, false);
		}
		return true;
	}

	// A modifier released while the page didn't see it (e.g. during an OS
	// shortcut) would stay held. The flags on every event say what's down.
	function syncModifiers(e) {
		for (const [flag, codes] of MODIFIERS) {
			if (e[flag]) continue;
			for (const c of codes) if (c !== e.code) release(c);
		}
	}

	window.addEventListener('keydown', (e) => {
		if (isFormField(e.target) || e.metaKey) return;
		syncModifiers(e);
		if (pressed.has(e.code)) {
			e.preventDefault(); // auto-repeat
		} else if (press(e.code)) {
			e.preventDefault();
		}
	});
	window.addEventListener('keyup', (e) => {
		syncModifiers(e);
		if (release(e.code)) e.preventDefault();
	});

	// Browser extensions such as Vimium take over keys unless the focus is
	// in a text field, so keep the focus in a hidden one. Not on touch
	// screens, where focusing a field can bring up the system keyboard.
	const sink = document.getElementById('keysink');
	const coarse = matchMedia('(pointer: coarse)').matches;
	sink.addEventListener('input', () => { sink.value = ''; });
	function focusSink() {
		if (coarse || isFormField(document.activeElement)) return;
		sink.focus({ preventScroll: true });
	}
	// After any click (buttons included) give the keys back to the game
	document.addEventListener('click', () => setTimeout(focusSink));
	window.addEventListener('focus', focusSink);

	// --- Gamepads ---------------------------------------------------------

	function poll() {
		let bits = 0;
		for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
			if (!pad) continue;
			const x = pad.axes[0] || 0;
			const y = pad.axes[1] || 0;
			const b = (i) => pad.buttons[i]?.pressed;
			if (x > 0.5 || b(15)) bits |= RIGHT;
			if (x < -0.5 || b(14)) bits |= LEFT;
			if (y > 0.5 || b(13)) bits |= DOWN;
			if (y < -0.5 || b(12)) bits |= UP;
			if (b(0) || b(1) || b(2) || b(3)) bits |= FIRE;
		}
		if (bits !== joy.pad) {
			joy.pad = bits;
			updateJoy();
		}
	}

	// --- Touch d-pad and fire button --------------------------------------

	// The d-pad has 8 directions, picked by the angle from its centre
	const SECTORS = [RIGHT, RIGHT | DOWN, DOWN, DOWN | LEFT, LEFT, LEFT | UP, UP, UP | RIGHT];

	function bindDpad(el) {
		let id = null;
		const move = (e) => {
			const r = el.getBoundingClientRect();
			const x = (e.clientX - r.left) / r.width * 2 - 1;
			const y = (e.clientY - r.top) / r.height * 2 - 1;
			let bits = 0;
			if (Math.hypot(x, y) > 0.25) bits = SECTORS[Math.round(Math.atan2(y, x) / (Math.PI / 4)) & 7];
			joy.touch = (joy.touch & FIRE) | bits;
			el.dataset.dir = bits;
			updateJoy();
		};
		const end = (e) => {
			if (e.pointerId !== id) return;
			id = null;
			joy.touch &= FIRE;
			el.dataset.dir = 0;
			updateJoy();
		};
		el.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			id = e.pointerId;
			el.setPointerCapture(id);
			move(e);
		});
		el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}

	function bindFire(el) {
		let id = null;
		el.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			id = e.pointerId;
			el.setPointerCapture(id);
			el.classList.add('down');
			joy.touch |= FIRE;
			updateJoy();
		});
		const end = (e) => {
			if (e.pointerId !== id) return;
			id = null;
			el.classList.remove('down');
			joy.touch &= ~FIRE;
			updateJoy();
		};
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}

	// --- On-screen Spectrum keyboard --------------------------------------

	const latched = new Map(); // latching key -> its button

	function unlatch() {
		for (const [k, btn] of latched) {
			setKeys([k], false);
			btn.classList.remove('down');
		}
		latched.clear();
	}

	function buildKeyboard(container) {
		for (const row of SCREEN_KEYS) {
			const rowEl = document.createElement('div');
			rowEl.className = 'zxrow';
			for (const [label, key, latches] of row) {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.textContent = label;
				btn.className = 'zxkey' + (label.length > 1 ? ' wide' : '');
				if (latches) {
					btn.addEventListener('pointerdown', (e) => {
						e.preventDefault();
						if (latched.has(key)) {
							latched.delete(key);
							setKeys([key], false);
							btn.classList.remove('down');
						} else {
							latched.set(key, btn);
							setKeys([key], true);
							btn.classList.add('down');
						}
					});
				} else {
					let id = null;
					let downAt = 0;
					btn.addEventListener('pointerdown', (e) => {
						e.preventDefault();
						id = e.pointerId;
						btn.setPointerCapture(id);
						downAt = performance.now();
						btn.classList.add('down');
						setKeys([key], true);
					});
					const end = (e) => {
						if (e.pointerId !== id) return;
						id = null;
						btn.classList.remove('down');
						// Hold for long enough that the Spectrum sees the key
						setTimeout(() => {
							setKeys([key], false);
							unlatch();
						}, Math.max(0, MIN_TAP_MS - (performance.now() - downAt)));
					};
					btn.addEventListener('pointerup', end);
					btn.addEventListener('pointercancel', end);
				}
				rowEl.append(btn);
			}
			container.append(rowEl);
		}
	}

	// --- Everything -------------------------------------------------------

	function releaseAll() {
		for (const code of [...pressed.keys()]) release(code);
		joy.keys = joy.pad = joy.touch = 0;
		updateJoy();
		unlatch();
	}
	// Release everything if focus leaves the page mid-press
	window.addEventListener('blur', releaseAll);

	return {
		poll,
		releaseAll,
		focusSink,
		bindDpad,
		bindFire,
		buildKeyboard,
		get mode() { return mode; },
		set mode(m) {
			releaseAll();
			mode = m;
		},
	};
}
