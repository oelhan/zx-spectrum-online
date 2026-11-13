/* zxtape.c
 *
 * ZX Spectrum emulator
 * Copyright (c) 2016 MikeDX
 *
 * Cross platform ZX Spectrum emulator
 *
 * Tape images (.tap, .tzx). Blocks are not played as audio: the ROM's
 * LD-BYTES routine is trapped and each block is copied straight into
 * memory, so anything loaded through the ROM loads instantly. Games with
 * their own (turbo) loaders don't go through LD-BYTES and won't load.
 */

#include "zxem.h"

#define MAX_BLOCKS 1024

// Frames from reset until the ROM is waiting for a key (it boots in ~1.4s)
#define BOOT_FRAMES 100

// Frames to hold each key, and to wait after releasing it, when typing
#define KEY_FRAMES 5

typedef struct _TapeBlock {
	int offset;   // into tape_data: flag byte, data, checksum
	int len;
} TapeBlock;

static uint8_t *tape_data = NULL;
static TapeBlock blocks[MAX_BLOCKS];
static int block_count = 0;
static int block_pos = 0;

void ZX_TapeEject(void) {
	free(tape_data);
	tape_data = NULL;
	block_count = 0;
	block_pos = 0;
	tape_loaded = 0;
}

static int add_block(int offset, int len) {
	if(block_count >= MAX_BLOCKS) {
		ZX_SetLoadError("Tape has too many blocks");
		return 0;
	}
	blocks[block_count].offset = offset;
	blocks[block_count].len = len;
	block_count++;
	return 1;
}

/* Hold keys for a few frames and release them, the way a person types */
static void type_keys(int key1, int key2) {
	int i;

	ZX_KeyDown(key1);
	ZX_KeyDown(key2);
	for(i=0; i<KEY_FRAMES; i++) {
		ZX_Frame();
	}
	ZX_KeyUp(key1);
	ZX_KeyUp(key2);
	for(i=0; i<KEY_FRAMES; i++) {
		ZX_Frame();
	}
}

/* Reset, wait for the ROM to boot and type LOAD "" */
static void autoload(void) {
	int i;

	ZX_Reset();
	for(i=0; i<BOOT_FRAMES; i++) {
		ZX_Frame();
	}
	type_keys(ZX_KEY_J, 0);              // LOAD
	type_keys(ZX_KEY_SYM, ZX_KEY_P);     // "
	type_keys(ZX_KEY_SYM, ZX_KEY_P);     // "
	type_keys(ZX_KEY_ENTER, 0);
}

/* Take ownership of a copy of the image, then insert and autoload it */
static int insert(const uint8_t *data, int len) {
	uint8_t *copy;

	if(block_count == 0) {
		ZX_SetLoadError("Tape has no loadable blocks");
		return 0;
	}
	if(!(copy = (uint8_t *)malloc(len))) {
		ZX_SetLoadError("Out of memory");
		return 0;
	}
	memcpy(copy, data, len);
	free(tape_data);
	tape_data = copy;
	block_pos = 0;
	tape_loaded = 1;

	autoload();
	return 1;
}

/* .tap: each block is a 2 byte length followed by that many bytes */
int ZX_LoadTAP(const uint8_t *data, int len) {
	int pos = 0, blen;

	ZX_TapeEject();
	if(len >= 12 && !memcmp(data, "C64-TAPE-RAW", 12)) {
		ZX_SetLoadError("This is a Commodore 64 tape, not a ZX Spectrum one");
		return 0;
	}
	while(pos+2 <= len) {
		blen = data[pos] | data[pos+1]<<8;
		pos += 2;
		if(pos+blen > len) {
			ZX_SetLoadError("Corrupt .tap file (block runs past the end)");
			block_count = 0;
			return 0;
		}
		if(blen > 0 && !add_block(pos, blen)) {
			block_count = 0;
			return 0;
		}
		pos += blen;
	}
	return insert(data, len);
}

static int tzx_len24(const uint8_t *p) {
	return p[0] | p[1]<<8 | p[2]<<16;
}

static int tzx_len32(const uint8_t *p) {
	return p[0] | p[1]<<8 | p[2]<<16 | p[3]<<24;
}

/* .tzx: keep the data of standard (0x10), turbo (0x11) and pure data
   (0x14) blocks, skip everything else. Turbo blocks hold ordinary block
   bytes, so they load too if the game reads them through the ROM. */
