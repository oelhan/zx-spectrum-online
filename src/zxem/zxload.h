/* zxload.h

	Game loading: snapshots (.sna, .z80) and tapes (.tap, .tzx)

*/

#ifndef _ZXLOAD_H_
#define _ZXLOAD_H_

// ROM LD-BYTES entry point, trapped to load tape blocks instantly
#define TAPE_TRAP_ADDR 0x0556

// Set while a tape image is inserted
GLOBAL uint8_t tape_loaded;

// Load a game from memory, picking the format from the file extension
// (case insensitive, with or without the dot). Returns 1 on success.
int ZX_LoadData(const uint8_t *data, int len, const char *ext);

// Load a game from a file (native builds)
int ZX_LoadFile(const char *path);

// Human readable reason the last load failed
const char *ZX_LoadError(void);

// Snapshots (zxload.c)
int ZX_LoadSNA(const uint8_t *data, int len);
int ZX_LoadZ80(const uint8_t *data, int len);

// Save states: a .z80 snapshot of the machine. Restoring keeps the tape.
// Worst case: header, RAM where every ED pair costs 4 bytes, end marker.
#define Z80_SAVE_MAX (30 + 49152*2 + 4)
int ZX_SaveZ80(uint8_t *out);
int ZX_RestoreZ80(const uint8_t *data, int len);

// Tapes (zxtape.c). Inserting a tape resets the Spectrum and types LOAD ""
int ZX_LoadTAP(const uint8_t *data, int len);
int ZX_LoadTZX(const uint8_t *data, int len);
void ZX_TapeEject(void);
int ZX_TapePos(void);
void ZX_SetTapePos(int pos);
uint8_t ZX_TapeTrap(void);

// Shared by the loaders
void ZX_SetLoadError(const char *msg);

#endif
