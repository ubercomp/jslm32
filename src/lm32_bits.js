/**
 * Bit operation utilities
 * 
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 10/09/11 17:21
 */
"use strict";
lm32.bits = {};

lm32.bits.mask26_31 = 0xfc000000;
lm32.bits.mask21_25 = 0x03e00000;
lm32.bits.mask16_20 = 0x001f0000;
lm32.bits.mask11_15 = 0x0000f800;
lm32.bits.mask00_31 = 0xffffffff;
lm32.bits.mask00_25 = 0x03ffffff;
lm32.bits.mask00_15 = 0x0000ffff;

lm32.bits.sign_extend_8_32 = function(n) {
    var n8 = n & 0xff; // mask00_07
    var mask_7_7 = 0x80;
    if((n8 & mask_7_7) !== 0) {
        n8 = n8 | 0xfffffff0;
    }
    return n8;
};

lm32.bits.sign_extend_16_32 = function(n) {
    // extends a 16 bit value to 32 bits, preserving sign
    var n16 = n & 0xffff; // mask_00_15
    var mask_15_15 = 0x8000;
    if((n16 & mask_15_15) !== 0) {
        n16 = n16 | 0xffff0000; // mask_16_31
    }
    return n16;
};

lm32.bits.sign_extend_18_32 = function(n) {
    // extends a 18 bit value to 32 bits, preserving sign
    var n18 = n & 0x3ffff; // mask_00_17
    var mask_17_17 = 0x20000;
    if((n18 & mask_17_17) !== 0) { // number is negative
        n18 = n18 | 0xfffc0000;
    }
    return n18;
};

lm32.bits.sign_extend_28_32 = function(n) {
    // extends a 28 bit value to 32 bits, preserving sign
    var n28 = n & 0xfffffff; // mask_00_27
    var mask_27_27 = 0x8000000;
    if((n28 & mask_27_27) !== 0) { // negative
        n28 = n28 | 0xf0000000;
    }
    return n28;
};

lm32.bits.unsigned32 = function(n) {
    // gets the unsigned 32 bit value of the number
    var s32 = n & 0xffffffff; // signed n value
    var u32 = s32;
    if(s32 < 0) {
        // number was negative -> add
        var mag = u32 & 0x7fffffff; // mask_00_30
        u32 = mag + 0x80000000;
    }
    return u32;
};

lm32.bits.zero_extend_8_32 = function(n) {
    return (n & 0x0000000f);
};

lm32.bits.zero_extend_16_32 = function(n) {
    // extends a 16 bit value to 32 bits, using zeros
    return (n & 0x0000ffff);
};

lm32.bits.rmsr = function(dword, mask, bits) {
    // read masked and shift right
    return (dword&mask)>>bits;
};

// read masked and shift (unsigned) right
lm32.bits.rmsr_u = function(dword, mask, bits) {
    // params: dword (a 32 bit value)
    // mask: a 32 bit mask
    // the number of bits to shift right
    return (dword&mask)>>>bits;
};
