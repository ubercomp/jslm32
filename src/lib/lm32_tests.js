/**
 *
 * Test Runner
 *
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
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
 (function() {
"use strict";

function run_tests(cpu_f, wait_time, first_test, last_test) {
    if (! wait_time) {
        wait_time = 500;
    }
    var term_element = 'terminal';
    var tests = [
        'test_add.bin',
        'test_addi.bin',
        'test_and.bin',
        'test_andhi.bin',
        'test_andi.bin',
        'test_b.bin',
        'test_be.bin',
        'test_bg.bin',
        'test_bge.bin',
        'test_bgeu.bin',
        'test_bgu.bin',
        'test_bi.bin',
        'test_bne.bin',
        'test_break.bin',
        'test_bret.bin',
        'test_call.bin',
        'test_calli.bin',
        'test_cmpe.bin',
        'test_cmpei.bin',
        'test_cmpg.bin',
        'test_cmpge.bin',
        'test_cmpgei.bin',
        'test_cmpgeu.bin',
        'test_cmpgeui.bin',
        'test_cmpgi.bin',
        'test_cmpgu.bin',
        'test_cmpgui.bin',
        'test_cmpne.bin',
        'test_cmpnei.bin',
        'test_divu.bin',
        'test_eret.bin',
        'test_lb.bin',
        'test_lbu.bin',
        'test_lh.bin',
        'test_lhu.bin',
        'test_lw.bin',
        'test_modu.bin',
        'test_mul.bin',
        'test_muli.bin',
        'test_nor.bin',
        'test_nori.bin',
        'test_or.bin',
        'test_orhi.bin',
        'test_ori.bin',
        'test_ret.bin',
        'test_sb.bin',
        'test_scall.bin',
        'test_sextb.bin',
        'test_sexth.bin',
        'test_sh.bin',
        'test_sl.bin',
        'test_sli.bin',
        'test_sr.bin',
        'test_sri.bin',
        'test_sru.bin',
        'test_srui.bin',
        'test_sub.bin',
        'test_sw.bin',
        'test_xnor.bin',
        'test_xnori.bin',
        'test_xor.bin',
        'test_xori.bin'
    ];
    if (first_test === undefined) {
        first_test = 0;
    }
    if (last_test === undefined) {
        last_test = tests.length - 1;
    }
    console.log("Running tests " + first_test + " through " + last_test);
    var sys = start_test_sys(cpu_f, term_element);
    var i = first_test;
    var f = function() {
        sys.shutdown.value = false;
        sys.run_test(tests[i], i, sys.shutdown);
        i++;
        if (i <= last_test) {
            setTimeout(f, wait_time);
        }
    }
    f();
};

function start_test_sys(cpu_f, terminal_div) {
    var RAM_BASE = 0x08000000;
    var RAM_SIZE = 1 * 1024 * 1024;
    var EBA_BASE = 0;
    var DEBA_BASE = 0;

    var TESTDEV_BASE = 0xffff0000;
    var MAX_STEPS = 2000;
    var BOOT_PC = RAM_BASE;

    var ram = lm32.ram(RAM_SIZE, true);

    var term = document.getElementById(terminal_div);
    var terminal = (function() {
        return {
          write: function(str) {
              term.textContent = term.textContent + str;
          }
        };
    })();

    terminal.write("LM32 Test Runner\n");

    var shutdown = { value: false };
    function shutdown_f() {
        terminal.write("Shutdown Requested!\n\n");
        shutdown.value = true;
    }


    function run_test(test_name, idx, shutdown) {
        var bus = lm32.bus();
        var cpu_params = {
            bus: bus,
            ram: ram,
            ram_base: RAM_BASE,
            ram_size: RAM_SIZE,
            bootstrap_pc: BOOT_PC,
            bootstrap_eba: EBA_BASE,
            bootstrap_deba: DEBA_BASE
        };
        var cpu = cpu_f(cpu_params);
        var dummyTimer = function() {
            return {
                on_tick: function() {}
            }
        };
        var timer = dummyTimer();
        cpu.set_timers([timer]);

        var testdev_params = {
            bus: bus,
            cpu: cpu,
            shutdown: shutdown_f,
            terminal: terminal
        };
        var testdev = lm32.test_dev(testdev_params);

        bus.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
        bus.add_memory(
            TESTDEV_BASE,
            testdev.iomem_size,
            testdev.get_mmio_handlers()
        );


        var str = "\nRunning Test " + test_name + " (" + idx + ")\n";
        terminal.write(str);
        console.log(str);
        bus.log = false;
        cpu.cs.pc = BOOT_PC;
        var on_load_binary_result = function(result) {
            bus.log = true;
            var steps = 0;
            while (shutdown.value === false && steps < MAX_STEPS) {
                cpu.step(1);
                steps++;
            }
            if (shutdown.value === false) {
                terminal.write("Shutdown was never requested. Test FAILED\n");
            }

        }
        bus.load_binary("../test/" + test_name, BOOT_PC,on_load_binary_result);
    }

    return {
        run_test: run_test,
        shutdown: shutdown
    };
};

function start_tests_interp(_event) {
    run_tests(lm32.cpu_interp, 0);
}

function start_tests_dynrec(_event) {
    run_tests(lm32.cpu_dynrec, 0);
}

function main() {
    var div = document.getElementById('lm32_tests_container');

    var button_interp = document.createElement('button');
    button_interp.textContent = 'Test Interpreter';
    button_interp.onclick = start_tests_interp;

    var button_dynrec = document.createElement('button');
    button_dynrec.textContent = 'Test Dynrec';
    button_dynrec.onclick = start_tests_dynrec;


    var terminal = document.createElement('pre');
    terminal.id = 'terminal';
    div.appendChild(button_interp);
    div.appendChild(button_dynrec);
    div.appendChild(terminal);
}

document.addEventListener("DOMContentLoaded", function(_event) { main(); });
})();
