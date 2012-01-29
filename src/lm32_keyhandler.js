/**
 * Handlers for Terminal
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 12/12/11 22:49
 */
"use strict";
lm32.keyHandler = function(send_fn) {
    var is_mac = (navigator.userAgent.indexOf("Mac") >= 0) ? true : false;
    var key_rep_state = 0;
    var key_rep_str = "";
    var send_;
    if(send_fn) {
        send_ = send_fn;
    } else {
        send_ = function() {};
    }

    function set_send_fn(send_fn) {
        send_ = send_fn;
    }

    function send_str(str) {
        send_(str);
    }

    function key_down_handler(event) {
        var str;
        str = "";
        switch (event.keyCode) {
            case 8:
                str = "\b";
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
                } else if ((!is_mac && event.altKey) || (is_mac && event.metaKey)) {
                    if (event.keyCode >= 65 && event.keyCode <= 90) {
                        str = "\x1b" + String.fromCharCode(event.keyCode + 32);
                    }
                }
                break;
        }
        if (str) {
            if (event.stopPropagation) event.stopPropagation();
            if (event.preventDefault) event.preventDefault();
            key_rep_state = 1;
            key_rep_str = str;
            send_(str);
            return false;
        } else {
            key_rep_state = 0;
            return true;
        }
    }

    function key_press_handler(event) {
        var str, code;
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        str = "";
        if (!("charCode" in event)) {
            code = event.keyCode;
            if (key_rep_state == 1) {
                key_rep_state = 2;
                return false;
            } else if (key_rep_state == 2) {
                send_(key_rep_str);
                return false;
            }
        } else {
            code = event.charCode;
        }
        if (code != 0) {
            if (!event.ctrlKey && ((!is_mac && !event.altKey) || (is_mac && !event.metaKey))) {
                str = String.fromCharCode(code);
            }
        }
        if (str) {
            send_(str);
            return false;
        } else {
            return true;
        }
    }

    document.addEventListener("keydown", key_down_handler, true);
    document.addEventListener("keypress", key_press_handler, true);

    return {
        key_down_handler: key_down_handler,
        key_press_handler: key_press_handler,
        send_str: send_str,
        set_send_fn: set_send_fn
    };
};