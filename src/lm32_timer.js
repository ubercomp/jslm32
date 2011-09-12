/**
 * LatticeMico32 timer emulation.
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 00:26
 *
 * With strong inspiration from QEMU's hw/lm32_timer.c
 *
 * Specification available at:
 *   http://www.latticesemi.com/documents/mico32timer.pdf
 */
"use strict";

lm32.Lm32Timer = function(params) {
    var bits = lm32.bits;

    // parameters
    var ptimer   = params.ptimer ;  // has methods get_count(), set_count(int), run(int) and stop()
    var set_irq  = params.set_irq;  // function(irq_line, irq_value)
    var irq_line = params.irq_line; // my irq number

    // constants
    var R_SR       = 0;
    var R_CR       = 1;
    var R_PERIOD   = 2;
    var R_SNAPSHOT = 3;
    var R_MAX      = 4;

    var SR_TO  = (1 << 0);
    var SR_RUN = (1 << 1);

    var CR_ITO   = (1 << 0);
    var CR_CONT  = (1 << 1);
    var CR_START = (1 << 2);
    var CR_STOP  = (1 << 3);

    function update_irq() {
        var state = (this.regs[R_SR] & SR_TO) && (this.regs[R_CR] & CR_ITO);
        set_irq(irq_line, state);
    }

    function read_32(addr) {
        var r = 0;
        addr = addr >> 2;

        switch (addr) {
            case R_SR:
            case R_CR:
            case R_PERIOD:
                r = this.regs[addr];
                break;
            case R_SNAPSHOT:
                r = ptimer.get_count();
                break;
            default:
                lm32.util.error_report("lm32_timer: read access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        return r;
    }

    function write_32(addr, value) {
        addr = addr >> 2;

        switch (addr) {
            case R_SR:
                this.regs[R_SR] &= ~SR_TO;
                break;
            case R_CR:
                this.regs[R_CR] = value & bits.mask00_31;
                if (this.regs[R_CR] & CR_START) {
                    ptimer.run(1);
                }
                if (this.regs[R_CR] & CR_STOP) {
                    ptimer.stop();
                }
                break;
            case R_PERIOD:
                this.regs[R_PERIOD] = value & bits.mask00_31;
                ptimer.set_count(value);
                break;
            case R_SNAPSHOT:
                lm32.util.error_report("lm32_timer: write access to read only register 0x" + (addr << 2).toString(16));
                break;
            default:
                lm32.util.error_report("lm32_timer: write access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        update_irq();
    }

    function hit() {
        this.regs[R_SR] = this.regs[R_SR] | SR_TO;

        if(this.regs[R_CR] & CR_CONT) {
            ptimer.set_count(this.regs[R_PERIOD]);
            ptimer.run(1);
        }

        update_irq();
    }

    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            this.regs[i] = 0;
        }
        ptimer.stop();
    }

    function iomem_size() {
        return 4*R_MAX;
    }

    // TODO lm32_timer_init -> de onde vem o BH?
    

    // publication:
    this.regs = new Array(R_MAX);
    reset();
    this.iomem_size = iomem_size();
    this.update_irq = update_irq;
    this.read_32    = read_32;
    this.write_32   = write_32;
    this.reset      = reset;

};

