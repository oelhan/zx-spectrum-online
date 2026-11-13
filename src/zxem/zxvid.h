/* zxvid.h
 *
 * ZX Video Header file
 *
 */

#ifndef _ZXVID_H_
#define _ZXVID_H_

// Spectrum colours
typedef struct _ZX_Pen {
	uint8_t r;
	uint8_t g;
	uint8_t b;
} ZX_Pen;

GLOBAL ZX_Pen colours[16];

// Output image: 256x192 paper area surrounded by a border on every side
#define ZX_BORDER   32
#define ZX_SCREEN_W (256+ZX_BORDER*2)
#define ZX_SCREEN_H (192+ZX_BORDER*2)

// Border colour (0-7), set by writes to port 0xFE
GLOBAL uint8_t border;

int ZX_SetPalette(void);
void ZX_Draw(void);

#endif
