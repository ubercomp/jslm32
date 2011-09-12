/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 02:53
 */
"use strict";

lm32.Lm32Interrupts = function() {
    this.irq_line = new Array(32);
    var dummy_handler = function() {
        return {
            handle_it: function() {},
            is_pending: function() { return false; }
        }
    };
    
    for(var i = 0; i < 32; i++) {
        var d = dummy_handler();
        this.add_line(i, d);
    }
};

lm32.Lm32Interrupts.prototype.add_line = function(irq, line) {
    if(irq < 0 && irq > 31) {
        throw ("Invalid IRQ: " + irq);
    }
    this.irq_line[irq] = {
        handle_it:  line.handle_it,
        is_pending: line.is_pending
    };
};

