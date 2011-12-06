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

    var UART0_BASE        = 0x80000000;
    var UART0_IRQ         = 0;

    var HWSETUP_BASE      = 0x0bffe000;

    var EBA_BASE = FLASH_BASE;
    var DEBA_BASE = FLASH_BASE;
    var BOOT_PC = load_linux ? FLASH_BASE : RAM_BASE;
    var mmu = new lm32.MMU();
    var vm_clock = new lm32.ghw.VMClock();

    var ram = new lm32.RAM(RAM_SIZE, true);


    var flash = new lm32.PFlashCFI01(load_linux, FLASH_SECTOR_SIZE,
        FLASH_SIZE / FLASH_SECTOR_SIZE, 2,
        0x01, 0x7e, 0x43, 0x00, true);

    var cpu_params = {
        mmu: mmu,
        bootstrap_pc: BOOT_PC,
        bootstrap_eba: EBA_BASE,
        bootstrap_deba: DEBA_BASE
    };
    var cpu = new lm32.Lm32Cpu(cpu_params);
    var set_irq = cpu.set_irq.bind(cpu);


    var timer0 = new lm32.Lm32Timer({
        id: 0,
        vm_clock: vm_clock,
        irq_line: TIMER0_IRQ,
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
                // carriage return
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

    if(load_linux) {
        console.log('Loading initrd to RAM at ' + lm32.bits.format(RAM_BASE + 0x400000));
        mmu.load_binary('../linux/initrd.img', RAM_BASE + 0x400000);
    } else {
        console.log('Loading U-Boot to RAM');
        mmu.load_binary('../linux/u-boot.bin', RAM_BASE);
    }
    mmu.load_binary('../linux/hwsetup.bin', HWSETUP_BASE);
    
    window.flash = flash;
    window.mmu = mmu;
    window.cpu = cpu;

    var f = function() {
        //console.log("Started running at pc: " + lm32.bits.format(cpu.pc));
        cpu.step(1000);
        //console.log("Finished running at pc: " + lm32.bits.format(cpu.pc));
        setTimeout(f, 0);
    }
    f();
};

