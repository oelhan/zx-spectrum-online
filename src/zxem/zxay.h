/* zxay.h

	AY-3-8912 sound chip, on the 128K ports: 0xFFFD selects a register
	(and reads it back), 0xBFFD writes it. 48K AY interfaces use the same
	ports.

*/

#ifndef _ZXAY_H_
#define _ZXAY_H_

// The 128K clocks the AY at half the 3.5469 MHz CPU clock
#define AY_CLOCK 1773400

// The chip is stepped at AY_CLOCK/8, the rate its tone counters run at
#define AY_TICK_HZ (AY_CLOCK/8)

// Port decoding: A15 and A1 pick the register, A14 select or data
#define AY_PORT_MASK   0xC002
#define AY_PORT_SELECT 0xC000
#define AY_PORT_DATA   0x8000

void AY_Reset(void);
void AY_Select(uint8_t reg);
void AY_Write(uint8_t value);
uint8_t AY_Read(void);

// Whole register file and the selected register, for snapshots
uint8_t AY_GetSelected(void);
uint8_t AY_GetReg(int reg);
void AY_SetReg(int reg, uint8_t value);

// Advance one tick. Returns the mixed output, 0.0 to 3.0
float AY_Tick(void);

#endif
