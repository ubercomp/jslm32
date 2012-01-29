/**
 * Javascript PIC Controller;
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 08/12/11 02:24
 */
"use strict";
lm32.lm32Pic = function(cpu_irq_handler) {
    var im = 0;
    var ip = 0;
    var irq_state = 0;
    
    function dump() {
        return ("im=" + im + " ip=" + ip + ' irq_state=' + irq_state);
    }

    function update_irq() {
        ip |= irq_state;
        var val = ip & im ? 1: 0;
        cpu_irq_handler(val);
    }

    function irq_handler (irq, level) {
        switch(level) {
            case 0:
                irq_state &= ~(1 << irq);
                break;
            case 1:
                irq_state |= (1 << irq);
                break;
            default:
                throw 'Invalid IRQ';
                break;
        }
        update_irq();
    }

    function set_im(new_im) {
        im = new_im;
        update_irq();
    }

    function set_ip(new_ip) {
        /* ack interrupt */
        ip &= ~new_ip;
        update_irq();
    }


    function get_im() {
        return im;
    }
    
    function get_ip() {
        return ip;
    }

    return {
        dump: dump,
        get_im: get_im,
        set_im: set_im,
        get_ip: get_ip,
        set_ip: set_ip,
        irq_handler: irq_handler
    };
};
