/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 20:22
 */
"use strict";
lm32.start = function(steps) {
    var FLASH_BASE        = 0x04000000;
    var FLASH_SECTOR_SIZE = 256*1024;
    var FLASH_SIZE        = 32*1024*1024;

    var RAM_BASE          = 0x08000000;
    var RAM_SIZE          = 64*1024*1024;

    var TIMER0_BASE       = 0x80002000;
    var TIMER0_IRQ        = 1;

    var TIMER1_BASE       = 0x80010000;
    var TIMER1_IRQ        = 20;

    var TIMER2_BASE       = 0x80012000;
    var TIMER2_IRQ        = 21;

    var UART0_BASE        = 0x80000000;
    var UART0_IRQ         = 0;

    var HWSETUP_BASE      = 0x0bffe000;
    var CMDLINE_BASE      = 0x0bfff000;
    var INITRD_BASE       = 0x08400000;

    var EBA_BASE = RAM_BASE;
    var DEBA_BASE = RAM_BASE;
    var BOOT_PC = RAM_BASE;

    var mmu = new lm32.MMU();
    var cpu_params = {
        mmu: mmu,
        bootstrap_pc: BOOT_PC,
        bootstrap_eba: EBA_BASE,
        bootstrap_deba: DEBA_BASE
    };

    var cpu = new lm32.Lm32Cpu(cpu_params);
    var set_irq = cpu.set_irq.bind(cpu);

    var ram = new lm32.RAM(RAM_SIZE);
    var ram_mem_handlers = {
        read_8:   ram.read_8.bind(ram),
        read_16:  ram.read_16.bind(ram),
        read_32:  ram.read_32.bind(ram),
        write_8:  ram.write_8.bind(ram),
        write_16: ram.write_16.bind(ram),
        write_32: ram.write_32.bind(ram)
    };

    var flash = new lm32.RAM(0);
    var flash_mem_handlers = {
        read_8:   flash.read_8.bind(flash),
        read_16:  flash.read_16.bind(flash),
        read_32:  flash.read_32.bind(flash),
        write_8:  flash.write_8.bind(flash),
        write_16: flash.write_16.bind(flash),
        write_32: flash.write_32.bind(flash)
    };

    var ptimer = (function() {
        function dummy() {};
        return {
            get_count: dummy,
            set_count: dummy,
            run: dummy,
            stop: dummy
        }
    })();

    var timer0 = new lm32.Lm32Timer({
        ptimer: ptimer,
        irq_line: TIMER0_IRQ,
        set_irq: set_irq
    });
    var timer0_mem_handlers = {
        read_32: timer0.read_32.bind(timer0),
        write_32: timer0.write_32.bind(timer0)
    }

    var timer1 = new lm32.Lm32Timer({
        ptimer: ptimer,
        irq_line: TIMER1_IRQ,
        set_irq: set_irq
    });
    var timer1_mem_handlers = {
        read_32: timer1.read_32.bind(timer1),
        write_32: timer1.write_32.bind(timer1)
    }

    var timer2 = new lm32.Lm32Timer({
       ptimer:ptimer,
        irq_line: TIMER2_IRQ,
        set_irq: set_irq
    });

    var timer2_mem_handlers = {
        read_32: timer2.read_32.bind(timer2),
        write_32: timer2.write_32.bind(timer2)
    };

    var uart0 = new lm32.UART({
        putchar: function(c) {
            var t = document.getElementById('texto');
            t.innerHTML = t.innerHTML + ' ' + c;
        },
        irq_line: UART0_IRQ,
        set_irq: set_irq
    });
    var uart0_mem_handlers = {
        read_32: uart0.read_32.bind(uart0),
        write_32: uart0.write_32.bind(uart0)
    };

    mmu.add_memory(RAM_BASE, RAM_SIZE, ram_mem_handlers);
    mmu.add_memory(FLASH_BASE, FLASH_SIZE, flash_mem_handlers);
    mmu.add_memory(UART0_BASE, uart0.iomem_size, uart0_mem_handlers);
    mmu.add_memory(TIMER0_BASE, timer0.iomem_size, timer0_mem_handlers);
    mmu.add_memory(TIMER1_BASE, timer1.iomem_size, timer1_mem_handlers);
    mmu.add_memory(TIMER2_BASE, timer2.iomem_size, timer2_mem_handlers);


    mmu.load_binary("../linux/u-boot.bin", RAM_BASE);
    mmu.load_binary("../linux/hwsetup.bin", HWSETUP_BASE);

    window.flash = flash;
    window.mmu = mmu;
    window.cpu = cpu;

    function f() {
        console.log("Started running at pc: 0x" + cpu.pc.toString(16));
        cpu.step(steps);
        console.log("Finished running at pc: 0x" + cpu.pc.toString(16));

    }
    setTimeout(f, 0);
};
