// Loader tests for the web build. Builds small TAP, TZX, SNA and Z80 images
// in memory, loads each one and checks the program inside ran.
//
//   node tests/web/loaders.cjs [dir]
//
// With a directory, also writes the test images there (test.tap, test.tzx,
// test.sna, test.z80) for trying the page by hand.
'use strict';

const fs = require('fs');
const path = require('path');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

// Printed text is read back by matching 8x8 cells against the ROM font
const rom = fs.readFileSync(path.join(__dirname, '../../roms/48k.rom'));
const GLYPHS = {};
for (let c = 32; c < 128; c++) {
	GLYPHS[rom.subarray(0x3D00 + (c - 32) * 8, 0x3D00 + (c - 31) * 8).toString('hex')] =
		String.fromCharCode(c);
}

// --- Tape images ---------------------------------------------------------

const xor = (bytes) => bytes.reduce((a, b) => a ^ b, 0);
const block = (flag, data) => {
	const b = [flag, ...data];
	return [...b, xor(b)];
};
const le16 = (n) => [n & 0xFF, n >> 8];
const name10 = (s) => [...Buffer.from(s.padEnd(10))];
const num = (n) => [...Buffer.from(String(n)), 0x0E, 0, 0, ...le16(n), 0];

// 10 LOAD ""CODE: PRINT USR 32768
const LOAD = 0xEF, CODE = 0xAF, PRINT = 0xF5, USR = 0xC0;
const line = [LOAD, 0x22, 0x22, CODE, 0x3A, PRINT, USR, ...num(32768), 0x0D];
const program = [0, 10, ...le16(line.length), ...line];
// LD BC,1234 : RET
const code = [0x01, ...le16(1234), 0xC9];

const tapeBlocks = [
	block(0x00, [0, ...name10('loader'), ...le16(program.length), ...le16(10), ...le16(program.length)]),
	block(0xFF, program),
	block(0x00, [3, ...name10('code'), ...le16(code.length), ...le16(32768), ...le16(32768)]),
	block(0xFF, code),
];

const tap = Uint8Array.from(tapeBlocks.flatMap((b) => [...le16(b.length), ...b]));

const text = [...Buffer.from('test tape')];
const tzx = Uint8Array.from([
	...Buffer.from('ZXTape!\x1A'), 1, 20,
	0x30, text.length, ...text,                 // text description, skipped
	...tapeBlocks.flatMap((b) => [0x10, ...le16(1000), ...le16(b.length), ...b]),
]);

// --- Snapshots -----------------------------------------------------------

// 48K RAM image (0x4000-0xFFFF) with a program at 0x8000:
//   LD A,3 : OUT (254),A : LD HL,0x4000 : LD (HL),0xAA : LD (0x4001),BC : JR $
// BC comes from the snapshot, so a wrong register load shows on screen.
function ram() {
	const r = new Uint8Array(49152);
	r.fill(0x38, 0x1800, 0x1B00);              // black ink on white paper
	r.set([0x3E, 3, 0xD3, 0xFE, 0x21, 0x00, 0x40, 0x36, 0xAA,
		0xED, 0x43, 0x01, 0x40, 0x18, 0xFE], 0x4000);
	return r;
}
const BC = 0x0F0F;

function sna() {
	const r = ram();
	const sp = 0xFF00;
	r.set(le16(0x8000), sp - 0x4000);           // PC on the stack
	const h = new Uint8Array(27);
	h[0] = 0x3F;                                // I
	h.set(le16(BC), 13);
	h.set(le16(0x5C3A), 15);                    // IY
	h.set(le16(sp), 23);
	h[25] = 1;                                  // IM 1, interrupts disabled
	h[26] = 1;                                  // border
	return Uint8Array.from([...h, ...r]);
}

// .z80 run length encoding (a lone ED is never followed by a run)
function z80pack(data) {
	const out = [];
	for (let i = 0; i < data.length;) {
		let run = 1;
		while (i + run < data.length && data[i + run] === data[i] && run < 255) run++;
		if (run >= 5 || (data[i] === 0xED && run >= 2)) {
			out.push(0xED, 0xED, run, data[i]);
			i += run;
		} else if (data[i] === 0xED) {
			out.push(0xED);
			if (i + 1 < data.length) out.push(data[i + 1]);
			i += 2;
		} else {
			out.push(data[i++]);
		}
	}
	return out;
}

function z80header(pc) {
	const h = new Uint8Array(30);
	h.set(le16(BC), 2);
	h.set(le16(pc), 6);
	h.set(le16(0xFF00), 8);                     // SP
	h[10] = 0x3F;                               // I
	h[12] = 1 << 1 | 0x20;                      // border 1, compressed
	h.set(le16(0x5C3A), 23);                    // IY
	h[29] = 1;                                  // IM 1
	return h;
}

