/**
 *
 * LatticeMico32 timer emulation.
 *
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 *
 * With strong inspiration from QEMU's hw/lm32_timer.c
 *
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

lm32.timer = function(params) {
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

    // state
    var regs = new Int32Array(R_MAX);
    var timeout_id = null;
    var timeout_ms = null;
    var last_start_time_ms = 0;
    var last_stop_time_ms = 0;

    function update_irq() {
        // the line below works only because ITO is the LSB
        var state = (regs[R_SR] & SR_TO) && (regs[R_CR] & CR_ITO);
        set_irq(irq_line, state);
        return state;
    }



    function start_timeout() {
        if (regs[R_SR] & SR_RUN) {
            timeout_ms = Math.round((1000 * regs[R_PERIOD])/ params.frequency);
            last_start_time_ms = performance.now();
            timeout_id = setTimeout(hit, timeout_ms);
        }
    }


    function stop_timeout() {
        if (timeout_id !== null) {
            clearTimeout(timeout_id);
            timeout_id = null;
            last_stop_time_ms = performance.now();
        }

    }

    function read_32(addr) {
        var i = addr >> 2;

        // update snapshot / estimate
        if (i == R_SNAPSHOT) {
            if (regs[R_SR] & SR_RUN) {
                // running, estimate from last period
                var delta = performance.now() - last_start_time_ms;
                regs[R_SNAPSHOT] =
                    Math.round(regs[R_PERIOD]*(1.0 - (delta / timeout_ms)));
                if (regs[R_SNAPSHOT] < 0) {
                    regs[R_SNAPSHOT] = 0;
                }
            }
        }
        return regs[i];
    }

    function write_32(addr, value) {
        addr = addr >> 2;
        value = value | 0;
        switch (addr) {
            case R_SR:
            if (value & SR_TO) {
                    regs[R_SR] |= SR_TO;
                } else {
                    regs[R_SR] &= ~SR_TO;
                }
                break;
            case R_CR:
                regs[R_CR] = value;
                if (value & CR_START) {
                    regs[R_SR] |= SR_RUN;
                    start_timeout();
                }

                if (value & CR_STOP) {
                    regs[R_SR] &= ~SR_RUN;
                    stop_timeout();
                }
                break;
            case R_PERIOD:
                if (value < 0) {
                    throw ('timer' + id + 'bad period ' + value);
                } else {
                    regs[R_PERIOD] = value;
                    regs[R_SNAPSHOT] = value;
                    start_timeout();
                }
                break;
            case R_SNAPSHOT:
            default:
                break;
        }
        update_irq();
    }

    function hit() {
        // timeout
        regs[R_SR] = regs[R_SR] | SR_TO;

        // when counter is zero, snapshot is updated, regardless of CR_CONT
        regs[R_SNAPSHOT] = regs[R_PERIOD];

        if (!(regs[R_CR] & CR_CONT)) {
            // not continuous, stop running
            regs[R_SR] &= ~SR_RUN;
            stop_timeout();
        } else {
            start_timeout();
        }
        update_irq();
    }

    function reset() {
        for (var i = 0; i < R_MAX; i++) {
            regs[i] = 0;
            stop_timeout();
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
        reset: reset,
        update_irq: update_irq
    };
};
