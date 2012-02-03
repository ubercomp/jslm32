/**
 * Copyright (c) 2012 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 03/02/12
 */
lm32.memops_dev = function(mmu, ram_array, ram_base, ram_size) {

    var R_TO = 0;    // memcpy destination addr, memset destination addr
    var R_FROM = 1;  // memcpy origin addr
    var R_SIZE = 2;  // memcpy size, memset size
    var R_COPY = 3;  // command to copy
    var R_VALUE = 4; // memset value
    var R_SET = 5;
    var R_MAX = 6;

    var RESET_VALUE = -1;

    var regs = new Array(R_MAX);

    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = RESET_VALUE;
        }
    }

    function region_from_ram(base, size) {
        return addr_from_ram(base) && addr_from_ram(base + size - 1);
    }

    function addr_from_ram(addr) {
        return (addr >= ram_base) && (addr < ram_base + ram_size);
    }


    function do_copy_ram() {
        var to_orig = regs[R_TO] - ram_base;
        var from_orig = regs[R_FROM] - ram_base;
        var size = regs[R_SIZE];
        for(var i = 0; i < size; i++) {
            ram_array[to_orig + i] = ram_array[from_orig + i];
        }
    }

    function do_copy_mmu() {
        var to_orig = regs[R_TO];
        var from_orig = regs[R_FROM];
        var size = regs[R_SIZE];
        for(var i = 0; i < size; i++) {
            mmu.write_8(to_orig + i, mmu.read_8(from_orig + i));
        }
    }

    function do_copy() {
        // JAVASCRIPT memcpy implementation
        if(regs[R_TO] == RESET_VALUE ||
            regs[R_FROM] == RESET_VALUE ||
            regs[R_SIZE] == RESET_VALUE) {
            throw "memcpy_dev: Not ready to copy!!"
        }

        //console.log('memcpy from = ' + lm32.bits.format(regs[R_FROM]) +
        // ' to =' + lm32.bits.format(regs[R_TO]) +
        // ' size =' + lm32.bits.format(regs[R_SIZE]));

        if(region_from_ram(regs[R_TO], regs[R_SIZE]) &&
            region_from_ram(regs[R_FROM], regs[R_SIZE])) {
            do_copy_ram();
        } else {
            do_copy_mmu();
        }
        reset();

    }

    function do_set_ram() {

    }

    function do_set_mmu() {

    }

    function do_set() {
        // JAVASCRIPT MEMSET IMPLEMENTATION


        if(region_from_ram(regs[R_TO], regs[R_SIZE])) {
            do_set_ram();
        } else {
            do_set_mmu();
        }

    }

    function read_32(addr) {
        addr >>= 2;
        if (addr < 0 || addr >= R_MAX) {
            throw ("memcpy_dev: Unknown address: " + addr);
        }
        return regs[addr];
    }

    function write_32(addr, value) {
        addr >= 2;
        switch(addr) {
            case R_TO:
            case R_FROM:
                regs[addr] = lm32.bits.unsigned32(value);
                break;

            case R_SIZE:
            case R_VALUE:
                regs[addr] = value;
                break;

            case R_COPY:
                do_copy();
                break;

            case R_SET:
                do_set();
                break;
            default:
                throw "memcpy_dev: No such register: " + addr;
        }
    }

    function get_mmio_handlers() {
        var handlers = {
            read_32: read_32,
            write_32: write_32
        };
        return handlers;
    }

    return {
        iomem_size: 4 * R_MAX,
        get_mmio_handlers: get_mmio_handlers,
        reset: reset
    };

};