function z80v1() {
	return Uint8Array.from([...z80header(0x8000), ...z80pack(ram()), 0, 0xED, 0xED, 0]);
}

function z80v3(hw = 0) {
	const r = ram();
	const ext = new Uint8Array(2 + 54);
	ext.set(le16(54), 0);
	ext.set(le16(0x8000), 2);
	ext[4] = hw;
	const page = (n, data, compress) => {
		const body = compress ? z80pack(data) : [...data];
		return [...le16(compress ? body.length : 0xFFFF), n, ...body];
	};
	return Uint8Array.from([
		...z80header(0), ...ext,
		...page(8, r.subarray(0, 16384), true),     // 0x4000
		...page(4, r.subarray(16384, 32768), false), // 0x8000, uncompressed
		...page(5, r.subarray(32768), true),         // 0xC000
	]);
}

// --- Test run ------------------------------------------------------------

if (process.argv[2]) {
	const dir = process.argv[2];
	fs.writeFileSync(path.join(dir, 'test.tap'), tap);
	fs.writeFileSync(path.join(dir, 'test.tzx'), tzx);
	fs.writeFileSync(path.join(dir, 'test.sna'), sna());
	fs.writeFileSync(path.join(dir, 'test.z80'), z80v3());
}

let failures = 0;
const check = (name, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
	if (!ok) failures++;
};

createZXEM().then((zx) => {
	zx._zx_init();
	const frames = (n) => { for (let i = 0; i < n; i++) zx._zx_run_frame(); };
	const w = zx._zx_fb_width();
	const h = zx._zx_fb_height();
	const border = (h - 192) / 2;
	const fb = () => {
		const ptr = zx._zx_framebuffer();
		return zx.HEAPU8.slice(ptr, ptr + w * h * 4);
	};
	const screenText = () => {
		const pix = fb();
		const rows = [];
		for (let cy = 0; cy < 24; cy++) {
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
			rows.push(out.trimEnd());
		}
		return rows;
	};
	const load = (bytes, ext) => {
		const ptr = zx._malloc(bytes.length);
		zx.HEAPU8.set(bytes, ptr);
		const ok = zx.ccall('zx_load', 'number', ['number', 'number', 'string'], [ptr, bytes.length, ext]);
		zx._free(ptr);
		return ok ? '' : zx.UTF8ToString(zx._zx_load_error());
	};

	for (const [name, bytes, ext] of [['TAP', tap, 'tap'], ['TZX', tzx, 'TZX']]) {
		const err = load(bytes, ext);
		frames(50);
		const text = screenText();
		check(`${name} loads BASIC + CODE and runs it`, !err && text.includes('1234'),
			err || `screen: ${JSON.stringify(text.filter(Boolean))}`);
	}

	// Snapshot program: magenta border, pixels 0xAA then BC (0x0F 0x0F)
	const snapshotRan = () => {
		const pix = fb();
		const ink = (x) => pix[(border * w + border + x) * 4] === 0;
		const bits = Array.from({ length: 24 }, (_, x) => (ink(x) ? 1 : 0)).join('');
		const magenta = pix[0] > 0 && pix[1] === 0 && pix[2] > 0;
		return { ok: magenta && bits === '101010100000111100001111', detail: `border rgb ${pix[0]},${pix[1]},${pix[2]}, pixels ${bits}` };
	};
	for (const [name, bytes, ext] of [['SNA', sna(), 'sna'], ['Z80 v1', z80v1(), 'z80'], ['Z80 v3', z80v3(), '.z80']]) {
		const err = load(bytes, ext);
		frames(5);
		const r = snapshotRan();
		check(`${name} snapshot restores RAM and registers`, !err && r.ok, err || r.detail);
	}

	let err = load(z80v3(4), 'z80');
	check('128K .z80 is rejected', /128K/.test(err), err);
	err = load(Uint8Array.from([0x10, 0x00, 0xFF]), 'tap');
	check('corrupt .tap is rejected', /Corrupt/.test(err), err);
	err = load(Uint8Array.from([...Buffer.from('C64-TAPE-RAW'), 1, 0, 0, 0, 0, 0, 0, 0]), 'tap');
	check('Commodore 64 .tap is rejected', /Commodore 64/.test(err), err);
	err = load(tap, 'txt');
	check('unknown extension is rejected', /Unsupported/.test(err), err);

	process.exit(failures ? 1 : 0);
});
