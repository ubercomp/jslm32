/**
 * Javascript PIC Controller;
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 08/12/11 02:24
 */
"use strict";
lm32.lm32Pic = function(cpu_irq_handler) {
    var state = {ip: 0, im: 0, irq_state: 0};

    function dump() {
        return ("im=" + state.im + " ip=" + state.ip + ' irq_state=' + state.irq_state);
    }

    function update_irq() {
        state.ip |= state.irq_state;
        var val = state.ip & state.im ? 1: 0;
        cpu_irq_handler(val);
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
