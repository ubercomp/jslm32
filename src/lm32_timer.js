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
    var id = params.id;
    var set_irq  = params.set_irq;  // function(irq_line, irq_value)
    var irq_line = params.irq_line; // my irq number

    // constants
    var R_SR       = 0; // status register
    var R_CR       = 1; // control register
    var R_PERIOD   = 2; // period register
    var R_SNAPSHOT = 3; // snapshot register
    var R_MAX      = 4;

    var SR_TO  = (1 << 0); // time out
    var SR_RUN = (1 << 1); // running

    var CR_ITO   = (1 << 0); // interrupt
    var CR_CONT  = (1 << 1); // continuous?
    var CR_START = (1 << 2); // start?
    var CR_STOP  = (1 << 3); // stop?

    function update_irq() {
        // this works only because ITO is the LSB
        var state = (this.regs[R_SR] & SR_TO) && (this.regs[R_CR] & CR_ITO);
        set_irq(irq_line, state);
        return state;
    }

    function read_32(addr) {
        var r = 0;
        addr = addr >> 2;

        switch (addr) {
            case R_SR:
            case R_CR:
            case R_PERIOD:
            case R_SNAPSHOT:
                r = this.regs[addr];
                break;
            default:
                r = 0;
                //console.log("lm32_timer: read access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        return r;
    }

    function write_32(addr, value) {
        addr = addr >> 2;
        value = value | 0;
        switch (addr) {
            case R_SR:
                if(value & SR_TO) {
                    this.regs[R_SR] |= SR_TO;
                } else {
                    this.regs[R_SR] &= ~SR_TO;
                }
                break;
            case R_CR:
                this.regs[R_CR] = value;
                if((value & CR_START) != 0) {
                    this.regs[R_SR] |= SR_RUN;
                }
                if((value & CR_STOP) != 0) {
                    this.regs[R_SR] &= ~SR_RUN;
                }
                break;
            case R_PERIOD:
                if(value < 0) {
                   throw ('timer' + id + 'bad period ' + value);
                } else {
                    this.regs[addr] = value;
                    this.regs[R_SNAPSHOT] = value;
                }
                break;
            case R_SNAPSHOT:
                //console.log("lm32_timer: write access to read only register 0x" + (addr << 2).toString(16));
                break;
            default:
                //console.log("lm32_timer: write access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        this.update_irq();
    }

    function on_tick(ticks) {
        if((this.regs[R_SR] & SR_RUN)) {
            this.regs[R_SNAPSHOT] -= ticks;
            if(this.regs[R_SNAPSHOT] <= 0) {
                this.hit(-this.regs[R_SNAPSHOT]);
            }
        }

    }
    this.on_tick = on_tick;

    function hit(remainder) {
        if(remainder >= this.regs[R_PERIOD]) {
            //console.log('bad remainder. missed an entire period. run less instructions per cpu.step() call');
        }

        // timeout
        this.regs[R_SR] = this.regs[R_SR] | SR_TO;

        // when counter is zero, snapshot is updated, regardless of CR_CONT
        this.regs[R_SNAPSHOT] = this.regs[R_PERIOD];

        if((this.regs[R_CR] & CR_CONT) == 0) {
            // not continuous, stop running
            this.regs[R_SR] &= ~SR_RUN;
        }
        this.update_irq();
    }
    this.hit = hit;

    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            this.regs[i] = 0;
        }
    }
    this.reset = reset;

    // publication:
    this.regs = new Array(R_MAX);
    this.reset();
    this.iomem_size = (4 * R_MAX);
    this.update_irq = update_irq;
    this.read_32    = read_32;
    this.write_32   = write_32;
    this.reset      = reset;

};

lm32.Lm32Timer.prototype.get_mmio_handlers = function() {
    var handlers = {
        read_32 : this.read_32.bind(this),
        write_32: this.write_32.bind(this)
    };
    return handlers;
};

