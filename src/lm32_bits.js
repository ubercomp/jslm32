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

lm32.bits.format = function(n) {
    var u32 = lm32.bits.unsigned32(n);
    var u32s = u32.toString(16);
    var pad = (new Array(8 - u32s.length + 1)).join('0');
    return "0x" + pad + u32s;
}

// Count trailing zeroes of a 32 bits quantity
lm32.bits.ctz32 = function(n) {
    n = lm32.bits.unsigned32(n);
    if(n == 0) {
        return 32;
    }

    var ret = 0;
    if (!(n & 0xFFFF)) {
        ret += 16;
        n = n >> 16;
    }
    if (!(n & 0xFF)) {
        ret += 8;
        n = n >> 8;
    }
    if (!(n & 0xF)) {
        ret += 4;
        n = n >> 4;
    }
    if (!(n & 0x3)) {
        ret += 2;
        n = n >> 2;
    }
    if (!(n & 0x1)) {
        ret++;
    }
    return ret;
};

// Cound leading zeros of a 32 bits quantity
lm32.bits.clz32 = function(val) {
    val = val | 0;
    var cnt = 0;

    if (!(val & 0xffff0000)) {
        cnt += 16;
        val <<= 16;
    }
    if (!(val & 0xff000000)) {
        cnt += 8;
        val <<= 8;
    }
    if (!(val & 0xf0000000)) {
        cnt += 4;
        val <<= 4;
    }
    if (!(val & 0xc0000000)) {
        cnt += 2;
        val <<= 2;
    }
    if (!(val & 0x80000000)) {
        cnt++;
        val <<= 1;
    }
    if (!(val & 0x80000000)) {
        cnt++;
    }
    return cnt;
};

