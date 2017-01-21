/**
 *
 * LM32 Kernel Parameters for uClinux
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

lm32.lm32_hwsetup = function() {
    // constants
    var HWSETUP_TAG_EOL         = 0;
    var HWSETUP_TAG_CPU         = 1;
    var HWSETUP_TAG_ASRAM       = 2;
    var HWSETUP_TAG_FLASH       = 3;
    var HWSETUP_TAG_SDRAM       = 4;
    var HWSETUP_TAG_OCM         = 5;
    var HWSETUP_TAG_DDR_SDRAM   = 6;
    var HWSETUP_TAG_DDR2_SDRAM  = 7;
    var HWSETUP_TAG_TIMER       = 8;
    var HWSETUP_TAG_UART        = 9;
    var HWSETUP_TAG_GPIO        = 10;
    var HWSETUP_TAG_TRISPEEDMAC = 11;
    var HWSETUP_TAG_I2CM        = 12;
    var HWSETUP_TAG_LEDS        = 13;
    var HWSETUP_TAG_7SEG        = 14;
    var HWSETUP_TAG_SPI_S       = 15;
    var HWSETUP_TAG_SPI_M       = 16;

    // state
    var data = new Array();
    var ptr = 0;

    function get_data() {
        if (data.length != ptr) {
            throw "There are bugs in the programming...";
        }
        return data;
    }

    function add_u8(u) {
        data.push(u & 0xff);
        ptr += 1;
    }

    function add_u32(u) {
        data.push((u & 0xff000000) >>> 24);
        data.push((u & 0x00ff0000) >> 16);
        data.push((u & 0x0000ff00) >> 8);
        data.push(u & 0x000000ff);
        ptr += 4;
    }

    function add_tag(tag) {
        add_u32(tag);
    }

    function add_str(str) {
        var len = str.length;
        var nz = 32 - len;
        for (var i = 0; i < len; i++) {
            data.push(str.charCodeAt(i));
        }
        for (var i = 0; i < nz; i++) {
            data.push(0);
        }
        ptr += 32;
    }

    // size is always payload_size + 4

    function add_trailer() {
        add_u32(8); // size
        add_tag(HWSETUP_TAG_EOL);
    }

    function add_cpu(name, frequency) {
        add_u32(44); // size
        add_tag(HWSETUP_TAG_CPU);
        add_str(name);
        add_u32(frequency);
    }

    function add_flash(name, base, size) {
        add_u32(52); // size
        add_tag(HWSETUP_TAG_FLASH);
        add_str(name);
        add_u32(base);
        add_u32(size);
        add_u8(8); // read latency
        add_u8(8); // write latency
        add_u8(25); // address width
        add_u8(32); // data width
    }

    function add_ddr_sdram(name, base, size) {
        add_u32(48); // size
        add_tag(HWSETUP_TAG_DDR_SDRAM);
        add_str(name);
        add_u32(base);
        add_u32(size);
    }

    function add_timer(name, base, irq) {
        add_u32(56); // size
        add_tag(HWSETUP_TAG_TIMER);
        add_str(name);
        add_u32(base);
        add_u8(1); // wr_tickcount
        add_u8(1); // rd_tickcount
        add_u8(1); // start_stop_control
        add_u8(32); // counter_width
        add_u32(20); // reload ticks
        add_u8(irq);
        add_u8(0); // padding
        add_u8(0); // padding
        add_u8(0); // padding
    }

    function add_uart(name, base, irq) {
        add_u32(56); // size
        add_tag(HWSETUP_TAG_UART);
        add_str(name);
        add_u32(base);
        add_u32(115200); // baudrate
        add_u8(8); // databits
        add_u8(1); // stopbits
        add_u8(1); // use interrupt
        add_u8(1); // block on transmit
        add_u8(1); // block on receive
        add_u8(4); // rx buffer size
        add_u8(4); // tx buffer size
        add_u8(irq);
    }

    return {
        get_data: get_data,
        add_trailer: add_trailer,
        add_cpu: add_cpu,
        add_flash: add_flash,
        add_ddr_sdram: add_ddr_sdram,
        add_timer: add_timer,
        add_uart: add_uart
    };
};
