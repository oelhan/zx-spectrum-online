/* zxload.c
 *
 * ZX Spectrum emulator
 * Copyright (c) 2016 MikeDX
 *
 * Cross platform ZX Spectrum emulator
 *
 * Snapshot loading (.sna and .z80, 48K only), the load dispatcher, and
 * saving the machine as a .z80 snapshot (used for save states).
 */

#include <ctype.h>
#include "zxem.h"

#define RAM_SIZE 49152

static const char *load_error = "";

// Set while restoring a save state, which keeps the inserted tape
static int restoring = 0;

void ZX_SetLoadError(const char *msg) {
	load_error = msg;
	printf("Load failed: %s\n", msg);
}

const char *ZX_LoadError(void) {
	return load_error;
}

static uint16_t word(const uint8_t *p) {
	return p[0] | p[1]<<8;
}

/* Put RAM and registers in place and make sure the whole screen redraws */
static void start_snapshot(const uint8_t *ram, CPU_Regs *regs, uint8_t border_colour) {
	if(!restoring) {
		ZX_TapeEject();
	}
	ZX_Reset();
	memcpy(&zxmem[0x4000], ram, RAM_SIZE);
	memset(cached, 1, 65536);
	border = border_colour & 0x07;
	CPU_SetRegs(CPU_Handle, regs);
}

/* .sna: 27 byte header then 48K of RAM. PC is on the stack. */
int ZX_LoadSNA(const uint8_t *data, int len) {
	CPU_Regs regs;
	const uint8_t *ram = &data[27];
	uint16_t sp;

	if(len != 27+RAM_SIZE) {
		ZX_SetLoadError("Only 48K .sna snapshots are supported");
		return 0;
	}

	regs.i = data[0];
	regs.hl_ = word(&data[1]);
	regs.de_ = word(&data[3]);
	regs.bc_ = word(&data[5]);
	regs.af_ = word(&data[7]);
	regs.hl = word(&data[9]);
	regs.de = word(&data[11]);
	regs.bc = word(&data[13]);
	regs.iy = word(&data[15]);
	regs.ix = word(&data[17]);
	regs.iff1 = regs.iff2 = (data[19] >> 2) & 1;
	regs.r = data[20];
	regs.af = word(&data[21]);
	sp = word(&data[23]);
	regs.im = data[25] & 3;

	// The snapshot was taken inside an interrupt, so RETN: pop PC
	if(sp < 0x4000 || sp > 0xFFFE) {
		ZX_SetLoadError("Corrupt .sna snapshot (stack pointer outside RAM)");
		return 0;
	}
	regs.pc = ram[sp-0x4000] | ram[sp+1-0x4000]<<8;
	regs.sp = sp+2;

	start_snapshot(ram, &regs, data[26]);
	return 1;
}

/* .z80 run length decoding: ED ED nn bb is nn copies of bb.
   Returns the number of input bytes used, or -1 if it runs out early. */
static int z80_unpack(const uint8_t *src, int srclen, uint8_t *dst, int dstlen) {
	int s = 0, d = 0, n;

	while(d < dstlen) {
		if(s+3 < srclen && src[s]==0xED && src[s+1]==0xED) {
			n = src[s+2];
			while(n-- && d < dstlen) {
				dst[d++] = src[s+3];
			}
			s += 4;
		} else if(s < srclen) {
			dst[d++] = src[s++];
		} else {
			return -1;
		}
	}
	return s;
}

