/**
 * Generic hardware I don't know where to put
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 23/11/11 09:15
 */
"use strict";

lm32.ghw = {};

lm32.ghw.get_ticks_per_sec = function() {
    // TODO what's the proper value?
    return 1000000000;
};

lm32.ghw.VMClock = function() {
};

lm32.ghw.VMClock.prototype.get_clock_ns = function() {
    var a = new Date();
    return a.getTime() * 1000000;
};



// TODO check implementation
lm32.ghw.Timer_NS = function(clock, on_timer) {
    this.clock = clock;
    this.on_timer = on_timer; // call this when timer ticks
    this.stopped = false;
};

lm32.ghw.Timer_NS.prototype.mod = function(time) {
    if(this.stopped) {
        return;
    }

    var diff = time - this.clock.get_clock_ns();
    if(diff < 0) {
        // should already be triggered
        this.on_timer();
    } else {
        var timeout = diff / 1000000; // nanosseconds to milisseconds
        var f = function() {
            this.on_timer();
        }
        setTimeout(f.bind(this), timeout);
    }
};

lm32.ghw.Timer_NS.prototype.stop = function() {
    this.stopped = true;
};


// PTimer
lm32.ghw.PTimer = function(on_trigger, vm_clock) {
    this.enabled = 0; // 0 = disabled, 1 = periodic, 2 = oneshot
    this.limit = 0;
    this.delta = 0;
    this.period_frac = 0;
    this.period = 1;
    this.last_event = 0;
    this.next_event = 0;
    this.on_trigger = on_trigger;
    this.vm_clock = vm_clock;
    this.timer = new lm32.ghw.Timer_NS(vm_clock, this.tick.bind(this));
};

lm32.ghw.PTimer.prototype.trigger = function() {
    (this.on_trigger)();
};

lm32.ghw.PTimer.prototype.reload = function() {
    if(this.delta == 0) {
        this.trigger();
        this.delta = this.limit;
    }

    if(this.delta == 0 || this.period == 0) {
        this.enabled = 0;
        return;
    }
    this.last_event = this.next_event;
    this.next_event = this.last_event + this.delta * this.period;
    this.timer.mod(this.next_event);

};

lm32.ghw.PTimer.prototype.tick = function () {
    this.trigger();
    this.delta = 0;
    if(this.enabled == 2) {
        this.enabled = 0;
    } else {
        this.reload();
    }
};

lm32.ghw.PTimer.prototype.get_count = function() {
    var now;
    var counter;

    if(this.enabled) {
        now = this.vm_clock.get_clock_ns();
        /* Figure out the current counter value. */
        if( (now - this.next_event > 0) ||
            (this.period == 0) ) {
            /* Prevent underflowing if it should already have triggered */
            counter = 0;
        } else {
            var rem, div, clz1, clzw, shift;
            rem = this.next_event - now;
            div = this.period;

            // TODO maybe this division is not precise enough
            counter = Math.floor(rem/div);
        }
    } else {
        counter = this.delta;
    }
    return counter;
};

lm32.ghw.PTimer.prototype.set_count = function(count) {
    this.delta = count;
    if(this.enabled) {
        this.next_event = this.vm_clock.get_clock_ns();
        this.reload();
    }
};

lm32.ghw.PTimer.prototype.run = function(oneshot) {
    if(this.enabled) {
        return;
    }
    if(this.period == 0) {
        console.log("Timer with period zero, disabling");
    }

    this.enabled = oneshot? 2: 1;
    this.next_event = this.vm_clock.get_clock_ns();
    this.reload();
};

lm32.ghw.PTimer.prototype.stop = function() {
    if(!this.enabled) {
        return;
    }
    this.delta = this.get_count();
    this.timer.stop();
    this.enabled = 0;
};

// set_period et al are not implemented (not used)

