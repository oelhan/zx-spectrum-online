/* zxsound.h

	Beeper sound: EAR/MIC output turned into samples at the host's rate

*/

#ifndef _ZXSOUND_H_
#define _ZXSOUND_H_

// Samples kept until the front end takes them (about 1/3s at 48kHz)
#define SOUND_BUFFER 16384

// Start making samples at rate Hz, or stop with 0 (the default)
void ZX_SoundInit(int rate);

// Called when port 0xFE is written, with the byte written
void ZX_SoundOutput(uint8_t data);

// Called for writes to the AY data port (0xBFFD)
void ZX_SoundAYWrite(uint8_t value);

// Called at the end of every frame, and after the CPU is reset
void ZX_SoundFrame(void);
void ZX_SoundReset(void);

// Samples made since the last call to ZX_SoundTake (-1.0 to 1.0)
float *ZX_SoundBuffer(void);
int ZX_SoundTake(void);

#endif
