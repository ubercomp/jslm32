/**
 * LatticeMico32 emulation by interpretation.
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 10/09/11 17:21
 *
 * Specification available at:
 *   http://milkymist.org/socdoc/lm32_archman.pdf
 *
 * NOTES:
 *   Contrary to what the manual says, branch instructions are in the xyimm16 format
 */
"use strict";

// Conventions:
// * always use mask 0xffffffff when writing registers;
// * never use mask 0xffffffff when reading registers;
// * always use unsigned32 when writing to pc

lm32.lm32Cpu = function (params) {
    // dependencies
    var bits = lm32.bits;
    var cs = {}; // cpu state

    // performance counting:
    cs.mips_log_function = function(mips) {};
    cs.instr_count_start = (new Date()).getTime();
    cs.instr_count = 0;

    // current instruction
    cs.I_OPC   = 0;  // opcode
    cs.I_IMM5  = 0;  // immediate (5 bits)
    cs.I_IMM16 = 0;  // immediate (16 bits)
    cs.I_IMM26 = 0;  // immediate (26 bits)
    cs.I_CSR   = 0;  // control and status register
    cs.I_R0    = 0;  // R0
    cs.I_R1    = 0;  // R1
    cs.I_R2    = 0;  // R2
    
    function irq_handler(level) {
        //console.log('board cpu_irq_handler');
        switch(level) {
            case 0:
                cs.interrupt = false;
                break;
            case 1:
                cs.interrupt = true;
                break;
            default:
                throw ("Unknown interruption level: " + level);
                break;
        }
    }

    function reset(params) {
        cs.ram = params.ram;
        cs.ram_base = params.ram_base;
        cs.ram_size = params.ram_size;
        cs.ram_max  = cs.ram_base + cs.ram_size;
        cs.mmu = params.mmu;

        // general purpose registers
        cs.regs = new Array(32);
        for (var i = 0; i < 32; i++) {
            cs.regs[i] = 0;
        }

        // control and status registers
        // program counter: unsigned, two lower bits should always be 0
        cs.pc = params.bootstrap_pc;
        cs.next_pc = cs.pc + 4; // jumps write on next_pc

        cs.pic = lm32.lm32Pic(irq_handler);

        // interrupt enable
        cs.ie = {
            ie: 0,
            bie: 0,
            eie: 0
        };

        cs.ie_val = function() {
            var ie = cs.ie.ie ? 1 : 0;
            var bie = cs.ie.bie ? 1 : 0;
            var eie = cs.ie.eie ? 1 : 0;
            return (ie) | (eie << 1) | (bie << 2);
        };

        cs.ie_wrt = function(val) {
            val = val & 0x7; // only 3 bits;
            cs.ie.ie = (val & 0x1) ? 1 : 0;
            cs.ie.eie = (val & 0x2) ? 1 : 0;
            cs.ie.bie = (val & 0x4) ? 1 : 0;
        };

        // interrupt pending
        cs.interrupt = false;

        cs.cc = 0;        // cycle counter

        // configuration:
        // revision: 3
        // watchpoints: 4
        // breakpoints: 4
        // interruptions: 32
        // REV                  WP       BP          INT               J  R  H  G  IC DC CC  X  U  S  D  M
        // 31 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 09 08 07 06 05 04 03 02 01 00
        // 0  0  0  0  1  1  0  1  0  0  0  1  0  0  1  0  0  0  0  0  0  0  0  0  1  1  1  1  1  1  1  1
        //(0  0  0  0)(1  1  0  1)(0  0  0  1)(0  0  1  0)(0  0  0  0)(0  0  0  0)(0  0  1  1)(0  1  1  1)
        //     0           d           1           2            0          0            3          7
        cs.cfg = 0x0d120037;
        //cs.cfg = 0x0d1200f7; // Using QEMU's


        cs.eba = params.bootstrap_eba;       // exception base address

        // debug control and status registers
        cs.dc = {
            ss: 0,  // single step enabled (1 bit)
            re: 0,  // remap exceptions (1 bit) - if set, use DEBA for all exceptions
            c0: 0, // 2 bit value
            c1: 0, // 2 bit value
            c2: 0, // 2 bit value
            c3: 0 // 2 bit value
        };

        cs.dc_val = function() {
            var ss = cs.dc.ss?1:0;
            var re = cs.dc.re?1:0;
            var c0 = cs.dc.c0 & 0x3;
            var c1 = cs.dc.c1 & 0x3;
            var c2 = cs.dc.c2 & 0x3;
            var c3 = cs.dc.c3 & 0x3;
            return (ss)|(re<<1)|(c0<<2)|(c1<<4)|(c2<<6)|(c3<<8);
        };

        cs.dc_wrt = function(val) {
            val = val & 0x3ff; // 10 bits only
            cs.dc.ss = val & 0x1 ? 1: 0;
            cs.dc.re = val & 0x2 ? 1: 0;
            cs.dc.c0 = (val & (0x3 << 2)) >> 2;
            cs.dc.c1 = (val & (0x3 << 4)) >> 4;
            cs.dc.c2 = (val & (0x3 << 6)) >> 6;
            cs.dc.c3 = (val & (0x3 << 8)) >> 8;
        };

        cs.deba = params.bootstrap_deba;
        cs.jtx = 0;
        cs.jrx = 0;
        cs.bp0 = 0;
        cs.bp1 = 0;
        cs.bp2 = 0;
        cs.bp3 = 0;
        cs.wp0 = 0;
        cs.wp1 = 0;
        cs.wp2 = 0;
        cs.wp3 = 0;
    }

    // initialization
    reset(params);

    // exception ids
    var EXCEPT_RESET                 = 0;
    var EXCEPT_BREAKPOINT            = 1;
    var EXCEPT_INSTRUCTION_BUS_ERROR = 2;
    var EXCEPT_WATCHPOINT            = 3;
    var EXCEPT_DATA_BUS_ERROR        = 4;
    var EXCEPT_DIVIDE_BY_ZERO        = 5;
    var EXCEPT_INTERRUPT             = 6;
    var EXCEPT_SYSTEM_CALL           = 7;

    // general purpose register indices
    var REG_GP = 26;  // global pointer
    var REG_FP = 27;  // frame pointer
    var REG_SP = 28;  // stack pointer
    var REG_RA = 29;  // return address
    var REG_EA = 30;  // exception address
    var REG_BA = 31;  // breakpoint address

    // control and status register indices:
    var CSR_IE   = 0x0;  // interrupt enable
    var CSR_IM   = 0x1;  // interrupt mask
    var CSR_IP   = 0x2;  // interrupt pending
    var CSR_ICC  = 0x3;  // instruction cache control
    var CSR_DCC  = 0x4;  // data_cache_control
    var CSR_CC   = 0x5;  // cycle counter
    var CSR_CFG  = 0x6;  // configuration
    var CSR_EBA  = 0x7;  // exception base address
    var CSR_DC   = 0x8;  // debug control
    var CSR_DEBA = 0x9;  // debug esception base address
    var CSR_JTX  = 0xe;  // jtag uart transmit
    var CSR_JRX  = 0xf;  // jtag uart receive
    var CSR_BP0  = 0x10; // breakpoint address 0
    var CSR_BP1  = 0x11; // breakpoint address 1
    var CSR_BP2  = 0x12; // breakpoint address 2
    var CSR_BP3  = 0x13; // breakpoint address 3
    var CSR_WP0  = 0x18; // wacthpoint address 0
    var CSR_WP1  = 0x19; // watchpoint address 1
    var CSR_WP2  = 0x1a; // watchpoint address 2
    var CSR_WP3  = 0x1b; // watchpoint address 3
    
    // Helpers:

    // comparison helpers (I think google closure compiler will inline these)
    function fcond_eq(a, b) {
        return (a == b);
    }

    function fcond_g(a, b) {
        return (a > b);
    }

    function fcond_ge(a, b) {
        return (a >= b);
    }

    function fcond_geu(a, b) {
        return (bits.unsigned32(a) >= bits.unsigned32(b));
    }

    function fcond_gu(a, b) {
        return (bits.unsigned32(a) > bits.unsigned32(b));
    }

    function fcond_ne(a, b) {
        return (a != b);
    }

    // non-debug exception
    function raise_exception(cs, id) {
        switch(id) {
            case EXCEPT_DATA_BUS_ERROR:
            case EXCEPT_DIVIDE_BY_ZERO:
            case EXCEPT_INSTRUCTION_BUS_ERROR:
            case EXCEPT_INTERRUPT:
            case EXCEPT_SYSTEM_CALL:
                // non-debug
                cs.regs[REG_EA] = cs.pc | 0;
                cs.ie.eie = cs.ie.ie;
                cs.ie.ie = 0;
                var base = cs.dc.re ? cs.deba : cs.eba;
                // exceptions write to both pc and next_pc
                cs.pc = bits.unsigned32(base + id * 32);
                cs.next_pc = cs.pc
                break;

            case EXCEPT_BREAKPOINT:
            case EXCEPT_WATCHPOINT:
                // debug
                cs.regs[REG_BA] = cs.pc | 0;
                cs.ie.bie = cs.ie.ie;
                cs.ie.ie = 0;
                // exceptions write to both pc and next_pc
                cs.pc = bits.unsigned32(cs.deba + id * 32);
                cs.next_pc = cs.pc;
                break;
            default:
                throw ("Unhandled exception with id " + id);
                break;
        }
    }

    // instruction implementations:

    // arithmetic and comparison instructions
    function add(cs) {
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] + cs.regs[cs.I_R1]) | 0;
    }

    function addi(cs) {
        cs.regs[cs.I_R1] = (cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16)) | 0;
    }

    function and(cs) {
        // logical ops don't need to and with mask00_31
        cs.regs[cs.I_R2] = cs.regs[cs.I_R0] & cs.regs[cs.I_R1];
    }

    function andhi(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] & (cs.I_IMM16 << 16);
    }

    function andi(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] & bits.zero_extend(cs.I_IMM16, 16);
    }

    /**
     * @param reg_p is it a register to register compare?
     * @param fcond function to compare two values;
     */
    function compare(cs, reg_p, fcond) {
        var rx = reg_p ? cs.I_R2 : cs.I_R1;
        var ry = reg_p ? cs.I_R0 : cs.I_R0;
        var rz = reg_p ? cs.I_R1 : -1;

        var a = cs.regs[ry];
        var b = reg_p ? cs.regs[rz] : bits.sign_extend(cs.I_IMM16, 16);

        if(fcond(a, b)) {
            cs.regs[rx] = 1;
        } else {
            cs.regs[rx] = 0;
        }
    }

    function cmpe(cs) {
        compare(cs, true, fcond_eq);
    }

    function cmpei(cs) {
        compare(cs, false, fcond_eq);
    }

    function cmpg(cs) {
        compare(cs, true, fcond_g);
    }

    function cmpgi(cs) {
        compare(cs, false, fcond_g);
    }

    function cmpge(cs) {
        compare(cs, true, fcond_ge);
    }

    function cmpgei(cs) {
        compare(cs, false, fcond_ge);
    }

    function cmpgeu(cs) {
        compare(cs, true, fcond_geu);
    }

    function cmpgeui(cs) {
        compare(cs, false, fcond_geu)
    }

    function cmpgu(cs) {
        compare(cs, true, fcond_gu);
    }

    function cmpgui(cs) {
        compare(cs, false, fcond_gu);
    }

    function cmpne(cs) {
        compare(cs, true, fcond_ne);
    }

    function cmpnei(cs) {
        compare(cs, false, fcond_ne);
    }

    function div(cs) {
        var vr0 = cs.regs[cs.I_R0];
        var vr1 = cs.regs[cs.I_R1];
        if(vr1 === 0) {
            raise_exception(cs, EXCEPT_DIVIDE_BY_ZERO);
        } else {
            cs.regs[cs.I_R2] = (Math.floor(vr0/vr1)) | 0;
        }
    }

    function divu(cs) {
        var vr0 = cs.regs[cs.I_R0];
        var vr1 = cs.regs[cs.I_R1];
        var u = bits.unsigned32;

        if (vr1 === 0) {
            raise_exception(cs, EXCEPT_DIVIDE_BY_ZERO);
        } else {
            cs.regs[cs.I_R2] = (Math.floor(u(vr0) / u(vr1))) | 0;
        }
    }

    function mod(cs) {
        var vr0 = cs.regs[cs.I_R0];
        var vr1 = cs.regs[cs.I_R1];
        if (vr1 === 0) {
            raise_exception(cs, EXCEPT_DIVIDE_BY_ZERO);
        } else {
            cs.regs[cs.I_R2] = (vr0 % vr1) | 0;
        }
    }

    function modu(cs) {
        var vr0 = cs.regs[cs.I_R0];
        var vr1 = cs.regs[cs.I_R1];
        var u = bits.unsigned32;
        if (vr1 === 0) {
            raise_exception(cs, EXCEPT_DIVIDE_BY_ZERO);
        } else {
            cs.regs[cs.I_R2] = (u(vr0) % u(vr1)) | 0;
        }
    }

    function mul(cs) {
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] * cs.regs[cs.I_R1]) | 0;
    }

    function muli(cs) {
        cs.regs[cs.I_R1] = (cs.regs[cs.I_R0] * bits.sign_extend(cs.I_IMM16, 16)) | 0;
    }

    function nor(cs) {
        cs.regs[cs.I_R2] = ~(cs.regs[cs.I_R0] | cs.regs[cs.I_R1]);
    }

    function nori(cs) {
        cs.regs[cs.I_R1] = ~(cs.regs[cs.I_R0] | bits.zero_extend(cs.I_IMM16, 16));
    }

    function or(cs) {
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] | cs.regs[cs.I_R1]);
    }

    function ori(cs) {
        cs.regs[cs.I_R1] = (cs.regs[cs.I_R0] | bits.zero_extend(cs.I_IMM16, 16));
    }

    function orhi(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] | (cs.I_IMM16 << 16);
    }

    function sextb(cs) {
        // sign extend byte to word
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] << 24) >> 24;
    }

    function sexth(cs) {
        // sign extend half-word to word
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] << 16) >> 16;
    }

    function sl(cs) {
        cs.regs[cs.I_R2] = cs.regs[cs.I_R0] << (cs.regs[cs.I_R1] & 0x1f);
    }

    function sli(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] << cs.I_IMM5;
    }

    function sr(cs) {
        cs.regs[cs.I_R2] = cs.regs[cs.I_R0] >> (cs.regs[cs.I_R1] & 0x1f);
    }

    function sri(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] >> cs.I_IMM5;
    }

    function sru(cs) {
        cs.regs[cs.I_R2] = cs.regs[cs.I_R0] >>> (cs.regs[cs.I_R1] & 0x1f);
    }

    function srui(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] >>> cs.I_IMM5;
    }

    function sub(cs) {
        cs.regs[cs.I_R2] = (cs.regs[cs.I_R0] - cs.regs[cs.I_R1]) | 0;
    }

    function xnor(cs) {
        cs.regs[cs.I_R2] = ~(cs.regs[cs.I_R0] ^ cs.regs[cs.I_R1]);
    }

    function xnori(cs) {
        cs.regs[cs.I_R1] = ~(cs.regs[cs.I_R0] ^ bits.zero_extend(cs.I_IMM16, 16));
    }

    function xor(cs) {
        cs.regs[cs.I_R2] = cs.regs[cs.I_R0] ^ cs.regs[cs.I_R1];
    }

    function xori(cs) {
        cs.regs[cs.I_R1] = cs.regs[cs.I_R0] ^ bits.zero_extend(cs.I_IMM16, 16);
    }

    // branch and call implementations
    function b(cs) {
        var r0 = cs.I_R0;

        if(r0 == REG_EA) {
            // eret -> restore eie
            cs.ie.ie = cs.ie.eie;
        } else if(r0 == REG_BA) {
            // bret -> restore bie
            cs.ie.ie = cs.ie.bie;
        }

        cs.next_pc = bits.unsigned32(cs.regs[r0]);
    }

    function bi(cs) {
        var imm26 = cs.I_IMM26;
        cs.next_pc = bits.unsigned32(cs.pc + bits.sign_extend(imm26 << 2, 28));
    }

    function branch_conditional(cs, fcond) {
        var a = cs.regs[cs.I_R0];
        var b = cs.regs[cs.I_R1];
        if(fcond(a, b)) {
            cs.next_pc = bits.unsigned32(cs.pc + bits.sign_extend(cs.I_IMM16 << 2, 18));
        }
    }

    function be(cs) {
        branch_conditional(cs, fcond_eq);
    }

    function bg(cs) {
        branch_conditional(cs, fcond_g);
    }

    function bge(cs) {
        branch_conditional(cs, fcond_ge);
    }

    function bgeu(cs) {
        branch_conditional(cs, fcond_geu);
    }

    function bgu(cs) {
        branch_conditional(cs, fcond_gu);
    }

    function bne(cs) {
        branch_conditional(cs, fcond_ne);
    }

    function call_(cs) {
        cs.regs[REG_RA] = (cs.pc + 4) | 0;
        cs.next_pc = bits.unsigned32(cs.regs[cs.I_R0]);
    }

    function calli(cs) {
        var imm26 = cs.I_IMM26;
        cs.regs[REG_RA] = (cs.pc + 4) | 0;
        cs.next_pc = bits.unsigned32(cs.pc + bits.sign_extend(imm26 << 2, 28));
    }

    function scall(cs) {
        var imm5 = cs.I_IMM5;
        if(imm5 == 7) {
            raise_exception(cs, EXCEPT_SYSTEM_CALL);
        } else if(imm5 == 2) {
            raise_exception(cs, EXCEPT_BREAKPOINT);
        } else {
            throw "Invalid opcode";
        }
    }

    // load and store instructions
    // helper functions
    function sign_extend_8(val) {
        return bits.sign_extend(val, 8);
    }

    function sign_extend_16(val) {
        return bits.sign_extend(val, 16);
    }

    function zero_extend_8(val) {
        return bits.zero_extend(val, 8);
    }

    function zero_extend_16(val) {
        return bits.zero_extend(val, 16);
    }

    function to_32_bits(val) {
        return val | 0;
    }

    /**
     *
     * @param width the width to read (8, 16 or 32)
     * @param func the function to apply before assigning the result to a register
     */
    function load(cs, uaddr, width, func) {
        var ok = false;
        var val = undefined;
        switch(width) {
            case 8:
                val = cs.mmu.read_8(uaddr);
                break;
            case 16:
                val = cs.mmu.read_16(uaddr);
                break;
            case 32:
                val = cs.mmu.read_32(uaddr);
                break;
            default:
                throw ("invalid width - should never happen");
                break;
        }

        if(val !== undefined) {
            ok = true;
            cs.regs[cs.I_R1] = func(val);
        }

        if(!ok) {
            //console.log("Error reading at address " + bits.format(uaddr) + " with width " + width);
            raise_exception(cs, EXCEPT_DATA_BUS_ERROR);
        }
    }

    function lb(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.regs[cs.I_R1] = lm32.bits.sign_extend(cs.ram.read_8(uaddr - cs.ram_base), 8);
        } else {
            load(cs, uaddr, 8, sign_extend_8);
        }
    }

    function lbu(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.regs[cs.I_R1] = lm32.bits.zero_extend(cs.ram.read_8(uaddr - cs.ram_base), 8);
        } else {
            load(cs, uaddr, 8, zero_extend_8);
        }
    }

    function lh(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.regs[cs.I_R1] = lm32.bits.sign_extend(cs.ram.read_16(uaddr - cs.ram_base), 16);
        } else {
            load(cs, uaddr, 16, sign_extend_16);
        }
    }

    function lhu(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.regs[cs.I_R1] = lm32.bits.zero_extend(cs.ram.read_16(uaddr - cs.ram_base), 16);
        } else {
            load(cs, uaddr, 16, zero_extend_16);
        }
    }

    function lw(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.regs[cs.I_R1] = cs.ram.read_32(uaddr - cs.ram_base);
        } else {
            load(cs, uaddr, 32, to_32_bits);
        }
    }

    function store(cs, uaddr, width) {
        var ok;
        switch(width) {
            case 8:
                ok = cs.mmu.write_8(uaddr, cs.regs[cs.I_R1]);
                break;
            case 16:
                ok = cs.mmu.write_16(uaddr, cs.regs[cs.I_R1]);
                break;
            case 32:
                ok = cs.mmu.write_32(uaddr, cs.regs[cs.I_R1]);
                break;
            default:
                //console.log("Error writing to address " + bits.format(uaddr) + " with width " + width);
                break;
        }
        if(!ok) {
            raise_exception(cs, EXCEPT_DATA_BUS_ERROR);
        }
    }

    function sb(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.ram.v8[uaddr - cs.ram_base] = cs.regs[cs.I_R1] & 0xff;
            //cs.ram.write_8(uaddr - cs.ram_base, cs.regs[cs.I_R1] & 0xff);
        } else {
            store(cs, uaddr, 8);
        }
    }

    function sh(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.ram.write_16(uaddr - cs.ram_base, cs.regs[cs.I_R1] & 0xffff);
        } else {
            store(cs, uaddr, 16);
        }
    }

    function sw(cs) {
        var uaddr = bits.unsigned32(cs.regs[cs.I_R0] + bits.sign_extend(cs.I_IMM16, 16));
        if((uaddr >= cs.ram_base) && (uaddr < cs.ram_max)) {
            cs.ram.write_32(uaddr - cs.ram_base, cs.regs[cs.I_R1] | 0);
        } else {
            store(cs, uaddr, 32);
        }
    }


    // csr instructions
    function rcsr(cs) {
        var csr = cs.I_CSR;
        var r2 = cs.I_R2;
        var val;
        var read = true;
        switch (csr) {
            // These cannot be read from:
            case CSR_ICC:
            case CSR_DCC:
            case CSR_BP0:
            case CSR_BP1:
            case CSR_BP2:
            case CSR_BP3:
            case CSR_WP0:
            case CSR_WP1:
            case CSR_WP2:
            case CSR_WP3:
                read = false;
                //console.log("Invalid read on csr 0x" + csr.toString(16));
                break;

            case CSR_DC:
                val = cs.dc_val();
                break;

            case CSR_IE:
                val = cs.ie_val();
                break;
            case CSR_IM:
                val = cs.pic.get_im();
                break;
            case CSR_IP:
                val = cs.pic.get_ip();
                break;
            case CSR_CC:
                val = cs.cc;
                break;
            case CSR_CFG:
                val = cs.cfg;
                break;
            case CSR_EBA:
                val = cs.eba;
                break;

            case CSR_DEBA:
                val = cs.deba;
                break;

            case CSR_JTX:
                val = cs.jtx;
                break;
            case CSR_JRX:
                val = cs.jrx;
                break;

            default:
                read = false;
                throw ("No such CSR register: " + csr);
                break;
        }
        if(read) {
            cs.regs[r2] = (val) | 0;
        } else {
            //console.log("Reading from invalid CSR: 0x" + csr.toString(16));
        }
    }

    function wcsr(cs) {
        var csr = cs.I_CSR;
        var rx = cs.I_R1;
        var val = cs.regs[rx];
        switch(csr) {
            // these cannot be written to:
            case CSR_CC:
            case CSR_CFG:
                //console.log("Cannot write to csr number " + csr);
                break;

            case CSR_IP:
                cs.pic.set_ip(val);
                break;

            case CSR_IE:
                cs.ie_wrt(val);
                break;
            case CSR_IM:
                cs.pic.set_im(val);
                break;
            case CSR_ICC:
            case CSR_DCC:
                break; // i just fake icc
            case CSR_EBA:
                cs.eba = val & 0xffffff00;
                break;
            case CSR_DC:
                cs.dc_wrt(val);
                break;

            case CSR_DEBA:
                cs.deba = val & 0xffffff00;
                break;

            case CSR_JTX:
                //console.log("Writing CSR_JTX at PC: 0x" + bits.unsigned32(cs.pc).toString(16));
                cs.jtx = val;
                break;

            case CSR_JRX:
                //console.log("Writing CSR_JRX at PC: 0x" + bits.unsigned32(cs.pc).toString(16));
                cs.jrx = val;
                break;

            case CSR_BP0:
                cs.bp0 = val; break;
            case CSR_BP1:
                cs.bp1 = val; break;
            case CSR_BP2:
                cs.bp3 = val; break;
            case CSR_BP3:
                cs.bp3 = val; break;

            case CSR_WP0:
                cs.wp0 = val; break;
            case CSR_WP1:
                cs.wp1 = val; break;
            case CSR_WP2:
                cs.wp2 = val; break;
            case CSR_WP3:
                cs.wp3 = val; break;
        }
    }

    // reserved instruction
    function reserved() {
        //console.log("Someone called the reserved instruction. Not cool!");
        throw "This should never be  called";
    }


    var optable = [
        /* OPCODE      OP */
        /* 0x00 */     srui,
        /* 0x01 */     nori,
        /* 0x02 */     muli,
        /* 0x03 */       sh,
        /* 0x04 */       lb,
        /* 0x05 */      sri,
        /* 0x06 */     xori,
        /* 0x07 */       lh,
        /* 0x08 */     andi,
        /* 0x09 */    xnori,
        /* 0x0a */       lw,
        /* 0x0b */      lhu,
        /* 0x0c */       sb,
        /* 0x0d */     addi,
        /* 0x0e */      ori,
        /* 0x0f */      sli,

        /* 0x10 */      lbu,
        /* 0x11 */       be,
        /* 0x12 */       bg,
        /* 0x13 */      bge,
        /* 0x14 */     bgeu,
        /* 0x15 */      bgu,
        /* 0x16 */       sw,
        /* 0x17 */      bne,
        /* 0x18 */    andhi,
        /* 0x19 */    cmpei,
        /* 0x1a */    cmpgi,
        /* 0x1b */   cmpgei,
        /* 0x1c */  cmpgeui,
        /* 0x1d */   cmpgui,
        /* 0x1e */     orhi,
        /* 0x1f */   cmpnei,

        /* 0x20 */      sru,
        /* 0x21 */      nor,
        /* 0x22 */      mul,
        /* 0x23 */     divu,
        /* 0x24 */     rcsr,
        /* 0x25 */       sr,
        /* 0x26 */      xor,
        /* 0x27 */      div,
        /* 0x28 */      and,
        /* 0x29 */     xnor,
        /* 0x2a */ reserved,
        /* 0x2b */    scall,
        /* 0x2c */    sextb,
        /* 0x2d */      add,
        /* 0x2e */       or,
        /* 0x2f */       sl,

        /* 0x30 */        b,
        /* 0x31 */     modu,
        /* 0x32 */      sub,
        /* 0x33 */ reserved,
        /* 0x34 */     wcsr,
        /* 0x35 */      mod,
        /* 0x36 */     call_,
        /* 0x37 */    sexth,
        /* 0x38 */       bi,
        /* 0x39 */     cmpe,
        /* 0x3a */     cmpg,
        /* 0x3b */    cmpge,
        /* 0x3c */   cmpgeu,
        /* 0x3d */    cmpgu,
        /* 0x3e */    calli,
        /* 0x3f */    cmpne
    ];

    var opnames = [
        "srui",
        "nori",
        "muli",
        "sh",
        "lb",
        "sri",
        "xori",
        "lh",
        "andi",
        "xnori",
        "lw",
        "lhu",
        "sb",
        "addi",
        "ori",
        "sli",

        "lbu",
        "be",
        "bg",
        "bge",
        "bgeu",
        "bgu",
        "sw",
        "bne",
        "andhi",
        "cmpei",
        "cmpgi",
        "cmpgei",
        "cmpgeui",
        "cmpgui",
        "orhi",
        "cmpnei",

        "sru",
        "nor",
        "mul",
        "divu",
        "rcsr",
        "sr",
        "xor",
        "div",
        "and",
        "xnor",
        "reserved",
        "raise",
        "sextb",
        "add",
        "or",
        "sl",

        "branch",
        "modu",
        "sub",
        "reserved",
        "wcsr",
        "mod",
        "call",
        "sexth",
        "bi",
        "cmpe",
        "cmpg",
        "cmpge",
        "cmpgeu",
        "cmpgu",
        "calli",
        "cmpne"
    ];

    var tick = function(ticks) {
        var len = cs.timers.length;
        for(var i = 0; i < len; i++) {
            (cs.timers[i])(ticks);
        }
    };

    var decode_instr = function (ics, op) {
            ics.I_OPC   = (op & 0xfc000000) >>> 26;
            ics.I_IMM5  = op & 0x1f;
            ics.I_IMM16 = op & 0xffff;
            ics.I_IMM26 = op & 0x3ffffff;
            ics.I_CSR   = (op & 0x03e00000) >> 21;
            ics.I_R0    = ics.I_CSR;
            ics.I_R1    = (op & 0x001f0000) >> 16;
            ics.I_R2    = (op & 0x0000f800) >> 11;
    
    };

    var step = function(instructions) {
        var i = 0;
        var ics = cs; // internal cs -> speeds things up
        var inc;
        var op, pc, opcode;
        var rpc; // ram-based pc
        var max_ticks = 1000; // max_ticks without informing timer
        var ticks = 0; // ticks to inform
        var tick_f; // function to be called for ticks
        if(ics.orig_timers.length == 1) {
            // optimize when there's only one timer
            tick_f = ics.orig_timers[0].on_tick;
        } else {
            tick_f = tick;
        }
        var ram_base = ics.ram_base;
        var v8 = ics.ram.v8;
        var immu = ics.mmu;

        do {
            if(ics.interrupt && (ics.ie.ie == 1) && ((ics.pic.get_ip() & ics.pic.get_im()) != 0)) {
                // here is the correct place to treat exceptions
                ics.interrupt = false;
                raise_exception(ics, 6);
            }

            pc = ics.pc;
            ics.next_pc = pc + 4; //bits.unsigned32(pc + 4);

            // Instruction fetching:
            // supports only code from ram (faster)
            rpc = pc - ram_base;
            op = (v8[rpc] << 24) | (v8[rpc + 1] << 16) | (v8[rpc + 2] << 8) | (v8[rpc + 3]);

            // supports code outside ram
            // op = immu.read_32(pc);

            // Instruction decoding:
            decode_instr(ics, op);

            // Instruction execution:
            opcode = ics.I_OPC;
            (optable[opcode])(ics);

            inc = 1;
            ticks += inc;
            if(ticks >= max_ticks) {
                tick_f(max_ticks)
                ticks -= max_ticks;
            }
            ics.cc = (ics.cc + inc) | 0;
            ics.pc = ics.next_pc;
        } while(++i < instructions);
        ics.instr_count += i;
        if(ics.instr_count >= 1000000) {
            var time = (new Date()).getTime();
            var delta = time - ics.instr_count_start;
            ics.instr_count_start = time;
            ics.instr_count = 0;
            ics.mips_log_function(1000.0/delta);
        }
        tick_f(ticks);
    };

    var step_forever = function() {
        step(50000);
        setTimeout(step_forever, 0);
    };

    var set_timers = function(timers) {
        var len = timers.length
        cs.timers = new Array(len);
        cs.orig_timers = timers;
        for(var i = 0; i < len; i++) {
            var cur = timers[i];
            (cs.timers)[i] = cur.on_tick;
        }
    };

    var dump_ie = function() {
        var fmt = lm32.bits.format;
        console.log('ie=' + fmt(cs.ie_val()) + '(IE=' + cs.ie.ie + ' EIE=' + cs.ie.eie + ' BIE=' + cs.ie.bie + ')');
    };

    var dump = function() {
        var i;
        var fmt = lm32.bits.format;
        console.log("DUMP:");
        console.log('');
        console.log('IN: PC=' + fmt(cs.pc));
        console.log('ie=' + fmt(cs.ie_val()) + '(IE=' + cs.ie.ie + ' EIE=' + cs.ie.eie + ' BIE=' + cs.ie.bie + ')');
        console.log('im='+ fmt(cs.pic.get_im()) + ' ip=' + fmt(cs.pic.get_ip()));
        console.log('eba=' + fmt(cs.eba) + ' deba=' + fmt(cs.deba));

        for(i = 0; i < 32; i++) {
            if(cs.regs[i] != 0) {
                console.log("r" + i + " = " + lm32.bits.format(cs.regs[i]));
            }
        };
    };

    return {
        cs: cs,
        reset: reset,
        step_forever: step_forever,
        step: step,
        dump_ie: dump_ie,
        dump: dump,
        set_timers: set_timers
    }
};
