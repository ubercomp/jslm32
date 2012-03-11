/**
 * System Starter
 * Copyright (c) 2011, 2012 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 20:22
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
lm32.start_uclinux = function(console_putchar_fn) {
    var CPU_FREQ = 4000000; // TODO make it a parameter?

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

    var UART1_BASE = 0x81000000;
    var UART1_IRQ = 2;

    var JSLIBC_DEV_BASE = 0x82000000;

    var HWSETUP_BASE = 0x0bffe000;
    var CMDLINE_BASE = 0x0bfff000;
    var INITRD_BASE = 0x08400000;

    var EBA_BASE = RAM_BASE;
    var DEBA_BASE = RAM_BASE;
    var BOOT_PC = RAM_BASE;
    var KERNEL_BASE = RAM_BASE;

    var mmu = lm32.mmu();
    var ram = lm32.ram(RAM_SIZE, true);

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
        set_irq: set_irq,
        frequency: CPU_FREQ
    });

    //var timer1 = lm32.lm32Timer({
    //    id: 1,
    //    irq_line: TIMER1_IRQ,
    //    set_irq: set_irq,
    //    frequency: CPU_FREQ
    //});

    //var timer2 = lm32.lm32Timer({
    //    id: 2,
    //    irq_line: TIMER2_IRQ,
    //    set_irq: set_irq,
    //    frequency: CPU_FREQ
    //});

    // UART and Terminal

    var uart0 = lm32.lm32UART({
        putchar: console_putchar_fn,
        irq_line: UART0_IRQ,
        set_irq: set_irq
    });

    var uart1 = lm32.lm32UART({
        putchar: function(c) { /*console.log('uart1 putchar: ' + String.fromCharCode(c));*/ },
        irq_line: UART1_IRQ,
        set_irq: set_irq
    });

    var libc_dev = lm32.libc_dev(mmu, ram.v8, RAM_BASE, RAM_SIZE);

    var send_str = uart0.send_str;

    hw = null;
    
    // Gluing everything together
    mmu.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
    mmu.add_memory(JSLIBC_DEV_BASE, libc_dev.iomem_size, libc_dev.get_mmio_handlers());
    mmu.add_memory(UART0_BASE, uart0.iomem_size, uart0.get_mmio_handlers());
    mmu.add_memory(UART1_BASE, uart1.iomem_size, uart1.get_mmio_handlers());
    mmu.add_memory(TIMER0_BASE, timer0.iomem_size, timer0.get_mmio_handlers());
    //mmu.add_memory(TIMER1_BASE, timer1.iomem_size, timer1.get_mmio_handlers());
    //mmu.add_memory(TIMER2_BASE, timer2.iomem_size, timer2.get_mmio_handlers());

    var hw = lm32.lm32_hwsetup();
    hw.add_cpu("LM32", CPU_FREQ);
    hw.add_ddr_sdram("ddr_sdram", RAM_BASE, RAM_SIZE);
    hw.add_timer("timer0", TIMER0_BASE, TIMER0_IRQ);
    // hw.add_timer("timer1_dev_only", TIMER1_BASE, TIMER1_IRQ);
    // hw.add_timer("timer2_dev_only", TIMER2_BASE, TIMER2_IRQ);
    hw.add_uart("uart0", UART0_BASE, UART0_IRQ);
    hw.add_uart("uart1", UART1_BASE, UART1_IRQ);
    hw.add_trailer();

    mmu.load_binary('../linux/vmlinux.bin', KERNEL_BASE);
    var initrd_size = mmu.load_binary('../linux/romfs.ext2', INITRD_BASE);

    mmu.write_str(CMDLINE_BASE, "root=/dev/ram0 console=ttyS0,115200 ramdisk_size=16384");

    var hwsetup_data = hw.get_data();
    mmu.write_array_data(HWSETUP_BASE, hwsetup_data, hwsetup_data.length);

    cpu.cs.pc = KERNEL_BASE;
    cpu.cs.regs[1] = HWSETUP_BASE;
    cpu.cs.regs[2] = CMDLINE_BASE;
    cpu.cs.regs[3] = INITRD_BASE;
    cpu.cs.regs[4] = INITRD_BASE + initrd_size;

    cpu.set_timers([timer0]);//, timer1, timer2]);
    return {
        cpu: cpu,
        step: cpu.step,
        step_forever: cpu.step_forever,
        console_send_str: send_str
    };
};

lm32.start_evr = function(console_putchar_fn, kernel_file_name) {
    var CPU_FREQ = 75000000;
    var RAM_BASE = 0x08000000;
    var RAM_SIZE = 64 * 1024 * 1024;

    var UART0_BASE  = 0x80006000;
    var UART0_IRQ   = 0;

    var TIMER0_BASE = 0x80002000;
    var TIMER0_IRQ  = 1;

    var TIMER1_BASE = 0x8000a000;
    var TIMER1_IRQ  = 3;

    var FB_BASE = 0x8000e000;

    var EBA_BASE, DEBA_BASE, BOOT_PC, KERNEL_BASE;
    EBA_BASE = DEBA_BASE = BOOT_PC = RAM_BASE;
    KERNEL_BASE = RAM_BASE;

    var mmu = lm32.mmu();
    var ram = lm32.ram(RAM_SIZE, true);

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
        set_irq: set_irq,
        frequency: CPU_FREQ
    });

    var timer1 = lm32.lm32Timer({
        id: 1,
        irq_line: TIMER1_IRQ,
        set_irq: set_irq,
        frequency: CPU_FREQ
    });

    var uart0 = lm32.lm32UART({
        putchar: console_putchar_fn,
        irq_line: UART0_IRQ,
        set_irq: set_irq,
        frequency: CPU_FREQ
    });
    uart0.set_echo(true);
    var send_str = uart0.send_str;

    var fb0 = lm32.lm32_frame_buffer('frameBuffer', mmu, ram, RAM_BASE, RAM_SIZE);



    mmu.add_memory(RAM_BASE, RAM_SIZE, ram.get_mmio_handlers());
    mmu.add_memory(UART0_BASE, uart0.iomem_size, uart0.get_mmio_handlers());
    mmu.add_memory(TIMER0_BASE, timer0.iomem_size, timer0.get_mmio_handlers());
    mmu.add_memory(TIMER1_BASE, timer1.iomem_size, timer1.get_mmio_handlers());
    mmu.add_memory(FB_BASE, fb0.iomem_size, fb0.get_mmio_handlers());

    mmu.load_binary(kernel_file_name, KERNEL_BASE);

    cpu.cs.pc = KERNEL_BASE;
    cpu.set_timers([timer0, timer1]);

    return {
        cpu: cpu,
        step: cpu.step,
        step_forever: cpu.step_forever,
        console_send_str: send_str
    };
};
