/* zxay.c
 *
 * ZX Spectrum emulator
 * Copyright (c) 2016 MikeDX
 *
 * Cross platform ZX Spectrum emulator
 *
 * AY-3-8912 sound chip: three square wave tone channels, a noise
 * generator and a volume envelope, stepped at AY_CLOCK/8. zxsound.c calls
 * AY_Tick() and mixes the result with the beeper.
 *
 * Registers:
 *   0-5   tone period A, B, C (12 bits, fine then coarse)
 *   6     noise period (5 bits)
 *   7     mixer: bits 0-2 tone off for A-C, bits 3-5 noise off for A-C
 *   8-10  volume A-C (4 bits), bit 4 = follow the envelope
 *   11-12 envelope period (16 bits)
 *   13    envelope shape: bit 3 continue, 2 attack, 1 alternate, 0 hold
 *   14-15 I/O ports (not connected to anything here)
 */

#include "zxem.h"

// Measured AY output levels for volumes 0-15, from Fuse
static const float levels[16] = {
	0.0000f, 0.0137f, 0.0205f, 0.0291f, 0.0423f, 0.0618f, 0.0847f, 0.1369f,
	0.1691f, 0.2647f, 0.3527f, 0.4499f, 0.5704f, 0.6873f, 0.8482f, 1.0000f,
};

// Bits each register keeps (the rest read back as 0)
static const uint8_t reg_mask[16] = {
	0xFF, 0x0F, 0xFF, 0x0F, 0xFF, 0x0F, 0x1F, 0xFF,
	0x1F, 0x1F, 0x1F, 0xFF, 0xFF, 0x0F, 0xFF, 0xFF,
};

static uint8_t regs[16];
static uint8_t selected;

static int tone_count[3];
static uint8_t tone_out[3];

static int noise_count;
static uint32_t noise_rng;
static uint8_t noise_out;

static int env_count;
static int env_pos;       // counts 15 down to 0 through each ramp
static int env_attack;    // 15 while ramping up, 0 while ramping down
static int env_holding;
static int env_vol;

static void env_start(void) {
	env_count = 0;
	env_pos = 15;
	env_attack = (regs[13] & 0x04) ? 15 : 0;
	env_holding = 0;
	env_vol = env_pos ^ env_attack;
}

void AY_Reset(void) {
	int i;

	memset(regs, 0, sizeof(regs));
	selected = 0;
	for(i=0; i<3; i++) {
		tone_count[i] = 0;
		tone_out[i] = 0;
	}
	noise_count = 0;
	noise_rng = 1;
	noise_out = 0;
	env_start();
}

void AY_Select(uint8_t reg) {
	selected = reg;
}

void AY_SetReg(int reg, uint8_t value) {
	if(reg < 0 || reg > 15) {
		return;
	}
	regs[reg] = value & reg_mask[reg];
	// Writing the shape restarts the envelope, even with the same value
	if(reg == 13) {
		env_start();
	}
}

void AY_Write(uint8_t value) {
	AY_SetReg(selected, value);
}

uint8_t AY_Read(void) {
	return selected < 16 ? regs[selected] : 0xFF;
}

uint8_t AY_GetSelected(void) {
	return selected;
}

uint8_t AY_GetReg(int reg) {
	return regs[reg & 15];
}

/* One envelope step: walk the ramp, then repeat, flip or hold by shape */
static void env_step(void) {
	uint8_t shape = regs[13];

	if(env_holding) {
		return;
	}
	if(--env_pos >= 0) {
		env_vol = env_pos ^ env_attack;
		return;
	}
	if(!(shape & 0x08)) {
		// Shapes 0-7: one ramp, then silence
		env_vol = 0;
		env_holding = 1;
	} else if(shape & 0x01) {
		// Hold: stay at the ramp's last level, or the opposite if alternating
		env_vol = (shape & 0x02) ? env_attack ^ 15 : env_attack;
		env_holding = 1;
	} else {
		// Repeat, changing direction each time if alternating
		if(shape & 0x02) {
			env_attack ^= 15;
		}
		env_pos = 15;
		env_vol = env_pos ^ env_attack;
	}
}

float AY_Tick(void) {
	float out = 0;
	int ch, period, vol;

	// Tone: the output flips every period ticks
	for(ch=0; ch<3; ch++) {
		period = regs[ch*2] | regs[ch*2+1] << 8;
		if(period == 0) {
			period = 1;
		}
		if(++tone_count[ch] >= period) {
			tone_count[ch] = 0;
			tone_out[ch] ^= 1;
		}
	}

	// Noise runs at half the tone rate: a 17 bit LFSR
	period = regs[6] ? regs[6] : 1;
	if(++noise_count >= period*2) {
		noise_count = 0;
		if((noise_rng + 1) & 2) {
			noise_out ^= 1;
		}
		if(noise_rng & 1) {
			noise_rng ^= 0x24000;
		}
		noise_rng >>= 1;
	}

	// Envelope: one of 16 steps every 2 x period ticks
	period = regs[11] | regs[12] << 8;
	if(period == 0) {
		period = 1;
	}
	if(++env_count >= period*2) {
		env_count = 0;
		env_step();
	}

	// Mixer: a channel with tone and noise both off outputs its volume as
	// a steady level, which is how samples are played on the AY
	for(ch=0; ch<3; ch++) {
		if((tone_out[ch] || (regs[7] & (1 << ch))) &&
				(noise_out || (regs[7] & (8 << ch)))) {
			vol = (regs[8+ch] & 0x10) ? env_vol : regs[8+ch] & 0x0F;
			out += levels[vol];
		}
	}
	return out;
}
