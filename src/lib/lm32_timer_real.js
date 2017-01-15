/**
 * LatticeMico32 timer emulation.
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 *
 * With strong inspiration from QEMU's hw/lm32_timer.c
 *
 * Specification available at:
 *   http://www.latticesemi.com/documents/mico32timer.pdf
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

lm32.lm32TimerReal = function(params) {
    // dependencies
    var bits = lm32.bits;

    // parameters
    var id = params.id;
    var set_irq  =  params.set_irq;  // function(irq_line, irq_value)
    var irq_line =  params.irq_line; // my irq number
    var frequency = params.frequency || 50000000;


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

    // state
    var regs = new Array(R_MAX);
    var timeout = false;
    var timeout_started = (new Date()).getTime();

    function update_irq() {
        // the line below works only because ITO is the LSB
        var state = (regs[R_SR] & SR_TO) && (regs[R_CR] & CR_ITO);
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
                r = regs[addr];
                break;
            case R_SNAPSHOT:
                fix_snapshot_reg();
                r = regs[addr];
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
                    regs[R_SR] |= SR_TO;
                } else {
                    regs[R_SR] &= ~SR_TO;
                }
                break;
            case R_CR:
                regs[R_CR] = value;
                if((value & CR_START) != 0) {
                    regs[R_SR] |= SR_RUN;
                    start_running();
                }
                if((value & CR_STOP) != 0) {
                    regs[R_SR] &= ~SR_RUN;
                    fix_snapshot_reg();
                    stop_running();
                }
                break;
            case R_PERIOD:
                if(value < 0) {
                    throw ('timer' + id + 'bad period ' + value);
                } else {
                    regs[addr] = value;
                    regs[R_SNAPSHOT] = value;
                }
                break;
            case R_SNAPSHOT:
                //console.log("lm32_timer: write access to read only register 0x" + (addr << 2).toString(16));
                break;
            default:
                //console.log("lm32_timer: write access to unknown register 0x" + (addr << 2).toString(16));
                break;
        }
        update_irq();
    }

    function get_timeout_ms() {
        return Math.round((regs[R_PERIOD] * 1000) / frequency);
    }

    function timeout_hit() {
        // timeout:
        regs[R_SR] |= SR_TO;
        // snapshot is period:
        regs[R_SNAPSHOT] = regs[R_PERIOD];
        if((regs[R_CR] & CR_CONT) == 0) {
            // not continuous, stop running
            regs[R_SR] &= ~SR_RUN;
        } else {
            start_running();
        }
        update_irq();
    }

    function start_running() {
        timeout_started = (new Date()).getTime();
        timeout = setTimeout(timeout_hit, get_timeout_ms());
    }

    function stop_running() {
        clearTimeout(timeout);
    }

    function fix_snapshot_reg() {
        if(regs[R_SR] & SR_RUN) {
            var time_now = (new Date()).getTime();
            var delta = time_now - timeout_started;
            regs[R_SNAPSHOT] = Math.round(regs[R_PERIOD]*(1 - delta/get_timeout_ms()));
        }
        if(regs[R_SNAPSHOT] < 0) {
            regs[R_SNAPSHOT] = Math.round(regs[R_PERIOD]*Math.random());
        }

    }

    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = 0;
        }
    }

    function get_mmio_handlers() {
        var handlers = {
            read_32: read_32,
            write_32: write_32
        };
        return handlers;
    }

    //initialization:
    reset()
    // publication:
    return {
        iomem_size: 4 * R_MAX,
        get_mmio_handlers: get_mmio_handlers,
        on_tick: function(x){},//on_tick,
        reset: reset,
        update_irq: update_irq
    };
};

