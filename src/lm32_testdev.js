/**
 * Device for tests
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 30/11/11 22:43
 */
"use strict";

lm32.TestDev = function(params) {
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

    
    function copy_testname() {
        // TODO why is this constant needed?
        var addr = this.regs[R_TESTNAME] + 0x1000;
        for(var i = 0; i < MAX_TESTNAME_LEN; i++) {
            var val = mmu.read_8(addr + i);
            this.testname[i] = val;
            if(val == 0) {
                break;
            }
        }
        this.testname[MAX_TESTNAME_LEN - 1] = '\0';
    }
    this.copy_testname = copy_testname;

    function testname_charr_to_str() {
        var  s = '';
        var i;
        for(i = 0; i < MAX_TESTNAME_LEN; i ++) {
            var val = this.testname[i];
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
    this.testname_charr_to_str = testname_charr_to_str;
    
    function reset() {
        // registers
        this.regs = new Array(R_MAX);
        for(var i = 0; i < R_MAX; i++) {
            this.regs[i] = 0;
        }

        // array of characters forming testname
        this.testname = new Array(MAX_TESTNAME_LEN);
        for(var i = 0; i < MAX_TESTNAME_LEN; i++) {
            this.testname[i] = 0;
        }
    }
    this.reset = reset;

    function write_32(addr, value) {
        addr >>= 2;
        switch (addr) {
            case R_CTRL:
                shutdown();
                break;

            case R_PASSFAIL:
                this.regs[addr] = value;
                var testname = this.testname_charr_to_str();
                var result = (value != 0) ? "FAILED" : "OK";
                terminal.write("TC    " +  testname + " RESULT: " + result + "\n");
                break;

            case R_TESTNAME:
                this.regs[addr] = value;
                this.copy_testname();
                break;

            default:
                terminal.write("Writing to invalid register: " + addr);
                break;
        }
    }

    // Initialization and publication
    this.reset();
    this.write_32 = write_32;
    this.iomem_size = (4 * R_MAX);
};

lm32.TestDev.prototype.get_mmio_handlers = function() {
    var handlers = {
        write_32: this.write_32.bind(this)
    };
    return handlers;
};