int ZX_LoadTZX(const uint8_t *data, int len) {
	int pos = 10, id, skip, dlen;

	ZX_TapeEject();
	if(len < 10 || memcmp(data, "ZXTape!\x1A", 8)) {
		ZX_SetLoadError("Not a .tzx file");
		return 0;
	}

	while(pos < len) {
		id = data[pos++];
		skip = -1;
		dlen = 0;

		// Each case needs its fixed header in range before reading lengths
#define NEED(n) if(pos+(n) > len) { skip = -2; break; }
		switch(id) {
			case 0x10: NEED(4); dlen = data[pos+2] | data[pos+3]<<8; skip = 4; break;
			case 0x11: NEED(18); dlen = tzx_len24(&data[pos+15]); skip = 18; break;
			case 0x12: skip = 4; break;
			case 0x13: NEED(1); skip = 1 + data[pos]*2; break;
			case 0x14: NEED(10); dlen = tzx_len24(&data[pos+7]); skip = 10; break;
			case 0x15: NEED(8); skip = 8 + tzx_len24(&data[pos+5]); break;
			case 0x18:
			case 0x19: NEED(4); skip = 4 + tzx_len32(&data[pos]); break;
			case 0x20: skip = 2; break;
			case 0x21: NEED(1); skip = 1 + data[pos]; break;
			case 0x22: skip = 0; break;
			case 0x23: skip = 2; break;
			case 0x24: skip = 2; break;
			case 0x25: skip = 0; break;
			case 0x26: NEED(2); skip = 2 + (data[pos] | data[pos+1]<<8)*2; break;
			case 0x27: skip = 0; break;
			case 0x28: NEED(2); skip = 2 + (data[pos] | data[pos+1]<<8); break;
			case 0x2A: skip = 4; break;
			case 0x2B: skip = 5; break;
			case 0x30: NEED(1); skip = 1 + data[pos]; break;
			case 0x31: NEED(2); skip = 2 + data[pos+1]; break;
			case 0x32: NEED(2); skip = 2 + (data[pos] | data[pos+1]<<8); break;
			case 0x33: NEED(1); skip = 1 + data[pos]*3; break;
			case 0x35: NEED(20); skip = 20 + tzx_len32(&data[pos+16]); break;
			case 0x5A: skip = 9; break;
		}
#undef NEED

		if(skip == -1) {
			ZX_SetLoadError("Unsupported .tzx block type");
			block_count = 0;
			return 0;
		}
		if(skip < 0 || dlen < 0 || pos+skip+dlen > len) {
			ZX_SetLoadError("Corrupt .tzx file (block runs past the end)");
			block_count = 0;
			return 0;
		}
		if(dlen > 0 && !add_block(pos+skip, dlen)) {
			block_count = 0;
			return 0;
		}
		pos += skip+dlen;
	}
	return insert(data, len);
}

/* Called on the opcode fetch at LD-BYTES with the ROM's arguments in
   registers: A = expected flag byte, DE = length, IX = address, carry set
   for LOAD (clear for VERIFY). Does the load and returns RET (0xC9) as the
   opcode so the CPU goes straight back to the caller, with carry set on
   success like the real routine. */
uint8_t ZX_TapeTrap(void) {
	CPU_Regs regs;
	const uint8_t *b;
	int len, n, i;
	uint8_t parity = 0, ok = 0, verify_ok = 1;
	uint8_t a, f;

	// Tape finished: let the ROM wait for a real tape (SPACE breaks out)
	if(block_pos >= block_count) {
		return zxmem[TAPE_TRAP_ADDR];
	}

	CPU_GetRegs(CPU_Handle, &regs);
	a = regs.af >> 8;
	f = regs.af & 0xFF;

	b = &tape_data[blocks[block_pos].offset];
	len = blocks[block_pos].len;
	block_pos++;

	// A block whose flag byte doesn't match fails, and LOAD "" moves on
	if(len >= 2 && b[0] == a) {
		n = len-2;
		if(n > regs.de) {
			n = regs.de;
		}
		for(i=0; i<len; i++) {
			parity ^= b[i];
		}
		for(i=0; i<n; i++) {
			if(f & 0x01) {
				writebyte(regs.ix+i, b[1+i]);
			} else if(zxmem[(uint16_t)(regs.ix+i)] != b[1+i]) {
				verify_ok = 0;
			}
		}
		ok = n == regs.de && parity == 0 && verify_ok;
		regs.ix += n;
		regs.de -= n;
	}

	regs.af = (regs.af & 0xFF00) | (ok ? (f | 0x01) : (f & ~0x01));
	CPU_SetRegs(CPU_Handle, &regs);

	return 0xC9;
}
