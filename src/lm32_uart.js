/**
 * Emulation of LatticeMico32 UART block.
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 * Created: 11/09/11 00:26
 *
 * With strong inspiration from QEMU's hw/lm32_uart.c
 *
 * Specification available at:
 *   http://www.latticesemi.com/documents/mico32uart.pdf
 */
"use strict";

lm32.lm32UART = function(params) {
    var bits       = lm32.bits;
    
    // parameters
    var set_irq    = params.set_irq;   // function(irq_line, irq_value)
    var irq_line   = params.irq_line; // my irq number
    var putchar    = params.putchar;  // function(int) -> writes a char
    
    // constants
    var R_RXTX = 0;
    var R_IER  = 1;
    var R_IIR  = 2;
    var R_LCR  = 3;
    var R_MCR  = 4;
    var R_LSR  = 5;
    var R_MSR  = 6;
    var R_DIV  = 7;
    var R_MAX  = 8;

    var IER_RBRI = (1<<0);
    var IER_THRI = (1<<1);
    var IER_RLSI = (1<<2);
    var IER_MSI  = (1<<3);

    var IIR_STAT = (1<<0);
    var IIR_ID0  = (1<<1);
    var IIR_ID1  = (1<<2);

    var LCR_WLS0 = (1<<0);
    var LCR_WLS1 = (1<<1);
    var LCR_STB  = (1<<2);
    var LCR_PEN  = (1<<3);
    var LCR_EPS  = (1<<4);
    var LCR_SP   = (1<<5);
    var LCR_SB   = (1<<6);

    var MCR_DTR = (1<<0);
    var MCR_RTS = (1<<1);

    var LSR_DR   = (1<<0);
    var LSR_OE   = (1<<1);
    var LSR_PE   = (1<<2);
    var LSR_FE   = (1<<3);
    var LSR_BI   = (1<<4);
    var LSR_THRE = (1<<5);
    var LSR_TEMT = (1<<6);

    var MSR_DCTS = (1<<0);
    var MSR_DSSR = (1<<1);
    var MSR_TERI = (1<<2);
    var MSR_DDCD = (1<<3);
    var MSR_CTS  = (1<<4);
    var MSR_DSR  = (1<<5);
    var MSR_RI   = (1<<6);
    var MSR_DCD  = (1<<7);

    // state
    var regs = new Array(R_MAX);
    var str_processing = '';
    var is_processing = false;

    // function implementations
    function update_irq() {
        var irq;

        if ((regs[R_LSR] & (LSR_OE | LSR_PE | LSR_FE | LSR_BI))
            && (regs[R_IER] & IER_RLSI)) {
            irq = 1;
            regs[R_IIR] = IIR_ID1 | IIR_ID0;
        } else if ((regs[R_LSR] & LSR_DR) && (regs[R_IER] & IER_RBRI)) {
            irq = 1;
            regs[R_IIR] = IIR_ID1;
        } else if ((regs[R_LSR] & LSR_THRE) && (regs[R_IER] & IER_THRI)) {
            irq = 1;
            regs[R_IIR] = IIR_ID0;
        } else if ((regs[R_MSR] & 0x0f) && (regs[R_IER] & IER_MSI)) {
            irq = 1;
            regs[R_IIR] = 0;
        } else {
            irq = 0;
            regs[R_IIR] = IIR_STAT;
        }
        set_irq(irq_line, irq);
    }

    function read_32(addr) {
        var r = 0;
        addr = addr >> 2;
        switch (addr) {
            case R_RXTX:
                r = regs[R_RXTX];
                regs[R_LSR] &= ~LSR_DR;
                update_irq();
                break;
            case R_IIR:
            case R_LSR:
            case R_MSR:
                r = regs[addr];
                break;
            case R_IER:
            case R_LCR:
            case R_MCR:
            case R_DIV:
                //console.log("lm32_uart: read access to write only register 0x" + (addr << 2).toString(16));
                break;
            default:
                //console.log("lm32_uart: read access to unknown register 0x"+ (addr << 2).toString(16));
                break;
        }
        return r;
    }

    function write_32(addr, value) {
        addr = addr >> 2;
        switch (addr) {
            case R_RXTX:
                if (putchar) {
                    putchar(bits.unsigned32(value));
                }
                break;
            case R_IER:
            case R_LCR:
            case R_MCR:
            case R_DIV:
                regs[addr] = value | 0;
                break;
            case R_IIR:
            case R_LSR:
            case R_MSR:
                //console.log("lm32_uart: write access to read only register 0x" + (addr << 2).toString(16));
                break;
            default:
                //console.log("lm32_uart: write access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        update_irq();
    }

    function can_rx() {
        return !(regs[R_LSR] & LSR_DR);
    }

    function do_rx(value) {
        if(regs[R_LSR] & LSR_DR) {
            regs[R_LSR] = regs[R_LSR] | LSR_OE;
        }

        regs[R_LSR]  = regs[R_LSR] | LSR_DR;
        regs[R_RXTX] = value & 0xff;
        update_irq();
    }

    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = 0;
        }
        regs[R_LSR] = LSR_THRE | LSR_TEMT;
        str_processing = '';
        is_processing = false;
    }

    function get_mmio_handlers() {
        var handlers = {
            read_32 : read_32,
            write_32: write_32
        };
        return handlers;

    }

    function process_str() {
        var f = function() {
            var charCode;
            if(str_processing.length == 0) {
                is_processing = false;
            } else {
                // take one char
                charCode = str_processing.charCodeAt(0);
                if(can_rx()) {
                    do_rx(charCode);
                    str_processing = str_processing.substr(1, str_processing.length - 1);
                }
                setTimeout(f, 0);
            }
        };
        f();
    }

    function send_str(str) {
        str_processing += str;
        if(!is_processing) {
            is_processing = true;
            process_str();
        }
    }

    // initialization:
    reset();

    // publication:
    return {
        iomem_size: 4 * R_MAX,
        can_rx: can_rx,
        do_rx: do_rx,
        get_mmio_handlers: get_mmio_handlers,
        process_str: process_str,
        send_str: send_str,
        reset: reset,
        update_irq: update_irq
    };
};
