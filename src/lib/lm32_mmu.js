/**
 * Basic Memory Dispatcher.
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
 * MMU
 * read functions return undefined when cannot read
 * write functions return true when write is possible, false otherwise
 */
lm32.mmu = function() {
    var handlers = [];
    var last_handler = undefined;

    var get_handler_for = function(addr) {
        if((last_handler != undefined)
            && (addr >= last_handler.base_addr)
            && (addr < last_handler.base_addr + last_handler.size)) {
            return last_handler;
        }

        var handler = undefined;
        var len = handlers.length;
        for(var i = 0; i < len; i++) {
            var curr = handlers[i];
            if((addr >= curr.base_addr) && (addr < curr.base_addr + curr.size)) {
                handler = curr;
                last_handler = handler;
            }
        }
        return handler;
    };

    var add_memory = function(base, size, funcs) {
        if( (base < 0) || (size < 1) || ((base + size) > 0xffffffff) ) {
            throw ("ERROR: Invalid base and size parameters")
        }
        var len = handlers.length;
        for(var i = 0; i < len; i++) {
            var curr = handlers[i];
            if(lm32.util.overlaps(base, base + size - 1, curr.base_addr, curr.base_addr + curr.size - 1)) {
                var ctext = "(base_addr = " + lm32.util.format(curr.base_addr) + ", size = " + lm32.util.format(curr.size) + ")";
                var ttext = "(base_addr = " + lm32.util.format(base) + ", size = " + lm32.util.format(size) + ")";
                throw("ERROR: Bank at " + ttext + " overlaps with " + ctext + ".");
            }
        }

        var h = {};
        h.base_addr = base;
        h.size = size;
        if(funcs.read_8)   { h.read_8   = funcs.read_8;   };
        if(funcs.read_16)  { h.read_16  = funcs.read_16;  };
        if(funcs.read_32)  { h.read_32  = funcs.read_32;  };
        if(funcs.write_8)  { h.write_8  = funcs.write_8;  };
        if(funcs.write_16) { h.write_16 = funcs.write_16; };
        if(funcs.write_32) { h.write_32 = funcs.write_32; };
        handlers.push(h);
        //console.log("Adding handlers at address 0x", base.toString(16), " with size", size, "->", h, "n = ", handlers.length);
    };

    var read = function(addr, mask, name) {
        var handler = get_handler_for(addr);
        if(handler && (name in handler)) {
            var offset = addr - handler.base_addr;
            var val = (handler[name])(offset);
            if(val == undefined) {
                //console.log("reading undefined at addr " + lm32.util.format(addr));
            }
            return (val & mask);
        } else {
            //console.log("MMU ERROR: Cannot " + name + " at address: 0x" + lm32.util.format(addr));
        }
    }

    var read_8 = function(addr) {
        return read(addr, 0xff, "read_8");
    };

    var read_16 = function(addr) {
        return read(addr, 0xffff, "read_16");
    };

    var read_32 = function(addr) {
        return read(addr, 0xffffffff, "read_32");
    };

    var write = function(addr, val, mask, name) {
        var handler = get_handler_for(addr);
        var ret = true;
        if(handler && (name in handler)) {
            var offset = addr - handler.base_addr;
            var sval = val & mask; //safe
            (handler[name])(offset, sval);
        } else {
            ret = false;
        }
        return ret;
    }

    var write_8 = function(addr, val) {
        return write(addr, val, 0xff, "write_8");
    };

    var write_16 = function(addr, val) {
        return write(addr, val, 0xffff, "write_16");
    };

    var write_32 = function(addr, val) {
        return write(addr, val, 0xffffffff, "write_32");
    };

    var copy_region = function(from, to, size) {
        if(size <= 0) {
            return;
        }
        for(var i = 0; i < size; i++) {
            write_8(to + i, read_8(from + i));
        }
    };

    var on_load_binary_result = function(addr, cb) {
        return function(e) {
            var req = e.currentTarget;
            var buff, size, text, v8;
            var status = {success: false, size: 0};
            if (req.status === 200) {
                if ('responseType' in req) {
                    buff = req.response;
                    size = buff.byteLength;
                    v8 = new Uint8Array(buff);
                    for (i = 0; i < size; i++) {
                        write_8(addr + i, v8[i]);
                    }
                } else {
                    text = req.responseText;
                    size = text.length;
                    for (var i = 0; i < size; i++) {
                          write_8(addr + i, text.charCodeAt(i));
                      }
                 }
                status.size = size;
                status.success = true;
            }
            cb(status);
        }
    }

    var load_binary = function (file, addr, cb) {
        var req;
        req = new XMLHttpRequest();
        req.open('GET', file);
        if('responseType' in req) {
            req.responseType = 'arraybuffer';
        } else {
            req.overrideMimeType('text/plain; charset=x-user-defined');
        }
        req.addEventListener('load', on_load_binary_result(addr, cb));
        req.send(null);
    };

    var read_str = function(addr, max_size) {
        var str = '';
        var ch;
        for(var i = 0; i < max_size; i++) {
            ch = read_8(addr + i);
            if(ch == 0) {
                break;
            }
            str += String.fromCharCode(ch);
        }
        return str;
    };

    var write_str = function(addr, str) {
        var i;
        var len = str.length;
        for(i = 0; i < len; i++) {
            write_8(addr + i, str.charCodeAt(i));
        }
        write_8(addr + len, 0);
        //console.log('Wrote to ' + lm32.util.format(addr) + ': ' + read_str(addr, 4096));
    };

    var write_array_data = function(addr, data, len) {
        var i;
        for(i = 0; i < len; i++) {
            write_8(addr + i, data[i]);
        }
    };

    return {
        add_memory: add_memory,
        copy_region: copy_region,
        load_binary: load_binary,
        read_str: read_str,
        write_str: write_str,
        write_array_data: write_array_data,
        read: read,
        read_8: read_8,
        read_16: read_16,
        read_32: read_32,
        write: write,
        write_8: write_8,
        write_16: write_16,
        write_32: write_32
    };
};
