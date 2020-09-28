/**
 *
 * RAM Memory
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
/**
 *
 * @param size the memory size in bytes
 */
lm32.ram = function(size) {
    var buff = new ArrayBuffer(size);
    var v8 = new Uint8Array(buff);
    var dv = new DataView(buff);

    var read_8 = function(offset) {
        return v8[offset];
    };

    var read_16 = function(offset) {
        return dv.getUint16(offset);
    };

    var read_32 = function(offset) {
        return dv.getUint32(offset);

    };

    var write_8 = function(offset, value) {
        v8[offset] = (value & 0xff);;

    };

    var write_16 = function(offset, value) {
        dv.setUint16(offset, value)

    };

    var write_32 = function(offset, value) {
        dv.setUint32(offset, value);

    };

    var get_mmio_handlers = function() {
        var handlers = {
            read_8  : read_8,
            read_16 : read_16,
            read_32 : read_32,
            write_8 : write_8,
            write_16: write_16,
            write_32: write_32
        };
        return handlers;
    };

    return {
        v8: v8,
        dv: dv,
        read_8: read_8,
        read_16: read_16,
        read_32: read_32,
        write_8: write_8,
        write_16: write_16,
        write_32: write_32,
        get_mmio_handlers: get_mmio_handlers
    }
}
