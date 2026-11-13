/* zxsound.c
 *
 * ZX Spectrum emulator
 * Copyright (c) 2016 MikeDX
 *
 * Cross platform ZX Spectrum emulator
 *
 * Beeper sound. Each change of the EAR/MIC output is timed in T-states and
 * turned into samples at the host's rate: a sample is the average speaker
 * level over its slice of time (a box filter, so fast toggling doesn't
 * alias badly). A DC blocker then centres the wave around 0, like the
 * capacitor between the ULA and the speaker.
 */

#include "zxem.h"

// T-states per second of emulated time (50 frames a second)
#define CPU_HZ (CYCLES_PER_STEP*50)

// Speaker level for the EAR and MIC bits. MIC is only faintly audible.
#define LEVEL_EAR 0.5f
#define LEVEL_MIC 0.05f

// DC blocker cut-off in Hz
#define DC_CUTOFF 10

static float buffer[SOUND_BUFFER];
static int count = 0;

static double tstates_per_sample = 0;   // 0 while sound is off
static double pos = 0;                  // T-states into the current sample
static double area = 0;                 // level x T-states so far in it
static float level = 0;
static uint32_t last_t = 0;

static float dc_r, dc_in = 0, dc_out = 0;

void ZX_SoundInit(int rate) {
	tstates_per_sample = rate > 0 ? (double)CPU_HZ/rate : 0;
	dc_r = rate > 0 ? 1.0f - 6.2832f*DC_CUTOFF/rate : 0;
	count = 0;
	pos = 0;
	area = 0;
	dc_in = dc_out = 0;
	last_t = CPU_GetTStates(CPU_Handle);
}

/* Make samples for the time since the last call at the current level */
static void advance(void) {
	uint32_t now = CPU_GetTStates(CPU_Handle);
	double dt = (uint32_t)(now - last_t);
	float s;

	last_t = now;
	if(!tstates_per_sample) {
		return;
	}

	while(pos + dt >= tstates_per_sample) {
		double part = tstates_per_sample - pos;
		s = (float)((area + level*part) / tstates_per_sample);
		dc_out = s - dc_in + dc_r*dc_out;
		dc_in = s;
		// When nobody takes the samples (e.g. while a tape autoloads) drop them
		if(count < SOUND_BUFFER) {
			buffer[count++] = dc_out;
		}
		dt -= part;
		pos = 0;
		area = 0;
	}
	area += level*dt;
	pos += dt;
}

void ZX_SoundOutput(uint8_t data) {
	float l = (data & 0x10 ? LEVEL_EAR : 0) + (data & 0x08 ? LEVEL_MIC : 0);

	if(l != level) {
		advance();
		level = l;
	}
}

void ZX_SoundFrame(void) {
	advance();
}

/* The CPU's T-state count restarts on reset */
void ZX_SoundReset(void) {
	last_t = CPU_GetTStates(CPU_Handle);
}

float *ZX_SoundBuffer(void) {
	return buffer;
}

int ZX_SoundTake(void) {
	int n = count;
	count = 0;
	return n;
}
