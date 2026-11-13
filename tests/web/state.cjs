// Save state test for the web build: saving writes a .z80 snapshot, and
// restoring it brings back the same machine (and keeps the tape inserted).
//
//   node tests/web/state.cjs
'use strict';

const path = require('path');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

const le16 = (n) => [n & 0xFF, n >> 8];

// 48K snapshot whose RAM is full of awkward patterns for the .z80 run
// length encoding (lone EDs, ED pairs, long ED runs, ED before a run),
// running DI : JR $ at 0x8000
function sna() {
	const ram = new Uint8Array(49152);
	let seed = 1;
	for (let i = 0; i < ram.length; i++) {
		seed = (seed * 1103515245 + 12345) >>> 0;
		ram[i] = seed >>> 24;
	}
	const patterns = [[0xED], [0xED, 0xED], Array(300).fill(0xED), [0xED, 5, 5, 5, 5, 5, 5],
		[0xED, 0xED, 0xED, 7], Array(600).fill(0), [1, 0xED]];
	let at = 0;
	for (const p of patterns) {
		ram.set(p, at);
		at += p.length + 3;
	}
	// No FLASH: its phase follows the frame count, which isn't saved
	for (let i = 0x1800; i < 0x1B00; i++) ram[i] &= 0x7F;
	ram.set([0xF3, 0x18, 0xFE], 0x4000);  // DI : JR $ at 0x8000
	const sp = 0xFF00;
	ram.set(le16(0x8000), sp - 0x4000);
	ram.set([0xED], ram.length - 1);    // ED as the very last byte
	const h = new Uint8Array(27);
	h[0] = 0x3F;
	h.set(le16(0x1234), 13);            // BC
	h.set(le16(0x5C3A), 15);
	h.set(le16(sp), 23);
	h[20] = 0x85;                        // R with bit 7 set
	h[25] = 1;
	h[26] = 3;
	return Uint8Array.from([...h, ...ram]);
}

let failures = 0;
const check = (name, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' (' + detail + ')' : ''}`);
	if (!ok) failures++;
};

createZXEM().then((zx) => {
	zx._zx_init();
	const frames = (n) => { for (let i = 0; i < n; i++) zx._zx_run_frame(); };
	const fb = () => {
		const ptr = zx._zx_framebuffer();
		return Buffer.from(zx.HEAPU8.slice(ptr, ptr + zx._zx_fb_width() * zx._zx_fb_height() * 4));
	};
	const copyIn = (bytes) => {
		const ptr = zx._malloc(bytes.length);
		zx.HEAPU8.set(bytes, ptr);
		return ptr;
	};
	const load = (bytes, ext) => {
		const ptr = copyIn(bytes);
		const ok = zx.ccall('zx_load', 'number', ['number', 'number', 'string'], [ptr, bytes.length, ext]);
		zx._free(ptr);
		return ok;
	};
	const save = () => {
		const n = zx._zx_save_state();
		const ptr = zx._zx_state_buffer();
		return Buffer.from(zx.HEAPU8.slice(ptr, ptr + n));
	};
	const restore = (bytes) => {
		const ptr = copyIn(bytes);
		const ok = zx._zx_restore_state(ptr, bytes.length);
		zx._free(ptr);
		return ok;
	};

	load(sna(), 'sna');
	frames(5);
	const screen = fb();
	const state = save();
	check('save state is a compressed .z80', state.length < 30 + 49152 && (state[12] & 0x20) !== 0,
		`${state.length} bytes`);

	zx._zx_reset();
	frames(150);
	check('restore succeeds', restore(state) === 1);
	const again = save();
	check('restored machine saves identically (RAM and registers)', again.equals(state),
		`${again.length} vs ${state.length} bytes`);
	frames(5);
	check('restored machine shows the same screen', fb().equals(screen));

	// A save state is a normal .z80 file too
	zx._zx_reset();
	check('save state loads as a .z80 file', load(state, 'z80') === 1 && save().equals(state));

	// Restoring keeps the inserted tape and its position
	const tape = [];
	const block = (flag, data) => {
		const b = [flag, ...data];
		return [...b, b.reduce((a, x) => a ^ x, 0)];
	};
	// 10 PRINT 1: one header + one data block, so the tape ends at block 2
	const line = [0xF5, 0x31, 0x0E, 0, 0, 1, 0, 0, 0x0D];
	const prog = [0, 10, ...le16(line.length), ...line];
	for (const b of [
		block(0x00, [0, ...Buffer.from('prog      '), ...le16(prog.length), ...le16(10), ...le16(prog.length)]),
		block(0xFF, prog),
	]) tape.push(...le16(b.length), ...b);
	load(Uint8Array.from(tape), 'tap');
	frames(50);
	check('tape is at its end after loading', zx._zx_tape_pos() === 2, `position ${zx._zx_tape_pos()}`);
	const tapeState = save();
	zx._zx_set_tape_pos(0);
	restore(tapeState);
	// An ejected tape has no blocks, so its position can't be set to 2
	zx._zx_set_tape_pos(2);
	check('restore keeps the tape inserted', zx._zx_tape_pos() === 2, `position ${zx._zx_tape_pos()}`);
	zx._zx_set_tape_pos(99);
	check('out of range tape position is ignored', zx._zx_tape_pos() === 2);

	process.exit(failures ? 1 : 0);
});
