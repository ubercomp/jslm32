/**
 * Run Tests
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 30/11/11 23:39
 */
"use strict";

lm32.run_tests = function(wait_time, first_test, last_test) {
    if(! wait_time) {
        wait_time = 500;
    }
    var termDiv = 'termDiv';
    var tests = [
        'test_add.tst',
        'test_addi.tst',
        'test_and.tst',
        'test_andhi.tst',
        'test_andi.tst',
        'test_b.tst',
        'test_be.tst',
        'test_bg.tst',
        'test_bge.tst',
        'test_bgeu.tst',
        'test_bgu.tst',
        'test_bi.tst',
        'test_bne.tst',
        'test_break.tst',
        'test_bret.tst',
        'test_call.tst',
        'test_calli.tst',
        'test_cmpe.tst',
        'test_cmpei.tst',
        'test_cmpg.tst',
        'test_cmpge.tst',
        'test_cmpgei.tst',
        'test_cmpgeu.tst',
        'test_cmpgeui.tst',
        'test_cmpgi.tst',
        'test_cmpgu.tst',
        'test_cmpgui.tst',
        'test_cmpne.tst',
        'test_cmpnei.tst',
        'test_divu.tst',
        'test_eret.tst',
        'test_lb.tst',
        'test_lbu.tst',
        'test_lh.tst',
        'test_lhu.tst',
        'test_lw.tst',
        'test_modu.tst',
        'test_mul.tst',
        'test_muli.tst',
        'test_nor.tst',
        'test_nori.tst',
        'test_or.tst',
        'test_orhi.tst',
        'test_ori.tst',
        'test_ret.tst',
        'test_sb.tst',
        'test_scall.tst',
        'test_sextb.tst',
        'test_sexth.tst',
        'test_sh.tst',
        'test_sl.tst',
        'test_sli.tst',
        'test_sub.tst',
        'test_sw.tst',
        'test_xnor.tst',
        'test_xnori.tst',
        'test_xor.tst',
        'test_xori.tst'
    ];
    if(first_test === undefined) {
        first_test = 0;
    }
    if(last_test === undefined) {
        last_test = tests.length - 1;
    }
    console.log("Running tests " + first_test + " through " + last_test);
    var sys = lm32.start_sys(termDiv);
    var i = first_test;
    var f = function() {
        sys.shutdown.value = false;
        sys.run_test(tests[i], i, sys.shutdown);
        i++;
        if(i <= last_test) {
            setTimeout(f, wait_time);
        }
    }
    f();
};

lm32.start_sys = function(terminal_div) {
    var RAM_BASE = 0x08000000;
    var RAM_SIZE = 64*1024*1024;
    var EBA_BASE = RAM_BASE;
    var DEBA_BASE = RAM_BASE;

    var TESTDEV_BASE = 0xffff0000;
    var MAX_STEPS = 100000;
    var BOOT_PC = RAM_BASE;

    var mmu = new lm32.MMU();

    var cpu_params = {
        mmu: mmu,
        bootstrap_pc: BOOT_PC,
        bootstrap_eba: EBA_BASE,
        bootstrap_deba: DEBA_BASE
    };
    var ram = new lm32.RAM(RAM_SIZE, true);

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

    var testdev_params = {
        mmu: mmu,
        shutdown: shutdown_f,
        terminal: terminal
    };
    var testdev = new lm32.TestDev(testdev_params);
    
    mmu.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
    mmu.add_memory(TESTDEV_BASE, testdev.iomem_size, testdev.get_mmio_handlers());

    function run_test(test_name, idx, shutdown) {
        var cpu = new lm32.Lm32Cpu(cpu_params);
        // testdev.reset();
        var str = "\nRunning Test " + test_name + " (" + idx + ")\n";
        terminal.write(str);
        console.log(str);
        mmu.log = false;
        mmu.load_binary("../test/" + test_name, BOOT_PC);
        mmu.log = true;
        var steps = 0;
        while(shutdown.value == false && steps < MAX_STEPS) {
            cpu.step(1);
            steps++;
        }
        if(shutdown.value == false) {
            terminal.write("Shutdown was never requested. Test FAILED\n");
        }
    }

    var ret = {
      run_test: run_test,
      shutdown: shutdown
    };
    return ret;
};