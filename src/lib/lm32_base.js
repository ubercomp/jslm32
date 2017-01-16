/**
 * Copyright (c) 2011-2012, 2016-2017 Reginaldo Silva (reginaldo@ubercomp.com)
 *
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
var lm32 = {};

lm32.util = {};

lm32.util.format = function(n) {
    var u32 = n>>>0;
    var u32s = u32.toString(16);
    var pad = (new Array(8 - u32s.length + 1)).join('0');
    return "0x" + pad + u32s;
};

lm32.util.overlaps = function(a, b, c, d) {
    // does the interval [a, b] overlap with [c, d] ?
    var before = (a < c) && (b < c);
    var after = (a > d) && (b > d);
    return !(before || after);
};
