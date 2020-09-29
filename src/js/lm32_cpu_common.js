/**
 *
 * LatticeMico32 CPU emulation: code that's common between cpu engines
 *
 * Copyright (c) 2011-2020 Reginaldo Silva (reginaldo@ubercomp.com)
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

lm32.cpu_common = (function() {

    function reset(cs, params) {
        cs.ram = params.ram;
        cs.ram_base = params.ram_base;
        cs.ram_size = params.ram_size;
        cs.ram_max  = cs.ram_base + cs.ram_size;
        cs.bus = params.bus;

        if (params.runtime) {
            cs.runtime = params.runtime;
        } else {
            cs.runtime = lm32.runtime.null_runtime;
        }
        cs.runtime_args = params.runtime_args; // may be undefined

        // general purpose registers
        cs.regs = new Int32Array(32);
        for (var i = 0; i < 32; i++) {
            cs.regs[i] = 0;
        }

        // control and status registers
        // program counter: unsigned, two lower bits should always be 0
        cs.pc = params.bootstrap_pc;
        cs.next_pc = cs.pc + 4; // jumps write on next_pc
        cs.waiting = false;
        cs.pic = lm32.pic(cs, params.wake_up_on_interrupt);

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

        cs.runtime.reset(cs, cs.runtime_args);
    }

    function dump_ie(cs) {
        var fmt = lm32.util.format;
        console.log('ie=' + fmt(cs.ie_val()) + '(IE=' + cs.ie.ie + ' EIE=' + cs.ie.eie + ' BIE=' + cs.ie.bie + ')');
    }

    function dump(cs) {
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

    return {
        reset: reset,
        dump: dump,
    };
})();
