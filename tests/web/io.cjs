// I/O test for the web build: types BASIC into the 48K ROM and checks the
// ULA port decode, Kempston joystick and border colour.
//
//   node tests/web/io.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

// ZX_KEY_* values from src/zxem/zxio.h
const K = {
	SHIFT: 1, SYM: 37, ENTER: 31, SPACE: 36,
	P: 26, I: 28, B: 40, N0: 21, N1: 16, N2: 17, N3: 18, N4: 19, N5: 20,
	N6: 25, N7: 24, N8: 23, N9: 22,
};
const DIGIT = [K.N0, K.N1, K.N2, K.N3, K.N4, K.N5, K.N6, K.N7, K.N8, K.N9];

// Printed text is read back by matching 8x8 cells against the ROM font,
// which holds characters 32-127 at 0x3D00
const rom = fs.readFileSync(path.join(__dirname, '../../roms/48k.rom'));
const GLYPHS = {};
for (let c = 32; c < 128; c++) {
	GLYPHS[rom.subarray(0x3D00 + (c - 32) * 8, 0x3D00 + (c - 31) * 8).toString('hex')] =
		String.fromCharCode(c);
}

let failures = 0;

createZXEM().then((zx) => {
	zx._zx_init();
	const frames = (n) => { for (let i = 0; i < n; i++) zx._zx_run_frame(); };
	const press = (keys, hold = 5) => {
		keys.forEach((k) => zx._zx_key(k, 1));
		frames(hold);
		keys.forEach((k) => zx._zx_key(k, 0));
		frames(5);
	};
	const number = (n) => String(n).split('').forEach((d) => press([DIGIT[+d]]));
	const w = zx._zx_fb_width();
	const h = zx._zx_fb_height();
	const border = (h - 192) / 2;
	const fb = () => {
		const ptr = zx._zx_framebuffer();
		return zx.HEAPU8.slice(ptr, ptr + w * h * 4);
	};

	// Text on a character row of the paper area (black ink on white paper)
	const textRow = (cy) => {
		const pix = fb();
		let out = '';
		for (let cx = 0; cx < 32; cx++) {
			let bits = '';
			for (let y = 0; y < 8; y++) {
				let row = 0;
				for (let x = 0; x < 8; x++) {
					const o = ((border + cy * 8 + y) * w + border + cx * 8 + x) * 4;
					row = (row << 1) | (pix[o] === 0 ? 1 : 0);
				}
				bits += row.toString(16).padStart(2, '0');
			}
			out += GLYPHS[bits] ?? '?';
		}
		return out.trimEnd();
	};
	const check = (name, ok, detail) => {
		console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
		if (!ok) failures++;
	};

	frames(150);

	// PRINT IN 31 with Kempston fire held -> 16
	zx._zx_joy(0x10);
	press([K.P]);                // PRINT
	press([K.SHIFT, K.SYM]);     // extended mode
	press([K.SYM, K.I]);         // IN
	number(31);
	press([K.ENTER]);
	frames(10);
	zx._zx_joy(0);
	let line = textRow(0);
	check('Kempston fire reads 16 on port 31', line === '16', `printed "${line}"`);

	// PRINT IN 254 reads all eight rows at once (high byte 0). ENTER is still
	// held when the statement runs, so bit 0 must be 0.
	press([K.P]);
	press([K.SHIFT, K.SYM]);
	press([K.SYM, K.I]);
	number(254);
	press([K.ENTER], 15);
	frames(10);
	line = textRow(1); // each PRINT goes on the next row
	const v = parseInt(line, 10);
	check('port 254 ANDs every keyboard row', !Number.isNaN(v) && (v & 1) === 0 && (v & 0xA0) === 0xA0,
		`printed "${line}"`);

	// BORDER 2 -> red border
	press([K.B]);
	number(2);
	press([K.ENTER]);
	frames(10);
	const pix = fb();
	const r = pix[0], g = pix[1], b = pix[2];
	check('BORDER 2 draws a red border', r > 0 && g === 0 && b === 0, `rgb ${r},${g},${b}`);

	process.exit(failures ? 1 : 0);
});

