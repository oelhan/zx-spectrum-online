#include "zxem.h"


// Keyboard routines
// Verbose for no reason.


uint8_t readbyte(uint16_t addr) {
	/* Opcode fetch of the ROM's LD-BYTES routine: load from the tape image
	   instead (z80core reads the opcode before it increments PC) */
	if(addr==TAPE_TRAP_ADDR && tape_loaded && CPU_GetReg(CPU_Handle,"PC")==addr) {
		return ZX_TapeTrap();
	}
    return zxmem[addr];
}

uint16_t readword(uint16_t addr) {
    return zxmem[addr] | zxmem[addr+1]<<8;
}

void writebyte(uint16_t addr, uint8_t data) {

	/* Don't allow writing to ROM */
	if(addr>0x3FFF) {
		//printf("Writing 0x%X to 0x%X\n",data,addr);
	    zxmem[addr]=data;
	}
	cached[addr]=1;
}


void writeword(uint16_t addr, uint16_t data) {
	/* Byte at a time so a word straddling 0x3FFF/0x4000 or 0xFFFF/0x0000
	   only writes the RAM half */
	writebyte(addr, data & 0xFF);
	writebyte(addr+1, data >> 8);
}

/* Last value written to port 0xFE, bit 4 is the EAR/speaker output */
uint8_t ula_out = 0;

uint8_t input(uint16_t port) {
	uint8_t data = 0xFF;
	uint8_t row;

	/* ULA: any even port. Each zero bit in the high byte selects a
	   keyboard half-row, and the selected rows are ANDed together */
	if(!(port & 0x01)) {
		for(row=0;row<8;row++) {
			if(!(port & (0x100<<row))) {
				data &= indata[0xFF & ~(1<<row)];
			}
		}
		/* Bits 5 and 7 always read 1. With no tape playing, bit 6
		   follows the EAR output like an issue 3 Spectrum */
		data |= 0xA0;
		if(!(ula_out & 0x10)) {
			data &= ~0x40;
		}
		return data;
	}

	/* AY: read back the selected register */
	if((port & AY_PORT_MASK) == AY_PORT_SELECT) {
		return AY_Read();
	}

	/* Kempston joystick: A5, A6 and A7 low (port 0x1F) */
	if(!(port & 0xE0)) {
		return kempston;
	}

	/* Nothing else is attached; floating bus reads come later */
	return 0xFF;
}

void output(uint16_t port, uint8_t data) {
	/* ULA: border colour in bits 0-2, MIC bit 3, EAR/speaker bit 4 */
	if(!(port & 0x01)) {
		border = data & 0x07;
		ZX_SoundOutput(data);
		ula_out = data;
	}

	/* AY: 0xFFFD selects a register, 0xBFFD writes it */
	if((port & AY_PORT_MASK) == AY_PORT_SELECT) {
		AY_Select(data);
	} else if((port & AY_PORT_MASK) == AY_PORT_DATA) {
		ZX_SoundAYWrite(data);
	}
}
// Setup keyboard array

