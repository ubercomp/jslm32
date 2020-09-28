/**
 *
 * LatticeMico32 CPU emulation: interpreter
 *
 * Copyright (c) 2020 Reginaldo Silva (reginaldo@ubercomp.com)
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
                val = cs.cc; // note: cycle counter is 0 now
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


    function step(instructions) {
        var i = 0;
        var ics = cs; // internal cs -> speeds things up
        var r = ics.regs;
        var ram = ics.ram;

        var ps = ics.pic.state; // pic state
        var op, pc;
        var rpc; // ram-based pc

        var I_OPC, I_IMM5, I_IMM16, I_IMM26, I_R0, I_R1, I_R2;

        var ram_base = ics.ram_base;
        var v8 = ics.ram.v8;
        var dv = ics.ram.dv;

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

            op = dv.getUint32(rpc);
            I_OPC = (op & 0xfc000000) >>> 26;
            I_R0 = (op & 0x03e00000) >> 21;
            I_R1 = (op & 0x001f0000) >> 16;
            I_R2 = (op & 0x0000f800) >> 11;

            // Instruction execution:
            switch(I_OPC) {
            case 0x00: // srui
                I_IMM5 = op & 0x1f;
                r[I_R1] = r[I_R0] >>> I_IMM5;
                break;
            case 0x01: // nori
                I_IMM16 = op & 0xffff;
                r[I_R1] = ~(r[I_R0] | I_IMM16);
                break;
            case 0x02: // muli
                I_IMM16 = op & 0xffff;
                r[I_R1] = (r[I_R0] * (I_IMM16 << 16 >> 16)) | 0;
                break;
            case 0x03: // sh
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    dv.setUint16(uaddr - ics.ram_base, r[I_R1] & 0xffff);
                } else {
                    ics.bus.write_16(uaddr, r[I_R1]);
                }
                break;
            case 0x04: // lb
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    r[I_R1] = (ram.v8[uaddr - ics.ram_base] << 24 >> 24);
                } else {
                    val = ics.bus.read_8(uaddr);
                    if (val != undefined) {
                        r[I_R1] = (val << 24) >> 24;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x05: // sri
                I_IMM5 = op & 0x1f;
                r[I_R1] = r[I_R0] >> I_IMM5;
                break;
            case 0x06: // xori
                I_IMM16 = op & 0xffff;
                r[I_R1] = r[I_R0] ^ I_IMM16;
                break;
            case 0x07: // lh
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    r[I_R1] = dv.getInt16(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_16(uaddr);
                    if (val != undefined) {
                        r[I_R1] = (val << 16) >> 16;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x08: // andi
                I_IMM16 = op & 0xffff;
                r[I_R1] = r[I_R0] & I_IMM16;
                break;
            case 0x09: // xnori
                I_IMM16 = op & 0xffff;
                r[I_R1] = ~(r[I_R0] ^ I_IMM16);
                break;
            case 0x0a: // lw
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    r[I_R1] = dv.getUint32(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_32(uaddr);
                    if (val != undefined) {
                        r[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }

                }
                break;
            case 0x0b: // lhu
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    r[I_R1] = dv.getUint16(uaddr - ics.ram_base);
                } else {
                    val = ics.bus.read_16(uaddr);
                    if (val != undefined) {
                        r[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x0c: // sb
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    ram.v8[uaddr - ics.ram_base] = r[I_R1] & 0xff;
                } else {
                    ics.bus.write_8(uaddr, r[I_R1]);
                }
                break;
            case 0x0d: // addi
                I_IMM16 = op & 0xffff;
                r[I_R1] = (r[I_R0] + (I_IMM16 << 16 >> 16)) | 0;
                break;
            case 0x0e: // ori
                I_IMM16 = op & 0xffff;
                r[I_R1] = (r[I_R0] | I_IMM16);
                break;
            case 0x0f: // sli
                I_IMM5 = op & 0x1f;
                r[I_R1] = r[I_R0] << I_IMM5;
                break;
            case 0x10: // lbu
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    r[I_R1] = v8[uaddr - ics.ram_base];
                } else {
                    val = ics.bus.read_8(uaddr);
                    if (val != undefined) {
                        r[I_R1] = val;
                    } else {
                        console.log("ERROR on lb at addr " + uaddr);
                        raise_exception(ics, EXCEPT_DATA_BUS_ERROR);
                    }
                }
                break;
            case 0x11: // be
                if (r[I_R0] == r[I_R1]) {
                    I_IMM16 = op & 0xffff;
                  ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x12: // bg
                if (r[I_R0] > r[I_R1]) {
                    I_IMM16 = op & 0xffff;
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x13: // bge
                if (r[I_R0] >= r[I_R1]) {
                    I_IMM16 = op & 0xffff;
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x14: // bgeu
                if ((r[I_R0] >>> 0) >= (r[I_R1] >>> 0)) {
                    I_IMM16 = op & 0xffff;
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x15: // bgu
                if ((r[I_R0] >>> 0) > (r[I_R1] >>> 0)) {
                    I_IMM16 = op & 0xffff;
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x16: // sw
                I_IMM16 = op & 0xffff;
                uaddr = (r[I_R0] + (I_IMM16 << 16 >> 16)) >>> 0;
                if ((uaddr >= ics.ram_base) && (uaddr < ics.ram_max)) {
                    dv.setUint32(uaddr - ics.ram_base, r[I_R1] | 0);
                } else {
                    ics.bus.write_32(uaddr, r[I_R1]);
                }
                break;
            case 0x17: // bne
                if (r[I_R0] != r[I_R1]) {
                    I_IMM16 = op & 0xffff;
                    ics.next_pc = (ics.pc + ((I_IMM16 << 16) >> 14)) >>> 0;
                }
                break;
            case 0x18: // andhi
                I_IMM16 = op & 0xffff;
                r[I_R1] = r[I_R0] & (I_IMM16 << 16);
                break;
            case 0x19: // cmpei
                I_IMM16 = op & 0xffff;
                if (r[I_R0] == ((I_IMM16 << 16) >> 16)) {
                    r[I_R1] = 1;
                } else {
                    r[I_R1] = 0;
                }
                break;
            case 0x1a: // cmpgi
                I_IMM16 = op & 0xffff;
                if (r[I_R0] > ((I_IMM16 << 16) >> 16)) {
                    r[I_R1] = 1;
                } else {
                    r[I_R1] = 0;
                }
                break;
            case 0x1b: // cmpgei
                I_IMM16 = op & 0xffff;
                if (r[I_R0] >= ((I_IMM16 << 16) >> 16)) {
                    r[I_R1] = 1;
                } else {
                    r[I_R1] = 0;
                }
                break;
            case 0x1c: // cmpgeui
                I_IMM16 = op & 0xffff;
                if ((r[I_R0] >>> 0) >= I_IMM16) {
                    r[I_R1] = 1;
                } else {
                    r[I_R1] = 0;
                }
                break;
            case 0x1d: // cmpgui
                I_IMM16 = op & 0xffff;
                r[I_R1] = ((r[I_R0] >>> 0) > I_IMM16) | 0;
                break;
            case 0x1e: // orhi
                I_IMM16 = op & 0xffff;
                r[I_R1] = r[I_R0] | (I_IMM16 << 16);
                break;
            case 0x1f: // cmpnei
                I_IMM16 = op & 0xffff;
                if (r[I_R0] != ((I_IMM16 << 16) >> 16)) {
                    r[I_R1] = 1;
                } else {
                    r[I_R1] = 0;
                }
                break;
            case 0x20: // sru
                r[I_R2] = r[I_R0] >>> (r[I_R1] & 0x1f);
                break;
            case 0x21: // nor
                r[I_R2] = ~(r[I_R0] | r[I_R1]);
                break;
            case 0x22: // mul
                r[I_R2] = Math.imul(r[I_R0], r[I_R1]);
                break;
            case 0x23: // divu
                vr0 = r[I_R0];
                vr1 = r[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    r[I_R2] = (Math.floor((vr0 >>> 0) / (vr1 >>> 0))) | 0;
                }
                break;
            case 0x24: // rcsr
                rcsr(ics, I_R0, I_R2);
                break;
            case 0x25: // sr
                r[I_R2] = r[I_R0] >> (r[I_R1] & 0x1f);
                break;
            case 0x26: // xor
                r[I_R2] = r[I_R0] ^ r[I_R1];
                break;
            case 0x27: // div
                vr0 = r[I_R0];
                vr1 = r[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    r[I_R2] = (Math.floor(vr0/vr1)) | 0;
                }
                break;
            case 0x28: // and
                r[I_R2] = r[I_R0] & r[I_R1];
                break;
            case 0x29: // xnor
                r[I_R2] = ~(r[I_R0] ^ r[I_R1]);
                break;
            case 0x2a: // reserved
                // empty
                break;
            case 0x2b: // scall
                I_IMM5 = op & 0x1f;
                switch(I_IMM5) {
                case 7:
                    raise_exception(ics, EXCEPT_SYSTEM_CALL);
                    break;
                case 2:
                    raise_exception(ics, EXCEPT_BREAKPOINT);
                    break;
                }
                break;
            case 0x2c: // sextb
                // sign extend byte to word
                r[I_R2] = (r[I_R0] << 24) >> 24;
                break;
            case 0x2d: // add
                r[I_R2] = (r[I_R0] + r[I_R1]) | 0;
                break;
            case 0x2e: // or
                r[I_R2] = (r[I_R0] | r[I_R1]);
                break;
            case 0x2f: // sl
                r[I_R2] = r[I_R0] << (r[I_R1] & 0x1f);
                break;
            case 0x30: // b
                if (I_R0 == REG_EA) {
                    // eret -> restore eie
                    ics.ie.ie = ics.ie.eie;
                } else if (I_R0 == REG_BA) {
                    // bret -> restore bie
                    ics.ie.ie = ics.ie.bie;
                }
                ics.next_pc = r[I_R0] >>> 0;
                break;
            case 0x31: // modu
                vr0 = r[I_R0];
                vr1 = r[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    r[I_R2] = ((vr0 >>> 0) % (vr1 >>> 0)) | 0;
                }
                break;
            case 0x32: // sub
                r[I_R2] = (r[I_R0] - r[I_R1]) | 0;
                break;
            case 0x33: // reserved (user instruction)
                ics.runtime.user(ics, op);
                break;
            case 0x34: // wcsr
                wcsr(ics, I_R0, I_R1);
                break;
            case 0x35: // mod
                vr0 = r[I_R0];
                vr1 = r[I_R1];
                if (vr1 === 0) {
                    raise_exception(ics, EXCEPT_DIVIDE_BY_ZERO);
                } else {
                    r[I_R2] = (vr0 % vr1) | 0;
                }
                break;
            case 0x36: // call_
                r[REG_RA] = (ics.pc + 4) | 0;
                ics.next_pc = (r[I_R0]) >>> 0;
                break;
            case 0x37: // sexth
                // sign extend half-word to word
                r[I_R2] = (r[I_R0] << 16) >> 16;
                break;
            case 0x38: // bi
                I_IMM26 = op & 0x3ffffff;
                ics.next_pc = (ics.pc + ((I_IMM26 << 2) << 4 >> 4)) >>> 0;
                break;
            case 0x39: // cmpe
                if (r[I_R0] == r[I_R1]) {
                    r[I_R2] = 1;
                } else {
                    r[I_R2] = 0;
                }
                break;
            case 0x3a: // cmpg
                if (r[I_R0] > r[I_R1]) {
                    r[I_R2] = 1;
                } else {
                    r[I_R2] = 0;
                }
                break;
            case 0x3b: // cmpge
                if (r[I_R0] >= r[I_R1]) {
                    r[I_R2] = 1;
                }  else {
                    r[I_R2] = 0;
                }
                break;
            case 0x3c: // cmpgeu
                if ((r[I_R0] >>> 0) >= (r[I_R1] >>> 0)) {
                    r[I_R2] = 1;
                }  else {
                    r[I_R2] = 0;
                }
                break;
            case 0x3d: // cmpgu
                if ((r[I_R0] >>> 0) > (r[I_R1] >>> 0)) {
                    r[I_R2] = 1;
                }  else {
                    r[I_R2] = 0;
                }
                break;
            case 0x3e: // calli
                I_IMM26 = op & 0x3ffffff;
                r[REG_RA] = (ics.pc + 4) | 0;
                ics.next_pc = (ics.pc + ((I_IMM26 << 2) << 4 >> 4)) >>> 0;
                break;
            case 0x3f: // cmpne
                if (r[I_R0] != r[I_R1]) {
                    r[I_R2] = 1;
                }  else {
                    r[I_R2] = 0;
                }
                break;
            }

            ics.pc = ics.next_pc;
        } while (++i < instructions);
        return i;
    }


    // initialization
    lm32.cpu_common.reset(cs, params);

    return {
        cs: cs,
        step: step,
    }
};
