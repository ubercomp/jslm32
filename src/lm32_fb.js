/**
 * Frame Buffer
 *
 * Copyright (c) 2012 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 13/02/12 00:14
 */
"use strict";

lm32.lm32_frame_buffer = function(container, mmu, ram, ram_base, ram_size) {
    var DEFAULT_WIDTH = 10;
    var DEFAULT_HEIGHT = 10;
    var width = DEFAULT_WIDTH;
    var height = DEFAULT_HEIGHT;
    var canvas;
    var c2d;
    var regs;
    var v8 = ram.v8;
    var imgData;

    var R_INIT = 0;
    var R_MODE_WH = 1;
    var R_DATA = 2;
    var R_MAX = 3;

    function addr_in_ram(addr) {
        return (addr >= ram_base) && (addr < ram_base + ram_size);
    }

    function init() {
        var fb_div = document.getElementById(container);
        if(!fb_div) {
            throw('No element with id: ' + container);
        }
        fb_div.innerHTML = '';
        canvas = document.createElement('canvas');
        if(!canvas.hasOwnProperty('width')) {
            fb_div.innerHTML = '<h3>Your browser does not support canvas.</h3>';
            throw "Canvas not supported";
        }
        canvas.width = DEFAULT_WIDTH;
        canvas.height = DEFAULT_HEIGHT;
        c2d = canvas.getContext('2d');
        imgData = c2d.createImageData(width, height);
        if(!c2d) {
            fb_div.innerHTML = "<h3>Can't get canvas 2d context</h3>";
            throw "Can't get 2d context from canvas";
        }
        fb_div.appendChild(canvas);
    }


    function reset() {
        regs = new Array(R_MAX);
        for(var i = 0; i < R_MAX; i++) {
            regs[i] = 0;
        }
    }

    function read_32(addr) {
        addr >>= 2;
        if(addr < 0 || addr >= R_MAX) {
            throw("lm32_frame_buffer: unknown register: " + addr);
        }
        switch(addr) {
            case R_DATA:
            case R_INIT:
                throw ('Reading from write only register: ' + addr);
                break;
            default:
                return regs[addr];
        }

    }

    function fmt(color) {
      var str = color.toString(16);
      if(str.length == 1) {
          str = '0' + str;
      }
      return str;
    }
    var log = true;

    function write_32(addr, val) {
        addr >>= 2;
        if(addr < 0 || addr >= R_MAX) {
            throw("lm32_frame_buffer: unknown register: " + addr);
        }
        switch(addr) {
            case R_INIT:
                init();
                break;
            case R_MODE_WH:
                width = canvas.width = (val >>> 16);
                height = canvas.height = val & 0xffff;
                c2d.setFillColor('00ff00');
                c2d.fillRect(0, 0, width, height);
                imgData = c2d.createImageData(width, height);
                break;
            case R_DATA:
                var pix = (val >>> 0) - ram_base;
                var iImgData = imgData; // internal img data
                var end = 4 * width * height;
                for(var i = 0; i < end; i++) {
                    iImgData.data[i] = v8[pix+i];
                }
                c2d.putImageData(iImgData, 0, 0);
                break;
        }
    }

    function get_mmio_handlers() {
        return {
            read_32: read_32,
            write_32: write_32
        };
    }



    return {
        get_mmio_handlers: get_mmio_handlers,
        iomem_size: 4*R_MAX,
        init: init,
        reset: reset
    };
};
