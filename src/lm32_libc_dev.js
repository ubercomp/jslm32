/**
 * Javascript-side implementation of some libc functions
 * for speed.
 *
 * Copyright (c) 2012 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 03/02/12
 */
lm32.libc_dev = function(mmu, ram_array, ram_base, ram_size) {
    var NULL_VALUE = 0;

    var R_ARG0  = 0;
    var R_ARG1  = 1;
    var R_ARG2  = 2;
    var R_ARG3  = 3;
    var R_ARG4  = 4;
    var R_ARG5  = 5;
    var R_ARG6  = 6;
    var R_ARG7  = 7;
    var R_ARG8  = 8;
    var R_ARG9  = 9;
    var R_ARG10 = 10;
    var R_ARG11 = 11;
    var R_ARG12 = 12;
    var R_ARG13 = 13;
    var R_FN    = 14; // the function being executed
    var R_RET   = 15; // the return value (usually an address)

    var R_MAX  = 16;

    // naming convention: FN_HEADER_FUNCTION



    var RESET_VALUE = -1;

    var FN_STRING_MEMCHR      = 0;
    var FN_STRING_MEMCMP      = 1;
    var FN_STRING_MEMCPY      = 2;
    var FN_STRING_MEMMOVE     = 3;
    var FN_STRING_MEMSCAN     = 4;
    var FN_STRING_MEMSET      = 5;
    var FN_STRING_STRCASECMP  = 6;
    var FN_STRING_STRCAT      = 7;
    var FN_STRING_STRCHR      = 8;
    var FN_STRING_STRCMP      = 9;
    var FN_STRING_STRCPY      = 10;
    var FN_STRING_STRCSPN     = 11;
    var FN_STRING_STRLCAT     = 12;
    var FN_STRING_STRLCPY     = 13;
    var FN_STRING_STRLEN      = 14;
    var FN_STRING_STRNCASECMP = 15;
    var FN_STRING_STRNCAT     = 16;
    var FN_STRING_STRNCHR     = 17;
    var FN_STRING_STRNCMP     = 18;
    var FN_STRING_STRNCPY     = 19;
    var FN_STRING_STRNICMP    = 20;
    var FN_STRING_STRNLEN     = 21;
    var FN_STRING_STRPBRK     = 22;
    var FN_STRING_STRRCHR     = 23;
    var FN_STRING_STRSEP      = 24;
    var FN_STRING_STRSPN      = 25;
    var FN_STRING_STRSTR      = 26;
    var FN_STRING_STRSTRIP    = 27;

    var regs = new Array(R_MAX);

    // instruction implementation declarations:
    var impls = new Array();
    impls[FN_STRING_MEMCPY] = string_memcpy;
    impls[FN_STRING_MEMMOVE] = string_memmove;
    impls[FN_STRING_MEMSET] = string_memset;


    function reset() {
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = RESET_VALUE;
        }
    }

    function region_from_ram(base, size) {
        return addr_from_ram(base) && addr_from_ram(base + size - 1);
    }

    function addr_from_ram(addr) {
        return (addr >= ram_base) && (addr < ram_base + ram_size);
    }

    // String funcitons

    function string_memchr() {}

    function string_memcmp() { }

    function string_memcpy(to, from, size) {
        to >>>= 0;
        from >>>= 0;
        size >>>= 0;
        if(size === 0) { return; }
        var i;
        if(region_from_ram(to, size) && region_from_ram(from, size)) {
            to -= ram_base;
            from -= ram_base;
            for(i = 0; i < size; i++) {
                ram_array[to + i] = ram_array[from + i];
            }
        } else {
            for(i = 0; i < size; i++) {
                mmu.write_8(to + i, mmu.read_8(from + i));
            }
        }
    }

    function string_memmove(dest, src, count) {
        dest >>>= 0;
        src >>>= 0;
        count >>>= 0;
        if(count === 0) { return; }
        // TODO support outside ram:
        // TODO optimize
        if(region_from_ram(src, count) && region_from_ram(dest, count)) {
            var tmp;
            var s;
            dest -= ram_base;
            src -= ram_base;
            if(dest <= src) {
                tmp = dest;
                s = src;
                while(count--) {
                    ram_array[tmp++] = ram_array[s++];
                }
            } else {
                tmp = dest + count;
                s = src + count;
                while(count--) {
                    ram_array[tmp--] = ram_array[s--];
                }
            }
        } else {
            throw ("libc_dev: memmove is not supported outside ram");
        }
    }

    function string_memscan() { }

    function string_memset(s, c, count) {
        s >>>= 0;
        c >>>= 0;
        count >>>= 0;
        if(count === 0) { return; }
        if(region_from_ram(s, count)) {
            s -= ram_base;
            for(var i = 0; i < count; i++) {
                ram_array[s + i] = c & 0xff;
            }
        } else {
           for(var i = 0; i < count; i++) {
               mmu.write_8(s + i, c);
           }
        }
    }

    function string_strcasecmp() {}
    function string_strcat() {}
    function string_strchr() {}
    function string_strcmp() {}
    function string_strcpy() {}
    function string_strcspn() {}
    function string_strlcat() {}
    function string_strlcpy() {}
    function string_strlen() {}
    function string_strncasecmp() {}
    function string_strncat() {}
    function string_strnchr() {}
    function string_strncmp() {}
    function string_strncpy() {}
    function string_strnicmp() {}
    function string_strnlen() {}
    function string_strpbrk() {}
    function string_strrchr() {}
    function string_strsep() {}
    function string_strspn() {}
    function string_strstr() {}
    function string_strstrip() {}

    // device handler functions
    function read_32(addr) {
        addr >>= 2;
        if (addr < 0 || addr >= R_MAX) {
            throw ("libc_dev: Unknown address: " + addr);
        }
        return regs[addr];
    }

    function write_32(addr, value) {
        addr >= 2;
        if(addr < 0 || addr >= R_MAX) {
            throw ("libc_dev: Unknown address: " + addr);
        }

        switch(addr) {
            case R_FN:
                var fn = impls[value];
                if(fn) {
                    regs[R_RET] = RESET_VALUE;
                    // TODO if a function with more than 4 args
                    // TODO is implemented, change here
                    var to_return = (fn)(regs[R_ARG0], regs[R_ARG1], regs[R_ARG2], regs[R_ARG3]);
                    if(to_return !== undefined) {
                        regs[R_RET] = to_return | 0;
                    }
                    // reset everything except ret
                    var old_ret = regs[R_RET];
                    reset();
                    regs[R_RET] = old_ret;
                } else {
                    throw ("libc_dev: Function not implemented: " + value);
                }
                break;
            default:
                regs[addr] = value;
                break;
        }
    }

    function get_mmio_handlers() {
        var handlers = {
            read_32: read_32,
            write_32: write_32
        };
        return handlers;
    }



    return {
        iomem_size: 4 * R_MAX,
        get_mmio_handlers: get_mmio_handlers,
        reset: reset
    };

};
