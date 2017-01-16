/**
 * Javascript PIC Controller;
 *
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
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
lm32.lm32Pic = function() {
    var state = {ip: 0, im: 0, irq_state: 0};

    function dump() {
        return ("im=" + state.im + " ip=" + state.ip + ' irq_state=' + state.irq_state);
    }

    function update_irq() {
        state.ip |= state.irq_state;
    }

    function irq_handler (irq, level) {
        switch(level) {
            case 0:
                state.irq_state &= ~(1 << irq);
                break;
            case 1:
                state.irq_state |= (1 << irq);
                break;
            default:
                throw 'Invalid IRQ';
                break;
        }
        update_irq();
    }

    function set_im(new_im) {
        state.im = new_im;
        update_irq();
    }

    function set_ip(new_ip) {
        /* ack interrupt */
        state.ip &= ~new_ip;
        update_irq();
    }


    function get_im() {
        return state.im;
    }

    function get_ip() {
        return state.ip;
    }

    return {
        dump: dump,
        get_im: get_im,
        set_im: set_im,
        get_ip: get_ip,
        set_ip: set_ip,
        state: state,
        irq_handler: irq_handler
    };
};
