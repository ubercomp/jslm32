/**
 * Bit operation utilities
 * 
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 *
 * This Javascript code is free software; you can redistribute it
 * and/or modify it under the terms of the GNU Lesser General Public
 * License, version 2.1, as published by the Free Software Foundation.
 *
 * This code is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this code; if not, see
 * <http://www.gnu.org/licenses/lgpl-2.1.html>
 */
"use strict";
lm32.bits = {};

lm32.bits.format = function(n) {
    var u32 = n>>>0;
    var u32s = u32.toString(16);
    var pad = (new Array(8 - u32s.length + 1)).join('0');
    return "0x" + pad + u32s;
}

// Count trailing zeroes of a 32 bits quantity
lm32.bits.ctz32 = function(n) {
    n >>>= 0;
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

