/* web.c
 *
 * ZX Spectrum emulator
 * Copyright (c) 2016 MikeDX
 *
 * Cross platform ZX Spectrum emulator
 *
 * OSDEP file for the browser (Emscripten, no SDL).
 * JavaScript owns the canvas, input and timing. It calls zx_run_frame()
 * 50 times a second and copies zx_framebuffer() into an ImageData.
 */
#include <emscripten.h>
#include "osdep.h"
#include "zxem.h"

#define WEB_WIDTH  ZX_SCREEN_W
#define WEB_HEIGHT ZX_SCREEN_H

// RGBA framebuffer handed to JavaScript
static uint32_t framebuffer[WEB_WIDTH*WEB_HEIGHT];

// Spectrum palette as RGBA (little endian: 0xAABBGGRR)
static uint32_t palette[16];

void OSD_Init(void) {
}

void OSD_Quit(void) {
}

void OSD_SetVideoMode(int width, int height, int fullscreen) {
}

void OSD_SetPalette(void) {
	int x;
	for(x=0;x<16;x++) {
		palette[x] = 0xFF000000 | colours[x].b<<16 | colours[x].g<<8 | colours[x].r;
	}
}

void OSD_RenderScreen(void) {
	int i;
	for(i=0;i<WEB_WIDTH*WEB_HEIGHT;i++) {
		framebuffer[i] = palette[screenbuf[i]];
	}
}

void OSD_Input(void) {
	// Key state is pushed in from JavaScript via zx_key()
}

// Exported API, called from web/app.js

EMSCRIPTEN_KEEPALIVE int zx_init(void) {
	return ZX_Init();
}

EMSCRIPTEN_KEEPALIVE void zx_reset(void) {
	ZX_Reset();
}

EMSCRIPTEN_KEEPALIVE void zx_run_frame(void) {
	ZX_Frame();
}

EMSCRIPTEN_KEEPALIVE uint8_t *zx_framebuffer(void) {
	return (uint8_t *)framebuffer;
}

EMSCRIPTEN_KEEPALIVE int zx_fb_width(void) {
	return WEB_WIDTH;
}

EMSCRIPTEN_KEEPALIVE int zx_fb_height(void) {
	return WEB_HEIGHT;
}

/* Kempston joystick state: bit 0 right, 1 left, 2 down, 3 up, 4 fire */
EMSCRIPTEN_KEEPALIVE void zx_joy(int bits) {
	kempston = bits & 0x1F;
}

/* key is a ZX_KEY_* value (see zxio.h), down is 1 for pressed */
EMSCRIPTEN_KEEPALIVE void zx_key(int key, int down) {
	if(key<=0 || key>=ZX_KEY_LAST) {
		return;
	}
	if(down) {
		indata[keyaddr[key]]&=~keybuf[key];
	} else {
		indata[keyaddr[key]]|=keybuf[key];
	}
}
