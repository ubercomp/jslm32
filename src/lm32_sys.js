/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 20:22
 */
"use strict";
lm32.start = function() {
    var FLASH_BASE        = 0x04000000;
    var FLASH_SECTOR_SIZE = 256*1024;
    var FLASH_SIZE        = 32*1024*1024;
    var RAM_BASE          = 0x08000000;
    var RAM_SIZE          = 64*1024*1024;
    var TIMER0_BASE       = 0x80002000;
    var UART0_BASE        = 0x80006000;
    var TIMER1_BASE       = 0x8000a000;
    var UART0_IRQ         = 0;
    var TIMER0_IRQ        = 1;
    var TIMER1_IRQ        = 3;

    var interrupts = new lm32.Lm32Interrupts();

    var ram = new lm32.RAM(RAM_SIZE);
    var ram_mem_handlers = {
        read_8:   ram.read_8.bind(ram),
        read_16:  ram.read_16.bind(ram),
        read_32:  ram.read_32.bind(ram),
        write_8:  ram.write_8.bind(ram),
        write_16: ram.write_16.bind(ram),
        write_32: ram.write_32.bind(ram)
    };

    var mmu = new lm32.MMU();
    mmu.add_memory(RAM_BASE, RAM_SIZE, ram_mem_handlers);

    var interrupts = new lm32.Lm32Interrupts();

    var params = {
        mmu: mmu,
        interrupts: interrupts,
        bootstrap_pc: 0,
        bootstrap_eba: 0,
        bootstrap_deba: 0
    };

    var cpu = new lm32.Lm32Cpu(params);

};