void ZX_KeyInit(void) {

	// 0xFEFE
	keyaddr[ZX_KEY_SHIFT]=0xFE;
	keyaddr[ZX_KEY_Z]=0xFE;
	keyaddr[ZX_KEY_X]=0xFE;
	keyaddr[ZX_KEY_C]=0xFE;
	keyaddr[ZX_KEY_V]=0xFE;

	keybuf[ZX_KEY_SHIFT]=1;
	keybuf[ZX_KEY_Z]=2;
	keybuf[ZX_KEY_X]=4;
	keybuf[ZX_KEY_C]=8;
	keybuf[ZX_KEY_V]=16;

	// 0xFDFE
	keyaddr[ZX_KEY_A]=0xFD;
	keyaddr[ZX_KEY_S]=0xFD;
	keyaddr[ZX_KEY_D]=0xFD;
	keyaddr[ZX_KEY_F]=0xFD;
	keyaddr[ZX_KEY_G]=0xFD;

	keybuf[ZX_KEY_A]=1;
	keybuf[ZX_KEY_S]=2;
	keybuf[ZX_KEY_D]=4;
	keybuf[ZX_KEY_F]=8;
	keybuf[ZX_KEY_G]=16;

	// 0xFBFE
	keyaddr[ZX_KEY_Q]=0xFB;
	keyaddr[ZX_KEY_W]=0xFB;
	keyaddr[ZX_KEY_E]=0xFB;
	keyaddr[ZX_KEY_R]=0xFB;
	keyaddr[ZX_KEY_T]=0xFB;

	keybuf[ZX_KEY_Q]=1;
	keybuf[ZX_KEY_W]=2;
	keybuf[ZX_KEY_E]=4;
	keybuf[ZX_KEY_R]=8;
	keybuf[ZX_KEY_T]=16;

	// 0xF7FE
	keyaddr[ZX_KEY_1]=0xF7;
	keyaddr[ZX_KEY_2]=0xF7;
	keyaddr[ZX_KEY_3]=0xF7;
	keyaddr[ZX_KEY_4]=0xF7;
	keyaddr[ZX_KEY_5]=0xF7;

	keybuf[ZX_KEY_1]=1;
	keybuf[ZX_KEY_2]=2;
	keybuf[ZX_KEY_3]=4;
	keybuf[ZX_KEY_4]=8;
	keybuf[ZX_KEY_5]=16;

	// 0xEFFE
	keyaddr[ZX_KEY_0]=0xEF;
	keyaddr[ZX_KEY_9]=0xEF;
	keyaddr[ZX_KEY_8]=0xEF;
	keyaddr[ZX_KEY_7]=0xEF;
	keyaddr[ZX_KEY_6]=0xEF;

	keybuf[ZX_KEY_0]=1;
	keybuf[ZX_KEY_9]=2;
	keybuf[ZX_KEY_8]=4;
	keybuf[ZX_KEY_7]=8;
	keybuf[ZX_KEY_6]=16;

	// 0xDFFE
	keyaddr[ZX_KEY_P]=0xDF;
	keyaddr[ZX_KEY_O]=0xDF;
	keyaddr[ZX_KEY_I]=0xDF;
	keyaddr[ZX_KEY_U]=0xDF;
	keyaddr[ZX_KEY_Y]=0xDF;

	keybuf[ZX_KEY_P]=1;
	keybuf[ZX_KEY_O]=2;
	keybuf[ZX_KEY_I]=4;
	keybuf[ZX_KEY_U]=8;
	keybuf[ZX_KEY_Y]=16;

	// 0xBFFE
	keyaddr[ZX_KEY_ENTER]=0xBF;
	keyaddr[ZX_KEY_L]=0xBF;
	keyaddr[ZX_KEY_K]=0xBF;
	keyaddr[ZX_KEY_J]=0xBF;
	keyaddr[ZX_KEY_H]=0xBF;

	keybuf[ZX_KEY_ENTER]=1;
	keybuf[ZX_KEY_L]=2;
	keybuf[ZX_KEY_K]=4;
	keybuf[ZX_KEY_J]=8;
	keybuf[ZX_KEY_H]=16;

	// 0x7FFE
	keyaddr[ZX_KEY_SPACE]=0x7F;
	keyaddr[ZX_KEY_SYM]=0x7F;
	keyaddr[ZX_KEY_M]=0x7F;
	keyaddr[ZX_KEY_N]=0x7F;
	keyaddr[ZX_KEY_B]=0x7F;

	keybuf[ZX_KEY_SPACE]=1;
	keybuf[ZX_KEY_SYM]=2;
	keybuf[ZX_KEY_M]=4;
	keybuf[ZX_KEY_N]=8;
	keybuf[ZX_KEY_B]=16;

	memset(indata,255,sizeof(indata));
	kempston = 0;
}

/* Press or release a ZX_KEY_* key in the keyboard matrix */
void ZX_KeyDown(int key) {
	if(key>0 && key<ZX_KEY_LAST) {
		indata[keyaddr[key]]&=~keybuf[key];
	}
}

void ZX_KeyUp(int key) {
	if(key>0 && key<ZX_KEY_LAST) {
		indata[keyaddr[key]]|=keybuf[key];
	}
}

void ZX_Input(void) {
	OSD_Input();
}

