/**
 * Javascript PIC Controller;
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 08/12/11 02:24
 */
"use strict";
lm32.Lm32Pic = function(cpu_irq_handler) {
    var self = this;
    self.im = 0;
    self.ip = 0;
    self.irq_state = 0;
    
    function dump() {
        return ("im=" + self.im + " ip=" + self.ip + ' irq_state=' + self.irq_state);
    }
    self.dump = dump;

    function update_irq() {
        self.ip |= self.irq_state;

        if (self.ip & self.im) {
            cpu_irq_handler(1);
        } else {
            cpu_irq_handler(0);
        }
    }

    function irq_handler (irq, level) {
        switch(level) {
            case 0:
                self.irq_state &= ~(1 << irq);
                break;
            case 1:
                self.irq_state |= (1 << irq);
                break;
            default:
                throw 'Invalid IRQ';
                break;
        }
        update_irq();
    }
    self.irq_handler = irq_handler;

    function set_im(im) {
        self.im = im;
        update_irq();
    }
    self.set_im = set_im;

    function set_ip(ip) {
        /* ack interrupt */
        self.ip &= ~ip;
        update_irq();
    }
    self.set_ip = set_ip;

    function get_im() {
        return self.im;
    }
    self.get_im = get_im;

    function get_ip() {
        return self.ip;
    }
    self.get_ip = get_ip;
};
