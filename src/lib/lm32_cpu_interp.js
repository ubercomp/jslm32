/**
 *
 * LatticeMico32 CPU emulation: interpreter
 *
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 * Specification available at http://www.latticesemi.com/
 *
 *
 * This Javascript code is free software; you can redistribute it
 * and/or modify it under the terms of the GNU Lesser General Public
 * License, version 2.1, as published by the Free Software Foundation.
 *
 * This code is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this code; if not, see
 * <http://www.gnu.org/licenses/lgpl-2.1.html>
 */
"use strict";

// Conventions:
// (x >>> 0) is used to convert value to unsigned value.
// sign_extend(n, size) -> n << (32 - size) >> (32-size)
// e.g.
// sign_extend(128, 8) -> 128 << 24 >> 24 -> -128


lm32.cpu_interp = function(params) {
    // dependencies
    var cs = {}; // cpu state

    function reset(params) {
        cs.ram = params.ram;
        cs.ram_base = params.ram_base;
        cs.ram_size = params.ram_size;
        cs.ram_max  = cs.ram_base + cs.ram_size;
        cs.bus = params.bus;

        // general purpose registers
        cs.regs = new Int32Array(32);
        for (var i = 0; i < 32; i++) {
            cs.regs[i] = 0;
        }

        // control and status registers
        // program counter: unsigned, two lower bits should always be 0
        cs.pc = params.bootstrap_pc;
        cs.next_pc = cs.pc + 4; // jumps write on next_pc
        cs.pic = lm32.pic();

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

        cs.cc = 0;        // cycle counter

        // configuration:
        // revision: 3
        // watchpoints: 4
        // breakpoints: 4
        // interrupts: 32
        // REV                  WP       BP          INT               J  R  H  G  IC DC CC  X  U  S  D  M
        // 31 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 09 08 07 06 05 04 03 02 01 00
        // 0  0  0  0  1  1  0  1  0  0  0  1  0  0  1  0  0  0  0  0  0  0  0  0  1  1  1  1  1  1  1  1
        //(0  0  0  0)(1  1  0  1)(0  0  0  1)(0  0  1  0)(0  0  0  0)(0  0  0  0)(0  0  1  1)(0  1  1  1)
        //     0           d           1           2            0          0            3          7
        cs.cfg = 0x0d120037;

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
                cs.pc = (base + id * 32) >>> 0;
                cs.next_pc = cs.pc;
                break;

            case EXCEPT_BREAKPOINT:
            case EXCEPT_WATCHPOINT:
                // debug
                cs.regs[REG_BA] = cs.pc | 0;
                cs.ie.bie = cs.ie.ie;
                cs.ie.ie = 0;
                // exceptions write to both pc and next_pc
                cs.pc = (cs.deba + id * 32) >>> 0;
                cs.next_pc = cs.pc;
                break;
            default:
                // console.log("Unhandled exception with id " + id);
                break;
        }
    }

    // csr instructions
    function rcsr(cs, I_R0, I_R2) {
        var val;
        var read = true;
        switch (I_R0) {
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
                // console.log("No such CSR register: " + csr);
                break;
        }
        if (read) {
            cs.regs[I_R2] = (val) | 0;
        }
    }

    function wcsr(cs, I_R0, I_R1) {
        var val = cs.regs[I_R1];
        switch(I_R0) {
            // these cannot be written to:
            case CSR_CC:
            case CSR_CFG:
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
                cs.jtx = val;
                break;

            case CSR_JRX:
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

    function tick(ticks) {
        var len = cs.timers.length;
        for (var i = 0; i < len; i++) {
            (cs.timers[i])(ticks);
        }
    }

    function step(instructions) {
        var i = 0;
        var ics = cs; // internal cs -> speeds things up
        var ram = ics.ram;

        var ps = ics.pic.state; // pic state
        var inc;
        var op, pc;
        var rpc; // ram-based pc
        var max_ticks = 1000; // max_ticks without informing timer
        var ticks = 0; // ticks to inform
        var tick_f; // function to be called for ticks

        var I_OPC, I_IMM5, I_IMM16, I_IMM26, I_R0, I_R1, I_R2;
        if (ics.orig_timers.length == 1) {
            // optimize when there's only one timer
            tick_f = ics.orig_timers[0].on_tick;
        } else {
            tick_f = tick;
        }
        var ram_base = ics.ram_base;
        var v8 = ics.ram.v8;
        var v32 = ics.ram.v32;

        // TODO make temporaries
        var uaddr; // addresses for load and stores
        var vr0, vr1; // temporaries for division instructions
        var val; // value read on memory instructions


        do {
            if ((ps.ip & ps.im) && ics.ie.ie == 1) {
                // here is the correct place to treat exceptions
                raise_exception(ics, 6);
            }

            pc = ics.pc;
            ics.next_pc = (pc + 4) >>> 0;

            // Instruction and decoding:

            // Code not in RAM is not supported.
            // Use litte endian read to make instruction decoding more efficient
            rpc = pc - ram_base;

            op = v32[rpc >>> 2];
            I_OPC = (op & 0x000000fc) >> 2;
            I_R0 = ((op & 0x00000003) << 3)| ((op & 0x0000e000) >> 13);
            I_R1 = (op & 0x00001f00) >> 8;
            I_R2 = (op & 0x00f80000) >> 19;

            // Instruction execution:
            switch(I_OPC) {
            case 0x00: // srui
                I_IMM5 = (op & 0x1f000000) >> 24;
                ics.regs[I_R1] = ics.regs[I_R0] >>> I_IMM5;
                break;
            case 0x01: // nori
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ~(ics.regs[I_R0] | I_IMM16);
                break;
            case 0x02: // muli
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = (ics.regs[I_R0] * (I_IMM16 << 16 >> 16)) | 0;
                break;
            case 0x03: // sh
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ram.write_16(uaddr - ics.ram_base, ics.regs[I_R1] & 0xffff);
                } else {
                    ics.bus.write_16(uaddr, ics.regs[I_R1]);
                }
                break;
            case 0x04: // lb
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ics.regs[I_R1] = (ram.read_8(uaddr - ics.ram_base) << 24 >> 24);
                } else {
                    val = ics.bus.read_8(uaddr);
                    if(val != undefined) {
                        ics.regs[I_R1] = (val << 24) >> 24;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x05: // sri
                I_IMM5 = (op & 0x1f000000) >> 24;
                ics.regs[I_R1] = ics.regs[I_R0] >> I_IMM5;
                break;
            case 0x06: // xori
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ics.regs[I_R0] ^ I_IMM16;
                break;
            case 0x07: // lh
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ics.regs[I_R1] = (ram.read_16(uaddr - ics.ram_base) << 16 >> 16);
                } else {
                    val = ics.bus.read_16(uaddr);
                    if(val != undefined) {
                        ics.regs[I_R1] = (val << 16) >> 16;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x08: // andi
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ics.regs[I_R0] & I_IMM16;
                break;
            case 0x09: // xnori
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ~(ics.regs[I_R0] ^ I_IMM16);
                break;
            case 0x0a: // lw
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ics.regs[I_R1] = ram.read_32(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_32(uaddr);
                    if(val != undefined) {
                        ics.regs[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }

                }
                break;
            case 0x0b: // lhu
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ics.regs[I_R1] = ram.read_16(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_16(uaddr);
                    if(val != undefined) {
                        ics.regs[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x0c: // sb
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ram.v8[uaddr - ics.ram_base] = ics.regs[I_R1] & 0xff;
                } else {
                    ics.bus.write_8(uaddr, ics.regs[I_R1]);
                }
                break;
            case 0x0d: // addi
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) | 0;
                break;
            case 0x0e: // ori
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = (ics.regs[I_R0] | I_IMM16);
                break;
            case 0x0f: // sli
                I_IMM5 = (op & 0x1f000000) >> 24;
                ics.regs[I_R1] = ics.regs[I_R0] << I_IMM5;
                break;
            case 0x10: // lbu
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ics.regs[I_R1] = ram.read_8(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_8(uaddr);
                    if(val != undefined) {
                        ics.regs[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x11: // be
                if (ics.regs[I_R0] == ics.regs[I_R1]) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                  ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x12: // bg
                if (ics.regs[I_R0] > ics.regs[I_R1]) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x13: // bge
                if (ics.regs[I_R0] >= ics.regs[I_R1]) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x14: // bgeu
                if ((ics.regs[I_R0] >>> 0) >= (ics.regs[I_R1] >>> 0)) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x15: // bgu
                if ((ics.regs[I_R0] >>> 0) > (ics.regs[I_R1] >>> 0)) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x16: // sw
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                uaddr = (ics.regs[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ram.write_32(uaddr - ics.ram_base, ics.regs[I_R1] | 0);
                } else {
                    ics.bus.write_32(uaddr, ics.regs[I_R1]);
                }
                break;
            case 0x17: // bne
                if (ics.regs[I_R0] != ics.regs[I_R1]) {
                    I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x18: // andhi
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ics.regs[I_R0] & (I_IMM16 << 16);
                break;
            case 0x19: // cmpei
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                if (ics.regs[I_R0] == ((I_IMM16 << 16) >> 16)) {
                    ics.regs[I_R1] = 1;
                } else {
                    ics.regs[I_R1] = 0;
                }
                break;
            case 0x1a: // cmpgi
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                if (ics.regs[I_R0] > ((I_IMM16 << 16) >> 16)) {
                    ics.regs[I_R1] = 1;
                } else {
                    ics.regs[I_R1] = 0;
                }
                break;
            case 0x1b: // cmpgei
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                if (ics.regs[I_R0] >= ((I_IMM16 << 16) >> 16)) {
                    ics.regs[I_R1] = 1;
                } else {
                    ics.regs[I_R1] = 0;
                }
                break;
            case 0x1c: // cmpgeui
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                if ((ics.regs[I_R0] >>> 0) >= I_IMM16) {
                    ics.regs[I_R1] = 1;
                } else {
                    ics.regs[I_R1] = 0;
                }
                break;
            case 0x1d: // cmpgui
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ((ics.regs[I_R0] >>> 0) > I_IMM16) | 0;

                break;
            case 0x1e: // orhi
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                ics.regs[I_R1] = ics.regs[I_R0] | (I_IMM16 << 16);
                break;
            case 0x1f: // cmpnei
                I_IMM16 = ((op & 0xff000000) >>> 24) | ((op & 0x00ff0000) >> 8);
                if (ics.regs[I_R0] != ((I_IMM16 << 16) >> 16)) {
                    ics.regs[I_R1] = 1;
                } else {
                    ics.regs[I_R1] = 0;
                }
                break;
            case 0x20: // sru
                ics.regs[I_R2] = ics.regs[I_R0] >>> (ics.regs[I_R1] & 0x1f);
                break;
            case 0x21: // nor
                ics.regs[I_R2] = ~(ics.regs[I_R0] | ics.regs[I_R1]);
                break;
            case 0x22: // mul
                ics.regs[I_R2] = Math.imul(ics.regs[I_R0], ics.regs[I_R1]);
                break;
            case 0x23: // divu
                vr0 = ics.regs[I_R0];
                vr1 = ics.regs[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    ics.regs[I_R2] = (Math.floor((vr0 >>> 0) / (vr1 >>> 0))) | 0;
                }
                break;
            case 0x24: // rcsr
                rcsr(ics, I_R0, I_R2);
                break;
            case 0x25: // sr
                ics.regs[I_R2] = ics.regs[I_R0] >> (ics.regs[I_R1] & 0x1f);
                break;
            case 0x26: // xor
                ics.regs[I_R2] = ics.regs[I_R0] ^ ics.regs[I_R1];
                break;
            case 0x27: // div
                vr0 = ics.regs[I_R0];
                vr1 = ics.regs[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    ics.regs[I_R2] = (Math.floor(vr0/vr1)) | 0;
                }
                break;
            case 0x28: // and
                ics.regs[I_R2] = ics.regs[I_R0] & ics.regs[I_R1];
                break;
            case 0x29: // xnor
                ics.regs[I_R2] = ~(ics.regs[I_R0] ^ ics.regs[I_R1]);
                break;
            case 0x2a: // reserved
                // empty
                break;
            case 0x2b: // scall
                raise_exception(ics, EXCEPT_SYSTEM_CALL);
                break;
            case 0x2c: // sextb
                // sign extend byte to word
                ics.regs[I_R2] = (ics.regs[I_R0] << 24) >> 24;
                break;
            case 0x2d: // add
                ics.regs[I_R2] = (ics.regs[I_R0] + ics.regs[I_R1]) | 0;
                break;
            case 0x2e: // or
                ics.regs[I_R2] = (ics.regs[I_R0] | ics.regs[I_R1]);
                break;
            case 0x2f: // sl
                ics.regs[I_R2] = ics.regs[I_R0] << (ics.regs[I_R1] & 0x1f);
                break;
            case 0x30: // b
                if (I_R0 == REG_EA) {
                    // eret -> restore eie
                    ics.ie.ie = ics.ie.eie;
                } else if (I_R0 == REG_BA) {
                    // bret -> restore bie
                    ics.ie.ie = ics.ie.bie;
                }
                ics.next_pc = ics.regs[I_R0] >>> 0;
                break;
            case 0x31: // modu
                vr0 = ics.regs[I_R0];
                vr1 = ics.regs[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    ics.regs[I_R2] = ((vr0 >>> 0) % (vr1 >>> 0)) | 0;
                }
                break;
            case 0x32: // sub
                ics.regs[I_R2] = (ics.regs[I_R0] - ics.regs[I_R1]) | 0;
                break;
            case 0x33: // reserved
                // empty
                break;
            case 0x34: // wcsr
                wcsr(ics, I_R0, I_R1);
                break;
            case 0x35: // mod
                vr0 = ics.regs[I_R0];
                vr1 = ics.regs[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    ics.regs[I_R2] = (vr0 % vr1) | 0;
                }
                break;
            case 0x36: // call_
                ics.regs[REG_RA] = (ics.pc + 4) | 0;
                ics.next_pc = (ics.regs[I_R0]) >>> 0;
                break;
            case 0x37: // sexth
                // sign extend half-word to word
                ics.regs[I_R2] = (ics.regs[I_R0] << 16) >> 16;
                break;
            case 0x38: // bi
                I_IMM26 =
                    ((op & 0xff000000) >>> 24) |
                    ((op & 0x00ff0000) >> 8) |
                    ((op & 0x0000ff00) << 8) |
                    ((op & 0x00000003) << 24);
                ics.next_pc = (ics.pc + ((I_IMM26 << 2) << 4 >> 4)) >>> 0;
                break;
            case 0x39: // cmpe
                if (ics.regs[I_R0] == ics.regs[I_R1]) {
                    ics.regs[I_R2] = 1;
                } else {
                    ics.regs[I_R2] = 0;
                }
                break;
            case 0x3a: // cmpg
                if (ics.regs[I_R0] > ics.regs[I_R1]) {
                    ics.regs[I_R2] = 1;
                } else {
                    ics.regs[I_R2] = 0;
                }
                break;
            case 0x3b: // cmpge
                if (ics.regs[I_R0] >= ics.regs[I_R1]) {
                    ics.regs[I_R2] = 1;
                }  else {
                    ics.regs[I_R2] = 0;
                }
                break;
            case 0x3c: // cmpgeu
                if ((ics.regs[I_R0] >>> 0) >= (ics.regs[I_R1] >>> 0)) {
                    ics.regs[I_R2] = 1;
                }  else {
                    ics.regs[I_R2] = 0;
                }
                break;
            case 0x3d: // cmpgu
                if ((ics.regs[I_R0] >>> 0) > (ics.regs[I_R1] >>> 0)) {
                    ics.regs[I_R2] = 1;
                }  else {
                    ics.regs[I_R2] = 0;
                }
                break;
            case 0x3e: // calli
                I_IMM26 =
                    ((op & 0xff000000) >>> 24) |
                    ((op & 0x00ff0000) >> 8) |
                    ((op & 0x0000ff00) << 8) |
                    ((op & 0x00000003) << 24);
                ics.regs[REG_RA] = (ics.pc + 4) | 0;
                ics.next_pc = (ics.pc + ((I_IMM26 << 2) << 4 >> 4)) >>> 0;
                break;
            case 0x3f: // cmpne
                if (ics.regs[I_R0] != ics.regs[I_R1]) {
                    ics.regs[I_R2] = 1;
                }  else {
                    ics.regs[I_R2] = 0;
                }
                break;
            }

            inc = 1;
            ticks += inc;
            if (ticks >= max_ticks) {
                tick_f(max_ticks);
                ticks -= max_ticks;
            }
            ics.cc = (ics.cc + inc) | 0;
            ics.pc = ics.next_pc;
        } while (++i < instructions);
        tick_f(ticks);
        return i;
    }

    function set_timers(timers) {
        var len = timers.length;
        cs.timers = new Array(len);
        cs.orig_timers = timers;
        for (var i = 0; i < len; i++) {
            var cur = timers[i];
            (cs.timers)[i] = cur.on_tick;
        }
    }

    function dump_ie() {
        var fmt = lm32.util.format;
        console.log('ie=' + fmt(cs.ie_val()) + '(IE=' + cs.ie.ie + ' EIE=' + cs.ie.eie + ' BIE=' + cs.ie.bie + ')');
    }

    function dump() {
        var i;
        var fmt = lm32.util.format;
        console.log("DUMP:");
        console.log('');
        console.log('IN: PC=' + fmt(cs.pc));
        console.log('ie=' + fmt(cs.ie_val()) + '(IE=' + cs.ie.ie + ' EIE=' + cs.ie.eie + ' BIE=' + cs.ie.bie + ')');
        console.log('im='+ fmt(cs.pic.get_im()) + ' ip=' + fmt(cs.pic.get_ip()));
        console.log('eba=' + fmt(cs.eba) + ' deba=' + fmt(cs.deba));

        for (i = 0; i < 32; i++) {
            if (cs.regs[i] != 0) {
                console.log("r" + i + " = " + lm32.util.format(cs.regs[i]));
            }
        }
    }

    // initialization
    reset(params);

    return {
        cs: cs,
        step: step,
        dump: dump,
        set_timers: set_timers
    }
};
