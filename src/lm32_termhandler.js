/**
 * Handlers for Terminal
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 12/12/11 22:49
 */
"use strict";
lm32.KeyHandler = function(send_fn) {
    this.is_mac = (navigator.userAgent.indexOf("Mac") >= 0) ? true : false;
    this.key_rep_state = 0;
    this.key_rep_str = "";
    if(send_fn) {
        this.send_ = send_fn;
    } else {
        this.send_ = function() {};
    }
    document.addEventListener("keydown", this.key_down_handler.bind(this), true);
    document.addEventListener("keypress", this.key_press_handler.bind(this), true);

};

lm32.KeyHandler.prototype.set_send_fn = function(send_fn) {
    this.send_ = send_fn;
};

lm32.KeyHandler.prototype.key_down_handler = function(event) {
    var str;
    str = "";
    switch (event.keyCode) {
        case 8:
            str = "";
            break;
        case 9:
            str = "\t";
            break;
        case 13:
            str = "\r";
            break;
        case 27:
            str = "\x1b";
            break;
        case 37:
            str = "\x1b[D";
            break;
        case 39:
            str = "\x1b[C";
            break;
        case 38:
            str = "\x1b[A";
            break;
        case 40:
            str = "\x1b[B";
            break;
        case 46:
            str = "\x1b[3~";
            break;
        case 45:
            str = "\x1b[2~";
            break;
        case 36:
            str = "\x1bOH";
            break;
        case 35:
            str = "\x1bOF";
            break;
        case 33:
            str = "\x1b[5~";
            break;
        case 34:
            str = "\x1b[6~";
            break;
        default:
            if (event.ctrlKey) {
                if (event.keyCode >= 65 && event.keyCode <= 90) {
                    str = String.fromCharCode(event.keyCode - 64);
                } else if (event.keyCode == 32) {
                    str = String.fromCharCode(0);
                }
            } else if ((!this.is_mac && event.altKey) || (this.is_mac && event.metaKey)) {
                if (event.keyCode >= 65 && event.keyCode <= 90) {
                    str = "\x1b" + String.fromCharCode(event.keyCode + 32);
                }
            }
            break;
    }
    if (str) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        this.key_rep_state = 1;
        this.key_rep_str = str;
        this.send_(str);
        return false;
    } else {
        this.key_rep_state = 0;
        return true;
    }
};

lm32.KeyHandler.prototype.key_press_handler = function(event) {
    var str, code;
    if (event.stopPropagation) event.stopPropagation();
    if (event.preventDefault) event.preventDefault();
    str = "";
    if (!("charCode" in event)) {
        code = event.keyCode;
        if (this.key_rep_state == 1) {
            this.key_rep_state = 2;
            return false;
        } else if (this.key_rep_state == 2) {
            this.send_(this.key_rep_str);
            return false;
        }
    } else {
        code = event.charCode;
    }
    if (code != 0) {
        if (!event.ctrlKey && ((!this.is_mac && !event.altKey) || (this.is_mac && !event.metaKey))) {
            str = String.fromCharCode(code);
        }
    }
    if (str) {
        this.send_(str);
        return false;
    } else {
        return true;
    }
};