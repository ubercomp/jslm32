/**
 * Big Endian RAM Memory
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 11/09/11 21:30
 *
 */
"use strict";

lm32.RAM = function(size) {
    this.buff = new ArrayBuffer(size);
    this.v8 = new Uint8Array(this.buff);
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