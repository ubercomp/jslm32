/**
 *
 * Device for tests
 *
 * Copyright (c) 2011-2020 Reginaldo Silva (reginaldo@ubercomp.com)
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

lm32.test_dev = function(params) {
    // dependencies:
    var bus = params.bus;
    var cpu = params.cpu;
    var shutdown = params.shutdown;
    var terminal = params.terminal;

    // constants
    var R_CTRL = 0;
    var R_MAX = 1;


    // state:
    var regs;


    function write_32(addr, value) {
        var BREAKPOINT = 1<<0;
        var INSTRUCTION_BUS_ERROR = 1<<1;
        var WATCHPOINT = 1<<2;
        var DATA_BUS_ERROR = 1<<3;
        var DIVIDE_BY_ZERO = 1<<4;
        var INTERRUPT = 1<<5;
        var SYSTEM_CALL = 1<<6;

        var r = cpu.cs.regs;

        // called by CPU when executing the exception handler
        addr >>= 2;
        if (addr === 0) {
            if (value & SYSTEM_CALL) {
                // system call:
                // r8 -> system call number
                // r1 ... rn -> syscall arguments
                var n = r[8];
                switch (n) {
                case 1: // exit
                    shutdown();
                    break;
                case 5: // write
                    var fd = r[1];
                    var buf = r[2];
                    var nbytes = r[3];
                    if (fd == 1) { // stdout
                        for(var c  = buf; c < buf + nbytes; c++) {
                            terminal.write(String.fromCharCode(bus.read_8(c)));
                        }
                    }
                    break;
                default:
                    console.log("System call not implemented: " + n);
                }
            }
        }
    }

    function get_mmio_handlers() {
        var handlers= {
            write_32: write_32
        }
        return handlers;
    }

    // Initialization and publication
    return {
        get_mmio_handlers: get_mmio_handlers,
        iomem_size: (4 * R_MAX)
    }
};
