/**
 * Device for tests
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
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

lm32.testDev = function(params) {
    // dependencies:
    var mmu = params.mmu;
    var shutdown = params.shutdown;
    var terminal = params.terminal;

    // constants
    var R_CTRL = 0;
    var R_PASSFAIL = 1;
    var R_TESTNAME = 2;
    var R_MAX = 3;

    var MAX_TESTNAME_LEN = 16;

    // state:
    var regs;
    var testname;

    
    function copy_testname() {
        var addr = regs[R_TESTNAME];
        for(var i = 0; i < MAX_TESTNAME_LEN; i++) {
            var val = mmu.read_8(addr + i);
            testname[i] = val;
            if(val == 0) {
                break;
            }
        }
        testname[MAX_TESTNAME_LEN - 1] = '\0';
    }

    function testname_charr_to_str() {
        var  s = '';
        var i;
        for(i = 0; i < MAX_TESTNAME_LEN; i ++) {
            var val = testname[i];
            if(val == 0) {
                break;
            }
            s += String.fromCharCode(val);
        }
        while(i < MAX_TESTNAME_LEN) {
            s = s + ' ';
            i++;
        }
        return s;
    }

    function reset() {
        // registers
        regs = new Array(R_MAX);
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = 0;
        }

        // array of characters forming testname
        testname = new Array(MAX_TESTNAME_LEN);
        for(var i = 0; i < MAX_TESTNAME_LEN; i++) {
            testname[i] = 0;
        }
    }

    function write_32(addr, value) {
        addr >>= 2;
        switch (addr) {
            case R_CTRL:
                shutdown();
                break;

            case R_PASSFAIL:
                regs[addr] = value;
                var testname = testname_charr_to_str();
                var result = (value != 0) ? "FAILED" : "OK";
                terminal.write("TC    " +  testname + " RESULT: " + result + "\n");
                break;

            case R_TESTNAME:
                regs[addr] = value;
                copy_testname();
                break;

            default:
                terminal.write("Writing to invalid register: " + addr);
                break;
        }
    }

    function get_mmio_handlers() {
        var handlers= {
            write_32: write_32
        }
        return handlers;
    }

    // Initialization and publication
    reset();
    return {
        get_mmio_handlers: get_mmio_handlers,
        iomem_size: (4 * R_MAX)
    }
};