/* .z80 versions 1, 2 and 3 (48K hardware modes only) */
int ZX_LoadZ80(const uint8_t *data, int len) {
	static uint8_t ram[RAM_SIZE];
	CPU_Regs regs;
	uint8_t flags;
	int extlen, hw, pos, blen, page, offset;
	int pages_seen = 0;

	if(len < 30) {
		ZX_SetLoadError("Corrupt .z80 snapshot (too short)");
		return 0;
	}

	flags = data[12] == 255 ? 1 : data[12];

	regs.af = data[0]<<8 | data[1];
	regs.bc = word(&data[2]);
	regs.hl = word(&data[4]);
	regs.pc = word(&data[6]);
	regs.sp = word(&data[8]);
	regs.i = data[10];
	regs.r = (data[11] & 0x7F) | (flags & 1)<<7;
	regs.de = word(&data[13]);
	regs.bc_ = word(&data[15]);
	regs.de_ = word(&data[17]);
	regs.hl_ = word(&data[19]);
	regs.af_ = data[21]<<8 | data[22];
	regs.iy = word(&data[23]);
	regs.ix = word(&data[25]);
	regs.iff1 = data[27] ? 1 : 0;
	regs.iff2 = data[28] ? 1 : 0;
	regs.im = data[29] & 3;

	if(regs.pc != 0) {
		// Version 1: one 48K block, compressed if flag bit 5 is set
		if(flags & 0x20) {
			if(z80_unpack(&data[30], len-30, ram, RAM_SIZE) < 0) {
				ZX_SetLoadError("Corrupt .z80 snapshot (compressed data ends early)");
				return 0;
			}
		} else {
			if(len < 30+RAM_SIZE) {
				ZX_SetLoadError("Corrupt .z80 snapshot (too short)");
				return 0;
			}
			memcpy(ram, &data[30], RAM_SIZE);
		}
		start_snapshot(ram, &regs, flags >> 1);
		return 1;
	}

	// Version 2 (23 byte extra header) or 3 (54 or 55)
	if(len < 35) {
		ZX_SetLoadError("Corrupt .z80 snapshot (too short)");
		return 0;
	}
	extlen = word(&data[30]);
	if(extlen != 23 && extlen != 54 && extlen != 55) {
		ZX_SetLoadError("Unknown .z80 snapshot version");
		return 0;
	}
	regs.pc = word(&data[32]);
	hw = data[34];

	// 48K modes: v2 0-1, v3 0-1 and 3 (with or without Interface 1 / MGT)
	if((extlen == 23 && hw > 1) || (extlen != 23 && hw != 0 && hw != 1 && hw != 3)) {
		ZX_SetLoadError("128K snapshots are not supported yet");
		return 0;
	}

	memset(ram, 0, RAM_SIZE);
	pos = 32+extlen;
	while(pos+3 <= len) {
		blen = word(&data[pos]);
		page = data[pos+2];
		pos += 3;

		switch(page) {
			case 8: offset = 0x0000; break;   // 0x4000
			case 4: offset = 0x4000; break;   // 0x8000
			case 5: offset = 0x8000; break;   // 0xC000
			default: offset = -1; break;      // ROM pages etc: ignore
		}

		if(blen == 0xFFFF) {
			// Stored uncompressed
			blen = 16384;
			if(pos+blen > len) {
				ZX_SetLoadError("Corrupt .z80 snapshot (memory block ends early)");
				return 0;
			}
			if(offset >= 0) {
				memcpy(&ram[offset], &data[pos], 16384);
			}
		} else {
			if(pos+blen > len) {
				ZX_SetLoadError("Corrupt .z80 snapshot (memory block ends early)");
				return 0;
			}
			if(offset >= 0 && z80_unpack(&data[pos], blen, &ram[offset], 16384) < 0) {
				ZX_SetLoadError("Corrupt .z80 snapshot (compressed block ends early)");
				return 0;
			}
		}
		if(offset >= 0) {
			pages_seen |= 1 << (offset >> 14);
		}
		pos += blen;
	}

	if(pages_seen != 7) {
		ZX_SetLoadError("Corrupt .z80 snapshot (missing memory pages)");
		return 0;
	}

	start_snapshot(ram, &regs, flags >> 1);
	return 1;
}

/* Restore a save state made by ZX_SaveZ80, leaving the tape inserted */
int ZX_RestoreZ80(const uint8_t *data, int len) {
	int ok;

	restoring = 1;
	ok = ZX_LoadZ80(data, len);
	restoring = 0;
	return ok;
}

/* .z80 run length encoding: runs of 5 or more, or of 2 or more EDs, become
   ED ED nn bb. The byte after a lone ED is never the start of a run. */
