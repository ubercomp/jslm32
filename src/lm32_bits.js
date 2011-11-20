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

lm32.bits.zero_extend = function(val, width) {
    return val & ((1 << width) - 1);
};

lm32.bits.sign_extend = function(val, width) {
    var sval;
    /* LSL.  */
    val <<= 32 - width;
    sval = val;
    /* ASR.  */
    sval >>= 32 - width;
    return sval;
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
