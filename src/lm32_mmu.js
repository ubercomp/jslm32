/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 10/09/11 18:10
 */
"use strict";

lm32.MMU = function() {
    this.handlers = [];
}

lm32.MMU.prototype.get_handler_for = function(addr) {
    var handler = undefined;
    var len = this.handlers.length;
    for(var i = 0; i < len; i++) {
        var curr = this.handlers[i];
        if(addr >= curr.base && addr < curr.base + curr.size) {
            handler = curr;
        }
    }
    if (handler === undefined) {
        throw("ERROR: No handler for address " + addr.toString(16));
    }
}

lm32.MMU.prototype.add_memory = function(base, size, funcs) {
    // TODO check errors (handlers cannot overlap)
    if( (base < 0) || (size < 1) || ((base + size) > 0xffffffff) ) {
        throw ("ERROR: Invalid base and size parameters")
    }
    var len = this.handlers.length;
    for(var i = 0; i < len; i++) {
        var curr = this.handlers[i];
        if(lm32.util.overlaps(base, base + size - 1, curr.base_addr, curr.base_addr + curr.size - 1)) {
            var ctext = "(base_addr = " + curr.base_addr.toString(16) + ", size = " + curr.size.toString(16) + ")";
            var ttext = "(base_addr = " + base.toString(16) + ", size = " + size.toString(16) + ")";
            throw("ERROR: Bank at " + ttext + " overlaps with " + ctext + ".");
        }
    }

    var h = {};
    h.base_addr = base;
    h.size = size;
    if(funcs.read_8)   { h.read_8 = funcs.read_8};
    if(funcs.read_16)  { h.read_8 = funcs.read_16};
    if(funcs.read_32)  { h.read_8 = funcs.read_32};
    if(funcs.write_8)  { h.read_8 = funcs.write_8};
    if(funcs.write_16) { h.read_8 = funcs.write_16};
    if(funcs.write_32) { h.read_8 = funcs.write_32};
    this.handlers.push(funcs);

}

lm32.MMU.prototype.read_8 = function(addr) {
    var handler = this.get_handler_for(addr);
    var offset = addr - handler.base_addr;
    return (handler.read_8(offset) & 0xff);
};

lm32.MMU.prototype.read_16 = function(addr) {
    var handler = this.get_handler_for(addr);
    var offset = addr - handler.base_addr;
    return (handler.read_16(offset) & 0xffff);

};

lm32.MMU.prototype.read_32 = function(addr) {
    var handler = this.get_handler_for(addr);
    var offset = addr - handler.base_addr;
    return (handler.read_32(offset) & 0xffffffff);

};

lm32.MMU.prototype.write_8 = function(addr, val) {
    var handler = this.get_handler_for(addr);
    var offset = addr = handler.base_addr;
    var sval = val & 0xff; // safe
    handler.write_8(offset, sval);
}

lm32.MMU.prototype.write_16 = function(addr, val) {
    var handler = this.get_handler_for(addr);
    var offset = addr = handler.base_addr;
    var sval = val & 0xffff; // safe
    handler.write_16(offset, sval);
}

lm32.MMU.prototype.write_32 = function(addr, val) {
    var handler = this.get_handler_for(addr);
    var offset = addr = handler.base_addr;
    var sval = val & 0xffffffff; // safe
    handler.write_32(offset, sval);
}