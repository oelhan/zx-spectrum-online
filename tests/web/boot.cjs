// Boot test for the web build: runs the 48K ROM from reset in Node and
// checks the copyright message reached the screen.
//
//   node tests/web/boot.cjs [out.png]
//
// Writes the final frame as a PNG when a path is given.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const createZXEM = require(path.join(__dirname, '../../dist/zxem.js'));

const FRAMES = 150; // 3 seconds; the ROM finishes clearing memory in about 1

// Minimal RGBA PNG encoder
function png(w, h, rgba) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

createZXEM().then((zx) => {
	if (!zx._zx_init()) {
		console.error('FAIL: zx_init returned 0');
		process.exit(1);
	}
	const t0 = Date.now();
	for (let i = 0; i < FRAMES; i++) zx._zx_run_frame();
	const ms = Date.now() - t0;

	const w = zx._zx_fb_width();
	const h = zx._zx_fb_height();
	const ptr = zx._zx_framebuffer();
	const fb = zx.HEAPU8.slice(ptr, ptr + w * h * 4);

	if (process.argv[2]) fs.writeFileSync(process.argv[2], png(w, h, fb));

	// The copyright line is black ink on white paper in the bottom row of
	// character cells; a screen of only paper means the ROM never printed it.
	const border = (h - 192) / 2;
	let ink = 0;
	for (let y = border + 184; y < border + 192; y++) {
		for (let x = 0; x < w; x++) {
			if (fb[(y * w + x) * 4] === 0) ink++;
		}
	}
	console.log(`${FRAMES} frames in ${ms} ms (${(FRAMES * 20 / ms).toFixed(1)}x real time)`);
	if (ink === 0) {
		console.error('FAIL: no text in the bottom line of the screen');
		process.exit(1);
	}
	console.log('PASS: boot message drawn');
});