static int z80_pack(const uint8_t *src, int len, uint8_t *dst) {
	int s = 0, d = 0, run;

	while(s < len) {
		run = 1;
		while(s+run < len && src[s+run] == src[s] && run < 255) {
			run++;
		}
		if(run >= 5 || (src[s] == 0xED && run >= 2)) {
			dst[d++] = 0xED;
			dst[d++] = 0xED;
			dst[d++] = run;
			dst[d++] = src[s];
			s += run;
		} else if(src[s] == 0xED) {
			dst[d++] = src[s++];
			if(s < len) {
				dst[d++] = src[s++];
			}
		} else {
			dst[d++] = src[s++];
		}
	}
	return d;
}

/* Save the machine as a compressed version 1 .z80 snapshot. out must hold
   Z80_SAVE_MAX bytes. Returns the length written. */
int ZX_SaveZ80(uint8_t *out) {
	CPU_Regs regs;
	int len;

	CPU_GetRegs(CPU_Handle, &regs);
	memset(out, 0, 30);
	out[0] = regs.af >> 8;
	out[1] = regs.af & 0xFF;
	out[2] = regs.bc & 0xFF;  out[3] = regs.bc >> 8;
	out[4] = regs.hl & 0xFF;  out[5] = regs.hl >> 8;
	out[6] = regs.pc & 0xFF;  out[7] = regs.pc >> 8;
	out[8] = regs.sp & 0xFF;  out[9] = regs.sp >> 8;
	out[10] = regs.i;
	out[11] = regs.r & 0x7F;
	out[12] = (regs.r >> 7) | (border & 7) << 1 | 0x20;   // 0x20: compressed
	out[13] = regs.de & 0xFF;  out[14] = regs.de >> 8;
	out[15] = regs.bc_ & 0xFF; out[16] = regs.bc_ >> 8;
	out[17] = regs.de_ & 0xFF; out[18] = regs.de_ >> 8;
	out[19] = regs.hl_ & 0xFF; out[20] = regs.hl_ >> 8;
	out[21] = regs.af_ >> 8;
	out[22] = regs.af_ & 0xFF;
	out[23] = regs.iy & 0xFF;  out[24] = regs.iy >> 8;
	out[25] = regs.ix & 0xFF;  out[26] = regs.ix >> 8;
	out[27] = regs.iff1;
	out[28] = regs.iff2;
	out[29] = regs.im & 3;

	len = 30 + z80_pack(&zxmem[0x4000], RAM_SIZE, &out[30]);
	out[len++] = 0x00;  // end marker
	out[len++] = 0xED;
	out[len++] = 0xED;
	out[len++] = 0x00;
	return len;
}

int ZX_LoadData(const uint8_t *data, int len, const char *ext) {
	char e[4];
	int i;

	if(*ext == '.') {
		ext++;
	}
	for(i=0; i<3 && ext[i]; i++) {
		e[i] = tolower((unsigned char)ext[i]);
	}
	e[i] = 0;

	if(ext[i] == 0) {
		if(!strcmp(e, "sna")) return ZX_LoadSNA(data, len);
		if(!strcmp(e, "z80")) return ZX_LoadZ80(data, len);
		if(!strcmp(e, "tap")) return ZX_LoadTAP(data, len);
		if(!strcmp(e, "tzx")) return ZX_LoadTZX(data, len);
	}

	ZX_SetLoadError("Unsupported file type (use .tap, .tzx, .sna or .z80)");
	return 0;
}

int ZX_LoadFile(const char *path) {
	FILE *f;
	uint8_t *data;
	long len;
	const char *ext;
	int ok;

	ext = strrchr(path, '.');
	if(!ext) {
		ZX_SetLoadError("File has no extension");
		return 0;
	}

	if(!(f = fopen(path, "rb"))) {
		ZX_SetLoadError("Could not open file");
		return 0;
	}
	fseek(f, 0, SEEK_END);
	len = ftell(f);
	fseek(f, 0, SEEK_SET);

	data = (uint8_t *)malloc(len > 0 ? len : 1);
	if(!data || fread(data, 1, len, f) != (size_t)len) {
		fclose(f);
		free(data);
		ZX_SetLoadError("Could not read file");
		return 0;
	}
	fclose(f);

	ok = ZX_LoadData(data, (int)len, ext);
	free(data);
	return ok;
}
