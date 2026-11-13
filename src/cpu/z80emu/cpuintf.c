/* cpuintf.c
 * 
 * CPU Interface (mz80)
 *
 * Allows ZXEM to be used with different cpu cores
 *
 */

#include "zxem.h"
#include "z80emu.h"

#define MAX_CPU 10

Z80_STATE *zxcpu[MAX_CPU];
uint8_t num_cpus = -1;

// create CPU context and return a handle
uint8_t CPU_Create(void) {
	num_cpus++;
	if(num_cpus<MAX_CPU) {
		zxcpu[num_cpus]=(Z80_STATE*)malloc(sizeof(Z80_STATE));
		zxcpu[num_cpus]->memory = zxmem;
		zxcpu[num_cpus]->readbyte = readbyte;
		zxcpu[num_cpus]->readword = readword;
		zxcpu[num_cpus]->writeword = writeword;
		zxcpu[num_cpus]->writebyte = writebyte;
		zxcpu[num_cpus]->input = input;
		zxcpu[num_cpus]->output = output;
		return num_cpus;
	} 

	return 255;
}

// reset a CPU context
void CPU_Reset(uint8_t cpuid) {

	Z80Reset(zxcpu[cpuid]);
	zxcpu[cpuid]->im = Z80_INTERRUPT_MODE_0;
}


// Assign a block of memory as read/write
void CPU_MEMRW(int addr, int length) {

}

// Assign a block of memory as read only
void CPU_MEMR(int addr, int length) {

}

// Destroy a CPU context
void CPU_Destroy(uint8_t cpuid) {
	free(zxcpu[cpuid]);
	zxcpu[cpuid]=NULL;
}

// Emulatoe virtual CPU
int CPU_Emulate(uint8_t cpuid, int ticks) {
	return Z80Emulate(zxcpu[cpuid], ticks);
}

int oim;

// Call interrupt on a CPU
void CPU_Interrupt(uint8_t cpuid) {
	if(oim!=zxcpu[cpuid]->im) {
		oim = zxcpu[cpuid]->im;
		printf("New interrupt: MODE: %d ",zxcpu[cpuid]->im);
		switch(oim) {
			case Z80_INTERRUPT_MODE_0:
				printf("mode 0\n");
				break;
			case Z80_INTERRUPT_MODE_1:
				printf("mode 1\n");
				break;
			case Z80_INTERRUPT_MODE_2:
				printf("mode 2\n");
				break;
			default:
				printf("????\n");
		}
						
	}

	Z80Emulate(zxcpu[cpuid], Z80Interrupt(zxcpu[cpuid],0xff));

}

// Call an NMI on a CPU
void CPU_NMI(uint8_t cpuid) {
	// TODO
}


uint16_t CPU_GetReg(uint8_t cpuid, char *reg) {

	int creg=reg[0]+reg[1]*256;
//	printf("REG: %s %d\n",reg,creg);
	switch(creg) {
		case 66: // B
			return zxcpu[cpuid]->registers.byte[Z80_B];
			break;
		case 17232: // PC
			return zxcpu[cpuid]->pc;
			break;
		default:
			printf("Unimplemented reg return %s\n",reg);
			return 0;
	}
}

/* Note: z80emu keeps PC in a local while Z80Emulate() runs, so these only
   see the real PC between calls (the tape trap needs z80core) */
void CPU_GetRegs(uint8_t cpuid, CPU_Regs *regs) {
	Z80_STATE *state = zxcpu[cpuid];

	regs->af = state->registers.word[Z80_AF];
	regs->bc = state->registers.word[Z80_BC];
	regs->de = state->registers.word[Z80_DE];
	regs->hl = state->registers.word[Z80_HL];
	regs->af_ = state->alternates[Z80_AF];
	regs->bc_ = state->alternates[Z80_BC];
	regs->de_ = state->alternates[Z80_DE];
	regs->hl_ = state->alternates[Z80_HL];
	regs->ix = state->registers.word[Z80_IX];
	regs->iy = state->registers.word[Z80_IY];
	regs->sp = state->registers.word[Z80_SP];
	regs->pc = state->pc;
	regs->i = state->i;
	regs->r = state->r;
	regs->iff1 = state->iff1;
	regs->iff2 = state->iff2;
	regs->im = state->im;
}

void CPU_SetRegs(uint8_t cpuid, const CPU_Regs *regs) {
	Z80_STATE *state = zxcpu[cpuid];

	state->registers.word[Z80_AF] = regs->af;
	state->registers.word[Z80_BC] = regs->bc;
	state->registers.word[Z80_DE] = regs->de;
	state->registers.word[Z80_HL] = regs->hl;
	state->alternates[Z80_AF] = regs->af_;
	state->alternates[Z80_BC] = regs->bc_;
	state->alternates[Z80_DE] = regs->de_;
	state->alternates[Z80_HL] = regs->hl_;
	state->registers.word[Z80_IX] = regs->ix;
	state->registers.word[Z80_IY] = regs->iy;
	state->registers.word[Z80_SP] = regs->sp;
	state->pc = regs->pc;
	state->i = regs->i;
	state->r = regs->r;
	state->iff1 = regs->iff1;
	state->iff2 = regs->iff2;
	state->im = regs->im;
}
