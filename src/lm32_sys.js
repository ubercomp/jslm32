/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 20:22
 */
"use strict";
lm32.start = function(load_linux) {
    // TODO should be argument
    var terminal_div = 'termDiv'
    
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

    var EBA_BASE = FLASH_BASE;
    var DEBA_BASE = FLASH_BASE;
    var BOOT_PC = load_linux ? FLASH_BASE : RAM_BASE;
    var KERNEL_BASE = RAM_BASE;

    var mmu = new lm32.MMU();

    var ram = new lm32.RAM(RAM_SIZE, true);

    var flash = new lm32.PFlashCFI01(load_linux,
        FLASH_SECTOR_SIZE,
        FLASH_SIZE / FLASH_SECTOR_SIZE, 2,
        0x01, 0x7e, 0x43, 0x00, true);

    var cpu_params = {
        mmu: mmu,
        bootstrap_pc: BOOT_PC,
        bootstrap_eba: EBA_BASE,
        bootstrap_deba: DEBA_BASE
    };

    var cpu = new lm32.Lm32Cpu(cpu_params);
    var set_irq = cpu.pic.irq_handler;


    var timer0 = new lm32.Lm32Timer({
        id: 0,
        irq_line: TIMER0_IRQ,
        set_irq: set_irq
    });

    var timer1 = new lm32.Lm32Timer({
        id: 1,
        irq_line: TIMER1_IRQ,
        set_irq: set_irq
    });

    var timer2 = new lm32.Lm32Timer({
        id: 2,
        irq_line: TIMER2_IRQ,
        set_irq: set_irq
    });

    // UART and Terminal
    var terminal;

    var uart0 = new lm32.UART({
        putchar: function(c) {
            // TODO treat special keys (up, down, left, right), and cursor
            if(c == 0x08) {
                // backspace
                terminal.backspace();
                return;
            }
            if(c == 0x0d) {
                return;
            }
            terminal.write(String.fromCharCode(c));
        },
        irq_line: UART0_IRQ,
        set_irq: set_irq
    });

    var send_char = uart0.send_char.bind(uart0);
    function start_terminal() {
        function termHandler() {
            var line = this.inputChar;
            if (line != "") {
                send_char(line);
            }
        }
        terminal = new Terminal({
            handler: termHandler,
            termDiv: terminal_div
        });
        terminal.open();
        terminal.charMode = true;
    }
    start_terminal();


    // Gluing everything together
    mmu.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
    mmu.add_memory(FLASH_BASE, FLASH_SIZE, flash.get_mmio_handlers());
    mmu.add_memory(UART0_BASE, uart0.iomem_size, uart0.get_mmio_handlers());
    mmu.add_memory(TIMER0_BASE, timer0.iomem_size, timer0.get_mmio_handlers());
    mmu.add_memory(TIMER1_BASE, timer1.iomem_size, timer1.get_mmio_handlers());
    mmu.add_memory(TIMER2_BASE, timer2.iomem_size, timer2.get_mmio_handlers());

    if(load_linux) {
        // load initrd
        console.log('Loading initrd to RAM at ' + lm32.bits.format(0x08400000));
        mmu.load_binary('../linux/initrd.img', 0x08400000);
    } else {
        // load u-boot
        console.log('Loading U-boot to RAM at ' + lm32.bits.format(RAM_BASE));
        mmu.load_binary('../linux/u-boot.bin', RAM_BASE);
    }

    window.flash = flash;
    window.mmu = mmu;
    window.cpu = cpu;

    function on_tick(ticks) {
        (timer0.on_tick.bind(timer0))(ticks);
        (timer1.on_tick.bind(timer1))(ticks);
        (timer2.on_tick.bind(timer2))(ticks);
    }
    cpu.set_timers([timer0, timer1, timer2]);
    var step = cpu.step.bind(cpu);
    var f = function() {
        
        var ticks = step(50000);
        //on_tick(ticks);
        setTimeout(f, 0);
    }
    f();
};

