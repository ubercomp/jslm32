/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 10/09/11 17:35
 */
"use strict";
var lm32 = lm32 || {}; // lm32 base

lm32.util = lm32.util || {};

lm32.util.beget = function(obj) {
    var F = function() { };
    F.prototype = obj;
    return new F();
}

lm32.util.overlaps = function(a, b, c, d) {
    // does the interval [a, b] overlap with [c, d] ?
    var before = (a < c) && (b < c);
    var after = (a > d) && (b > d);
    return !(before || after);
}
    
