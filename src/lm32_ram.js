/**
 * RAM Memory
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 21:30
 *
 */
"use strict";

/**
 *
 * @param size the memory size in bytes
 * @param be is it big endian?
 */
lm32.RAM = function(size, be) {
    // TODO implement non-ArrayBuffer fallback version
    this.buff = new ArrayBuffer(size);
    this.v8 = new Uint8Array(this.buff);
    var i;
    // TODO remove:  not strictly necessary
    for(i = 0; i < size; i++) {
        this.v8[i] = 0xff;
    }
    if(!be) {
        // TODO implement little endian
        throw ("Little Endian is not supported for now");
    }
};

lm32.RAM.prototype.read_8 = function(offset) {
    return this.v8[offset];
};

lm32.RAM.prototype.read_16 = function(offset) {
    var hi = this.v8[offset];
    var lo = this.v8[offset + 1];
    return (hi<<8)|lo
};

lm32.RAM.prototype.read_32 = function(offset) {
    var h0 = this.v8[offset];
    var h1 = this.v8[offset + 1];
    var l0 = this.v8[offset + 2];
    var l1 = this.v8[offset + 3];
    return (h0<<24)|(h1<<16)|(l0<<8)|(l1);
};

lm32.RAM.prototype.write_8 = function(offset, value) {
    this.v8[offset] = value;
};

lm32.RAM.prototype.write_16 = function(offset, value) {
    var hi = (value & 0xff00) >> 8;
    var lo = (value & 0xff);
    this.v8[offset] = hi;
    this.v8[offset + 1] = lo;
};

lm32.RAM.prototype.write_32 = function(offset, value) {
    var h0 = (value & 0xff000000) >>> 24;
    var h1 = (value & 0x00ff0000) >> 16;
    var l0 = (value & 0x0000ff00) >> 8;
    var l1 = (value & 0x000000ff);
    this.v8[offset] = h0;
    this.v8[offset + 1] = h1;
    this.v8[offset + 2] = l0;
    this.v8[offset + 3] = l1;
};

lm32.RAM.prototype.get_mmio_handlers = function() {
    // TODO little endian version
    var handlers = {
        read_8  : this.read_8.bind(this),
        read_16 : this.read_16.bind(this),
        read_32 : this.read_32.bind(this),
        write_8 : this.write_8.bind(this),
        write_16: this.write_16.bind(this),
        write_32: this.write_32.bind(this)
    };
    return handlers;
};

