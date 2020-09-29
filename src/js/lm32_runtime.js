/**
 *
 * Runtime Support
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


/**
 * A runtime initializes the environment and handles the user instruction
 * An example application is using the instruction to implement a hypercall-like
 * interface. Each run time implements 2 functions:
 * 1) reset(cs, arg): called whenever the CPU is reset. 
 *        - cs is the CPU state
 *        - arg is the runtime_args object passed to the CPU on reset, if any
 
 * 2) user(cs, opcode): called when the user instruction is reached.
 *        - cs is the CPU state
 *        - opcode is the opcode of the user instruction that was just reached
 */
lm32.runtime = (function() {
    function do_nothing() {}

    
    function handle_user_newlib_exception(cs, opcode) {
        var should_handle = (opcode === 0xcc000007)
        if (should_handle) {
            // system call:
            // r8 -> system call number
            // r1 ... rn -> arguments
            // return:
            //   r1 & r2 (if 64 bits)
            // errno will be set to the value or r3
            var r = cs.regs;
            var n = r[8];
            switch (n) {
            case 1: // exit
                cs.runtime_args.exit(r[1]);
                break;
            case 5: // write
                var fd = r[1];
                var buf = r[2];
                var nbytes = r[3];
                if (fd == 1) { // stdout
                    for (var c  = buf; c < buf + nbytes; c++) {
                        cs.runtime_args.putc(String.fromCharCode(cs.bus.read_8(c)));
                    }
                }
                r[1] = nbytes;
                r[2] = 0;
                r[3] = 0;
                break;
            default: // not implemented: just do ENOSYS
                r[1] = -1;
                r[2] =  0;
                r[3] = 88; // ENOSYS
                console.log("System call not implemented: " + n);
            }        
            
        }
    }

    function init_barebones_newlib_runtime(cs, args) {
        // set stack
        cs.regs[28] = cs.ram_base + cs.ram_size - 4
    }


    var newlib_runtime = {
        reset: init_barebones_newlib_runtime,
        user: handle_user_newlib_exception
    }


    var null_runtime = {
        reset: do_nothing,
        user:  do_nothing
    }

    var test_runtime = {
        reset: do_nothing,
        user:  handle_user_newlib_exception
    }

    
    return {
        newlib_runtime: newlib_runtime,
        null_runtime: null_runtime,
        test_runtime: test_runtime,
    }
})();
