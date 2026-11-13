/* cpuintf.h
 * 
 * CPU Interface
 *
 * Allows ZXEM to be used with different cpu cores
 *
 * Works the same way as OSDEP functions. Add the calls as you need
 *
 */

#include "zxem.h"

uint8_t CPU_Create(void);
void CPU_Reset(uint8_t cpuid);
void CPU_Destroy(uint8_t cpuid);
// Returns the T-states the interrupt took
int CPU_Interrupt(uint8_t cpuid);
void CPU_NMI(uint8_t cpuid);
int CPU_Emulate(uint8_t cpuid, int ticks);
void CPU_SetReg(uint8_t cpuid, char *reg, uint16_t value);
uint16_t CPU_GetReg(uint8_t cpuid, char *reg);

// T-states run since the last reset (wraps around), used to time sound
uint32_t CPU_GetTStates(uint8_t cpuid);

// Whole register set, used by snapshot loading and the tape trap.
// Primed names (af_ etc.) are the alternate set.
typedef struct _CPU_Regs {
	uint16_t af, bc, de, hl;
	uint16_t af_, bc_, de_, hl_;
	uint16_t ix, iy, sp, pc;
	uint8_t i, r;
	uint8_t iff1, iff2, im;
} CPU_Regs;

void CPU_GetRegs(uint8_t cpuid, CPU_Regs *regs);
void CPU_SetRegs(uint8_t cpuid, const CPU_Regs *regs);


