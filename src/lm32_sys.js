/**
 * System Starter
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 20:22
 */
"use strict";
lm32.start = function(load_linux, terminal, key_handler) {
    var U_BOOT_BASE = 0x0bfdc000;
    
    var FLASH_BASE = 0x04000000;
    var FLASH_SECTOR_SIZE = 256 * 1024;
    var FLASH_SIZE = 32 * 1024 * 1024;

    var RAM_BASE = 0x08000000;
    var RAM_SIZE = 64 * 1024 * 1024;

    var TIMER0_BASE = 0x80002000;
    var TIMER0_IRQ = 1;

    var TIMER1_BASE = 0x80010000;
    var TIMER1_IRQ = 20;

    var TIMER2_BASE = 0x80012000;
    var TIMER2_IRQ = 21;

    var UART0_BASE = 0x80000000;
    var UART0_IRQ = 0;

    // dummy devices:
    var TRISPEEDMAC_BASE = 0x80008000;
    var TRISPEEDMAC_SIZE = 8192;

    var LEDS_BASE = 0x80004000
    var LEDS_SIZE = 128;

    var _7SEG_BASE = 0x80006000;
    var _7SEG_SIZE = 128;

    var HWSETUP_BASE = 0x0bffe000;
    var CMDLINE_BASE = 0x0bfff000;
    var INITRD_BASE = 0x08400000;

    var EBA_BASE = FLASH_BASE;
    var DEBA_BASE = FLASH_BASE;
    var BOOT_PC = RAM_BASE;
    var KERNEL_BASE = RAM_BASE;

    var mmu = lm32.mmu();

    var ram = lm32.ram(RAM_SIZE, true);

    var flash = new lm32.PFlashCFI01(false,
        FLASH_SECTOR_SIZE,
        FLASH_SIZE / FLASH_SECTOR_SIZE, 2,
        0x01, 0x7e, 0x43, 0x00, true);

    var cpu_params = {
        mmu: mmu,
        ram: ram,
        ram_base: RAM_BASE,
        ram_size: RAM_SIZE,
        bootstrap_pc: BOOT_PC,
        bootstrap_eba: EBA_BASE,
        bootstrap_deba: DEBA_BASE
    };

    var cpu = lm32.lm32Cpu(cpu_params);
    var set_irq = cpu.cs.pic.irq_handler;


    var timer0 = lm32.lm32Timer({
        id: 0,
        irq_line: TIMER0_IRQ,
        set_irq: set_irq
    });

    //var timer1 = lm32.lm32Timer({
    //    id: 1,
    //    irq_line: TIMER1_IRQ,
    //    set_irq: set_irq
    //});

    //var timer2 = lm32.lm32Timer({
    //    id: 2,
    //    irq_line: TIMER2_IRQ,
    //    set_irq: set_irq
    //});

    // UART and Terminal

    var putchar = function(c) {
        // TODO figure out if there are other special keys and treat them
        if(c == 8) {
            // backspace
            var col = terminal.getCursorColumn();
            if(col > 0) {
                terminal.setCursorColumn(col - 1);
                terminal.eraseToRight(1);
            }
            return;
        }
        terminal.interpret(String.fromCharCode(c));
    };

    var uart0 = lm32.lm32UART({
        putchar: putchar,
        irq_line: UART0_IRQ,
        set_irq: set_irq
    });

    var send_str = uart0.send_str.bind(uart0);
    key_handler.set_send_fn(send_str);

    function make_dummy_device(name, base, log) {
        function dummy(addr, value) {
            if (value !== undefined) {
                if (log) {
                    console.log('dummy: ' + name + ' write addr=' + lm32.bits.format(addr + base) + ' value= ' + lm32.bits.format(value));
                }
            } else {
                if (log) {
                    console.log('dummy: ' + name + ' read addr=' + lm32.bits.format(addr + base));
                }
            }
            return 0;
        }

        var handlers = {
            read_8:   dummy,
            read_16:  dummy,
            read_32:  dummy,
            write_8:  dummy,
            write_16: dummy,
            write_32: dummy

        };
        return handlers;
    }


    // Gluing everything together
    mmu.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
    mmu.add_memory(FLASH_BASE, FLASH_SIZE, flash.get_mmio_handlers());
    mmu.add_memory(UART0_BASE, uart0.iomem_size, uart0.get_mmio_handlers());
    mmu.add_memory(TIMER0_BASE, timer0.iomem_size, timer0.get_mmio_handlers());
    //mmu.add_memory(TIMER1_BASE, timer1.iomem_size, timer1.get_mmio_handlers());
    //mmu.add_memory(TIMER2_BASE, timer2.iomem_size, timer2.get_mmio_handlers());
    mmu.add_memory(TRISPEEDMAC_BASE, TRISPEEDMAC_SIZE, make_dummy_device('trispeedmac', TRISPEEDMAC_BASE, true));
    mmu.add_memory(LEDS_BASE, LEDS_SIZE, make_dummy_device('leds', LEDS_BASE, false));
    mmu.add_memory(_7SEG_BASE, _7SEG_SIZE, make_dummy_device('7seg', _7SEG_BASE, true));


    if (load_linux) {
        // with u-boot
        console.log('Loading linux and initrd');
        mmu.load_binary('../linux/u-boot.bin', U_BOOT_BASE);
        mmu.load_binary('../linux/initrd.small.img', INITRD_BASE);
        mmu.load_binary('../linux/vmlinux.nogz.img', 0x0a000000);
        cpu.cs.pc=U_BOOT_BASE;
    } else {
        // load u-boot
        console.log('Loading U-boot to RAM at ' + lm32.bits.format(RAM_BASE));
        mmu.load_binary('../linux/u-boot.bin', RAM_BASE);
    }
    
    window.cpu = cpu;
    cpu.set_timers([timer0]);//, timer1, timer2]);
    setTimeout(cpu.step_forever, 0);
};