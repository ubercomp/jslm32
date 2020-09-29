/**
 *
 * LatticeMico32 CPU emulation: dynamic recompilation
 *
 * Copyright (c) 2011-2020 Reginaldo Silva (reginaldo@ubercomp.com)
 *
 * Specification available at http://www.latticesemi.com/
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

// Conventions:
// (x >>> 0) is used to convert value to unsigned value.
// sign_extend(n, size) -> n << (32 - size) >> (32-size)
// e.g.
// sign_extend(128, 8) -> 128 << 24 >> 24 -> -128
lm32.cpu_dynrec = function(params) {
    // dependencies
    var cs = {}; // cpu state

    // current instruction
    cs.I_OPC   = 0;  // opcode
    cs.I_IMM5  = 0;  // immediate (5 bits)
    cs.I_IMM16 = 0;  // immediate (16 bits)
    cs.I_IMM26 = 0;  // immediate (26 bits)
    cs.I_R0    = 0;  // R0
    cs.I_R1    = 0;  // R1
    cs.I_R2    = 0;  // R2

    function reset(params) {
        // invoke common code first
        lm32.cpu_common.reset(cs, params);

        // To speed up bus accesses
        cs.bus_w = cs.bus.write;
        cs.bus_r = cs.bus.read;
        cs.bus_mask = {};
        cs.bus_mask[8] = "0xff";
        cs.bus_mask[16] = "0xffff";
        cs.bus_mask[32] = "0xffffffff";

        cs.block_cache = {};
        cs.n_blocks = 0;
        cs.size_blocks = 0;
        cs.max_block = 1;

        // instructions that end the generation of a block
        // only unconditional branches and wcsr do this
        // conditional branches don't, they just
        // break out from the loop when the branch is taken
        cs.block_exit = {};
        var v = true;
        var bex = cs.block_exit;
        bex[0x30] = v; // b
        bex[0x34] = v; // wcsr
        bex[0x36] = v; // call_
        bex[0x38] = v; // bi
        bex[0x3e] = v; // calli

    }

    // block label and variable names
    var BLOCK_LOOP = "block_loop";
    var BLOCK_CHOICE = "block_choice";
    var BLOCK_START = "block_start";
    var BLOCK_END = "block_end";

    // exception ids
    var EXCEPT_RESET                 = 0;
    var EXCEPT_BREAKPOINT            = 1;
    var EXCEPT_INSTRUCTION_BUS_ERROR = 2;
    var EXCEPT_WATCHPOINT            = 3;
    var EXCEPT_DATA_BUS_ERROR        = 4;
    var EXCEPT_DIVIDE_BY_ZERO        = 5;
    var EXCEPT_INTERRUPT             = 6;
    var EXCEPT_SYSTEM_CALL           = 7;

    // general purpose register indices
    var REG_GP = 26;  // global pointer
    var REG_FP = 27;  // frame pointer
    var REG_SP = 28;  // stack pointer
    var REG_RA = 29;  // return address
    var REG_EA = 30;  // exception address
    var REG_BA = 31;  // breakpoint address

    // control and status register indices:
    var CSR_IE   = 0x0;  // interrupt enable
    var CSR_IM   = 0x1;  // interrupt mask
    var CSR_IP   = 0x2;  // interrupt pending
    var CSR_ICC  = 0x3;  // instruction cache control
    var CSR_DCC  = 0x4;  // data_cache_control
    var CSR_CC   = 0x5;  // cycle counter
    var CSR_CFG  = 0x6;  // configuration
    var CSR_EBA  = 0x7;  // exception base address
    var CSR_DC   = 0x8;  // debug control
    var CSR_DEBA = 0x9;  // debug esception base address
    var CSR_JTX  = 0xe;  // jtag uart transmit
    var CSR_JRX  = 0xf;  // jtag uart receive
    var CSR_BP0  = 0x10; // breakpoint address 0
    var CSR_BP1  = 0x11; // breakpoint address 1
    var CSR_BP2  = 0x12; // breakpoint address 2
    var CSR_BP3  = 0x13; // breakpoint address 3
    var CSR_WP0  = 0x18; // wacthpoint address 0
    var CSR_WP1  = 0x19; // watchpoint address 1
    var CSR_WP2  = 0x1a; // watchpoint address 2
    var CSR_WP3  = 0x1b; // watchpoint address 3

    // Helpers:

    // non-debug exception
    function raise_exception(cs, id) {
        switch(id) {
            case EXCEPT_DATA_BUS_ERROR:
            case EXCEPT_DIVIDE_BY_ZERO:
            case EXCEPT_INSTRUCTION_BUS_ERROR:
            case EXCEPT_INTERRUPT:
            case EXCEPT_SYSTEM_CALL:
                // non-debug
                cs.regs[REG_EA] = cs.pc | 0;
                cs.ie.eie = cs.ie.ie;
                cs.ie.ie = 0;
                var base = cs.dc.re ? cs.deba : cs.eba;
                // exceptions write to both pc and next_pc
                cs.pc = (base + id * 32) >>> 0;
                cs.next_pc = cs.pc;
                break;

            case EXCEPT_BREAKPOINT:
            case EXCEPT_WATCHPOINT:
                // debug
                cs.regs[REG_BA] = cs.pc | 0;
                cs.ie.bie = cs.ie.ie;
                cs.ie.ie = 0;
                // exceptions write to both pc and next_pc
                cs.pc = (cs.deba + id * 32) >>> 0;
                cs.next_pc = cs.pc;
                break;
            default:
                throw ("Unhandled exception with id " + id);
                break;
        }
    }

    function raise_exception_e(es, id) {
        /*
         * note: as I didn't want instructions "div", "divu", "mod", and "modu"
         * to be instructions that cause a block of code to stop being emmited,
         * I added a "return" statement to the code generation so they always
         * exit the executing block when they throw exceptions.
         */
        var str = '// raise_exception id = ' + id + '\n';
        switch(id) {
            case EXCEPT_DATA_BUS_ERROR:
            case EXCEPT_DIVIDE_BY_ZERO:
            case EXCEPT_INSTRUCTION_BUS_ERROR:
            case EXCEPT_INTERRUPT:
            case EXCEPT_SYSTEM_CALL:
                // non-debug
                str += "$r[" + REG_EA + "] = " + (es.I_PC | 0) + ";\n";
                str += "cs.ie.eie = cs.ie.ie;\n";
                str += "cs.ie.ie = 0;\n";
                // exceptions write to both pc and next_pc
                str += "cs.pc = ((cs.dc.re ? cs.deba : cs.eba) + " + id + " * 32) >>> 0;\n";
                str += "$n = cs.pc;\n";
                str += "break " + BLOCK_LOOP + ";\n";
                break;

            case EXCEPT_BREAKPOINT:
            case EXCEPT_WATCHPOINT:
                // debug
                str += "$r[" + REG_BA + "] = " + (es.I_PC | 0) + ";\n";
                str += "cs.ie.bie = cs.ie.ie;\n";
                str += "cs.ie.ie = 0;\n";
                // exceptions write to both pc and next_pc
                str += "cs.pc = (cs.deba + " + id + " * 32) >>> 0;\n";
                str += "$n = cs.pc;\n";
                str += "break " + BLOCK_LOOP + ";\n";
                break;
            default:
                throw("Code generation: Such exception does not exist: " + id);
                break;
        }
        return str;
    }

    // instruction implementations:

    // arithmetic and comparison instructions

    function add_e(es) {
        return "$r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] + $r[" + es.I_R1 + "]) | 0;\n";
    }

    function addi_e(es) {
        return "$r[" + es.I_R1 + "] = ($r[" + es.I_R0 + "] + " + (es.I_IMM16 << 16 >> 16) + ") | 0;\n";
    }

    function and_e(es) {
        return "$r[" + es.I_R2 + "] = $r[" + es.I_R0 + "] & $r[" + es.I_R1 + "];\n";
    }

    function andhi_e(es) {
        return "$r[" + es.I_R1 + "] = $r[" + es.I_R0 + "] & (" + es.I_IMM16 + " << 16);\n";
    }

    function andi_e(es) {
        return "$r[" + es.I_R1+ "] = $r[" + es.I_R0 + "] & " + es.I_IMM16 + ";\n";
    }

    function compare_rr_e(es, cond, wrap) {
        return "$r[" + es.I_R2 + "] = (($r[" + es.I_R0 + "]" + wrap + ") " +
                   cond  + "($r[" + es.I_R1 + "]" + wrap + ")) ? 1 : 0;\n";
    }

    function compare_ri_e(es, cond, wrap) {
        return "$r[" + es.I_R1 + "] = (($r[" + es.I_R0 + "]" + wrap + ") " +
           cond  + "((" + (es.I_IMM16 << 16 >> 16) + ")" + wrap + ")) ? 1 : 0;\n";
    }

    function compare_rui_e(es, cond, wrap) {
         return "$r[" + es.I_R1 + "] = (($r[" + es.I_R0 + "]" + wrap + ") " +
           cond  + "((" + (es.I_IMM16) + ")" + wrap + ")) ? 1 : 0;\n";
    }

    function cmpe_e(es) {
        return compare_rr_e(es, "===", "");
    }

    function cmpei_e(es) {
        return compare_ri_e(es, "===", "");
    }

    function cmpg_e(es) {
        return compare_rr_e(es, ">", "");
    }


    function cmpgi_e(es) {
        return compare_ri_e(es, ">", "");
    }

    function cmpge_e(es) {
        return compare_rr_e(es, ">=", "");
    }

    function cmpgei_e(es) {
        return compare_ri_e(es, ">=", "");
    }

    function cmpgeu_e(es) {
        return compare_rr_e(es, ">=", " >>> 0 ");
    }

    function cmpgeui_e(es) {
        return compare_rui_e(es, ">=", " >>> 0");
    }

    function cmpgu_e(es) {
        return compare_rr_e(es, ">", " >>> 0");
    }

    function cmpgui_e(es) {
        return compare_rui_e(es, ">", " >>> 0");
    }

    function cmpne_e(es) {
        return compare_rr_e(es, "!==", "");
    }

    function cmpnei_e(es) {
        return compare_ri_e(es, "!==", "");
    }

    function div_e(es) {
        // returns from block when exception is thrown
        // see raise_exception_e
        return "" +
            "if ($r[" + es.I_R1 + "] === 0) {\n" +
            raise_exception_e(es, EXCEPT_DIVIDE_BY_ZERO) +
            "} else {\n" +
            "    $r[" + es.I_R2 + "] = (Math.floor($r[" + es.I_R0 + "]/$r[" + es.I_R1 + "])) | 0;\n" +
            "}\n";
    }

    function divu_e(es) {
        // returns from block when exception is thrown
        // see raise_exception_e
        return "" +
            "if ($r[" + es.I_R1 + "] === 0) {\n" +
            raise_exception_e(es, EXCEPT_DIVIDE_BY_ZERO) +
            "} else {\n" +
            "    $r[" + es.I_R2 + "] = (Math.floor(($r[" + es.I_R0 + "] >>> 0)/($r[" + es.I_R1 + "] >>> 0))) | 0;\n" +
            "}\n";
    }

    function mod_e(es) {
        // returns from block when exception is thrown
        // see raise_exception_e
        return "" +
            "if ($r[" + es.I_R1 + "] === 0) {\n" +
            raise_exception_e(es, EXCEPT_DIVIDE_BY_ZERO) +
            "} else {\n" +
            "    $r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] % $r[" + es.I_R1 + "]) | 0;\n" +
            "}\n";
    }

    function modu_e(es) {
        // returns from block when exception is thrown
        // see raise_exception_e
        return "" +
            "if ($r[" + es.I_R1 + "] === 0) {\n" +
            raise_exception_e(es, EXCEPT_DIVIDE_BY_ZERO) +
            "} else {\n" +
            "    $r[" + es.I_R2 + "] = (($r[" + es.I_R0 + "] >>> 0) % ($r[" + es.I_R1 + "] >>> 0)) | 0;\n" +
            "}\n";
    }

    function mul_e(es) {
        return "$r[" + es.I_R2 + "] = Math.imul($r[" + es.I_R0 + "], $r[" + es.I_R1 + "]);\n";
    }

    function muli_e(es) {
        return "$r[" + es.I_R1 + "] = ($r[" + es.I_R0 + "] * (" + (es.I_IMM16 << 16 >> 16) + ")) | 0;\n";
    }

    function nor_e(es) {
        return "$r[" + es.I_R2 + "] = ~($r[" + es.I_R0 + "] | $r[" + es.I_R1+ "]);\n";
    }

    function nori_e(es) {
        return "$r[" + es.I_R1 + "] = ~($r[" + es.I_R0 + "] | " + es.I_IMM16 + ");\n";
    }

    function or_e(es) {
        return "$r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] | $r[" + es.I_R1 + "]);\n";
    }

    function ori_e(es) {
        return "$r[" + es.I_R1 + "] = ($r[" + es.I_R0 + "] | " + es.I_IMM16 + ");\n";
    }

    function orhi_e(es) {
        return "$r[" + es.I_R1 + "] = $r[" + es.I_R0 + "] | (" + es.I_IMM16 + " << 16);\n";
    }

    function sextb_e(es) {
        return "$r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] << 24) >> 24;\n";
    }

    function sexth_e(es) {
       return "$r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] << 16) >> 16;\n";
    }

    function sl_e(es) {
        return "$r[" + es.I_R2 + "] = $r[" + es.I_R0 + "] << ($r[" + es.I_R1 + "] & 0x1f);\n";
    }

    function sli_e(es) {
        return "$r[" + es.I_R1 + "] = $r[" + es.I_R0 + "] << " + es.I_IMM5 + ";\n";
    }

    function sr_e(es) {
        return "$r[" + es.I_R2 + "] = $r[" + es.I_R0 + "] >> ($r[" + es.I_R1 + "] & 0x1f);\n";
    }

    function sri_e(es) {
        return "$r[" + es.I_R1 +"] = $r[" + es.I_R0 + "] >> " + es.I_IMM5 + ";\n";
    }

    function sru_e(es) {
        return "$r[" + es.I_R2 + "] = $r[" + es.I_R0 + "] >>> ($r[" + es.I_R1 + "] & 0x1f);\n";
    }

    function srui_e(es) {
        return "$r[" + es.I_R1 + "] = $r[" + es.I_R0 + "] >>> " + es.I_IMM5 + ";\n";
    }

    function sub_e(es) {
        return "$r[" + es.I_R2 + "] = ($r[" + es.I_R0 + "] - $r[" + es.I_R1 + "]) | 0;\n";
    }

    function xnor_e(es) {
        return "$r[" + es.I_R2 + "] = ~($r[" + es.I_R0 + "] ^ $r[" + es.I_R1 + "]);\n";
    }

    function xnori_e(es) {
        return "$r[" + es.I_R1 + "] = ~($r[" + es.I_R0 + "] ^ " + es.I_IMM16 + ");\n";
    }

    function xor_e(es) {
        return "$r[" + es.I_R2 + "] = $r[" + es.I_R0 + "] ^ $r[" + es.I_R1 + "];\n";
    }

    function xori_e(es) {
        return "$r[" + es.I_R1 + "] = $r[" + es.I_R0 + "] ^ " + es.I_IMM16 + ";\n";
    }

    function b_e(es) {
        var str;
        str = "";
        if (es.I_R0 === REG_EA) {
            str+= "cs.ie.ie = cs.ie.eie;\n";
        } else if (es.I_R0 === REG_BA) {
            str+= "cs.ie.ie = cs.ie.bie;\n";
        }
        str+= "$n = ($r[" + es.I_R0 + "] >>> 0);\n";
        return str;
    }

    function bi_e(es) {
        return "$n = (" + es.I_PC + " + (" + ((es.I_IMM26 << 2) << 4 >> 4)  + " )) >>> 0;\n";
    }

    function branch_conditional_e(es, cond, wrap) {
        return "" +
            "if (($r[" + es.I_R0 + "] " + wrap + ") " + cond + "($r[" + es.I_R1 + "] " + wrap + ")) {\n" +
            "    $n = (" + es.I_PC + " + (" + ((es.I_IMM16 << 2) << 14 >> 14) + ")) >>> 0;\n" +
            "    break " + BLOCK_CHOICE + ";\n" +
            "}\n";
    }

    function be_e(es) {
        return branch_conditional_e(es, "===", "");
    }

    function bg_e(es) {
        return branch_conditional_e(es, ">", "");
    }

    function bge_e(es) {
        return branch_conditional_e(es, ">=", "");
    }

    function bgeu_e(es) {
        return branch_conditional_e(es, ">=", " >>> 0");
    }

    function bgu_e(es) {
        return branch_conditional_e(es, ">", " >>> 0");
    }

    function bne_e(es) {
        return branch_conditional_e(es, "!==", "");
    }

    function call__e(es) {
        return "" +
            "$r[" + REG_RA + "] = (" + es.I_PC + " + 4) | 0;\n" +
            "$n = ($r[" + es.I_R0 + "]) >>> 0;\n";
    }

    function calli_e(es) {
        return "" +
            "$r["  + REG_RA + "] = (" + es.I_PC + " + 4) | 0;\n" +
            "$n = (" + es.I_PC + " + (" + ((es.I_IMM26 << 2) << 4 >> 4) + ")) >>> 0;\n";
    }

    function scall_e(es) {
        var str;
        switch(es.I_IMM5) {
            case 7:
                str = raise_exception_e(es, EXCEPT_SYSTEM_CALL);
                break;
            case 2:
                str = raise_exception_e(es, EXCEPT_BREAKPOINT);
                break;
            default:
                str = "throw 'Invalid opcode';\n";
                break;
        }
        return str;
    }

    function ram_read_e(width) {
        var code = "";
        switch(width) {
            case 8:
                code = "$v8[$i]";
                break;
            case 16:
                code = "$dv.getUint16($i)";
                break
            case 32:
                code = "$dv.getUint32($i)";
                break;
            default:
                throw "Unknown ram width: " + width;
                break;
        }
        return code;

    }

    function load_e(es, width, signed) {
        // TODO test for invalid bus reads if necessary
        var wrap = signed ? " << " + (32 - width) + " >> " + (32 - width) + "" : "";
        return "" +
            "$u = ($r[" + es.I_R0 + "] + (" + (es.I_IMM16 << 16 >> 16) + ")) >>> 0;\n" +
            "if (($u >= " + (cs.ram_base >>> 0) + ") && ($u < " + (cs.ram_max >>> 0) + ")) {\n" +
            "    $i = $u - " + cs.ram_base + ";\n" +
            "    $r[" + es.I_R1 + "] = (" + ram_read_e(width) + ")" + wrap + ";\n" +
            "} else {\n" +
            //"    $r[" + es.I_R1 + "] = cs.bus.read_" + width + "($u)" + wrap + ";\n" +
            "    $r[" + es.I_R1 + "] = cs.bus_r($u, " + cs.bus_mask[width] + ", 'read_" + width + "')" + wrap + ";\n" +
            "}\n";
    }

    function lb_e(es) {
        return load_e(es, 8, true);
    }

    function lbu_e(es) {
        return load_e(es, 8, false);
    }

    function lh_e(es) {
        return load_e(es, 16, true);
    }

    function lhu_e(es) {
        return load_e(es, 16, false);
    }

    function lw_e(es) {
        return load_e(es, 32, false);
    }

    function ram_write_e(width) {
        var code = "";
        switch(width) {
            case 8:
                code = "$v8[$i] = $t & 0xff;\n";
                break;
            case 16:
                code = "$dv.setUint16($i, $t);\n";
                break;
            case 32:
                code = "$dv.setUint32($i, $t);\n";
                break
            default:
                throw "Invalid width for data: " + width;
                break;
        }
        return code;
    }

    function store_e(es, width) {
        // TODO test for invalid bus writes if necessary
        return "" +
            "$u = ($r[" + es.I_R0 + "] + (" + (es.I_IMM16 << 16 >> 16) + ")) >>> 0;\n" +
            "$t = $r[" + es.I_R1 + "];\n" +
            "if (($u >= " + (cs.ram_base >>> 0) + ") && ($u < " + (cs.ram_max >>> 0) + ")) {\n" +
            "    $i = $u - " + cs.ram_base + ";\n" +
            ram_write_e(width) +
            "} else {\n" +
            //"    cs.bus.write_" + width + "($u, $t);\n" +
            "    cs.bus_w($u, $t, " + cs.bus_mask[width] + ", 'write_" + width + "');\n" +
            "}\n";
    }

    function sb_e(es) {
        return store_e(es, 8);
    }

    function sh_e(es) {
        return store_e(es, 16);
    }

    function sw_e(es) {
        return store_e(es, 32);
    }

    function rcsr_e(es) {
        var csr = es.I_R0;
        var val = "0";
        switch (csr) {
            // These cannot be read from:
            case CSR_ICC:
            case CSR_DCC:
                break;

            case CSR_BP0:
                val = "cs.bp0";
                break;
            case CSR_BP1:
                val = "cs.bp1";
                break;
            case CSR_BP2:
                val = "cs.bp2";
                break;
            case CSR_BP3:
                val = "cs.bp3";
                break;
            case CSR_WP0:
                val = "cs.wp0";
                break;
            case CSR_WP1:
                val = "cs.wp1";
                break;
            case CSR_WP2:
                val = "cs.wp2";
                break;
            case CSR_WP3:
                val = "cs.wp3";
                break;
            case CSR_DC:
                val = "cs.dc_val()";
                break;

            case CSR_IE:
                val = "cs.ie_val()";
                break;
            case CSR_IM:
                val = "cs.pic.get_im()";
                break;
            case CSR_IP:
                val = "cs.pic.get_ip()";
                break;
            case CSR_CC:
                val = "cs.cc"; // always zero
                break;
            case CSR_CFG:
                val = "cs.cfg";
                break;
            case CSR_EBA:
                val = "cs.eba";
                break;

            case CSR_DEBA:
                val = "cs.deba";
                break;

            case CSR_JTX:
                val = "cs.jtx";
                break;
            case CSR_JRX:
                val = "cs.jrx";
                break;

            default:
                throw ("No such CSR register: " + csr);
                break;
        }
        return "$r[" + es.I_R2+ "] = (" + val + ") | 0;\n";
    }

    function wcsr_e(es) {
        var csr = es.I_R0;
        var val = "$r[" + es.I_R1 + "]";
        var code = "";
        switch(csr) {
            // these cannot be written to:
            case CSR_CC:
            case CSR_CFG:
                break;

            case CSR_IP:
                code = "cs.pic.set_ip(" + val + ");\n";
                break;
            case CSR_IE:
                code = "cs.ie_wrt(" + val + ");\n";
                break;
            case CSR_IM:
                code = "cs.pic.set_im(" + val + ");\n";
                break;
            case CSR_ICC:
            case CSR_DCC:
                break; // i just fake icc
            case CSR_EBA:
                code = "cs.eba = " + val + " & 0xffffff00;\n";
                break;
            case CSR_DC:
                code = "cs.dc_wrt(" + val + ");\n";
                break;

            case CSR_DEBA:
                code = "cs.deba = " + val + " & 0xffffff00;\n";
                break;

            case CSR_JTX:
                code = "cs.jtx = " + val + ";\n";
                break;

            case CSR_JRX:
                code = "cs.jrx = " + val + ";\n";
                break;

            case CSR_BP0:
                code = "cs.bp0 = " + val + ";\n";
                break;
            case CSR_BP1:
                code = "cs.bp1 = " + val + ";\n";
                break;
            case CSR_BP2:
                code = "cs.bp3 = " + val + ";\n";
                break;
            case CSR_BP3:
                code = "cs.bp3 = " + val + ";\n";
                break;

            case CSR_WP0:
                code = "cs.wp0 = " + val + ";\n";
                break;
            case CSR_WP1:
                code = "cs.wp1 = " + val + ";\n";
                break;
            case CSR_WP2:
                code = "cs.wp2 = " + val + ";\n";
                break;
            case CSR_WP3:
                code = "cs.wp3 = " + val + ";\n";
                break;
        }
        return code + "$n = " + (es.I_PC + 4) + ";\n";
    }

    function user_e(es) {
        return "cs.runtime.user(cs, " + es.op + ");\n";
    }

    function reserved_e(es) {
        return 'throw "Reserved instruction should not be used";\n';
    }

    var opnames = [
        /* OPCODE      OP */
        /* 0x00 */     "srui_e",
        /* 0x01 */     "nori_e",
        /* 0x02 */     "muli_e",
        /* 0x03 */       "sh_e",
        /* 0x04 */       "lb_e",
        /* 0x05 */      "sri_e",
        /* 0x06 */     "xori_e",
        /* 0x07 */       "lh_e",
        /* 0x08 */     "andi_e",
        /* 0x09 */    "xnori_e",
        /* 0x0a */       "lw_e",
        /* 0x0b */      "lhu_e",
        /* 0x0c */       "sb_e",
        /* 0x0d */     "addi_e",
        /* 0x0e */      "ori_e",
        /* 0x0f */      "sli_e",
        /* 0x10 */      "lbu_e",
        /* 0x11 */       "be_e",
        /* 0x12 */       "bg_e",
        /* 0x13 */      "bge_e",
        /* 0x14 */     "bgeu_e",
        /* 0x15 */      "bgu_e",
        /* 0x16 */       "sw_e",
        /* 0x17 */      "bne_e",
        /* 0x18 */    "andhi_e",
        /* 0x19 */    "cmpei_e",
        /* 0x1a */    "cmpgi_e",
        /* 0x1b */   "cmpgei_e",
        /* 0x1c */  "cmpgeui_e",
        /* 0x1d */   "cmpgui_e",
        /* 0x1e */     "orhi_e",
        /* 0x1f */   "cmpnei_e",
        /* 0x20 */      "sru_e",
        /* 0x21 */      "nor_e",
        /* 0x22 */      "mul_e",
        /* 0x23 */     "divu_e",
        /* 0x24 */     "rcsr_e",
        /* 0x25 */       "sr_e",
        /* 0x26 */      "xor_e",
        /* 0x27 */      "div_e",
        /* 0x28 */      "and_e",
        /* 0x29 */     "xnor_e",
        /* 0x2a */ "reserved_e",
        /* 0x2b */    "scall_e",
        /* 0x2c */    "sextb_e",
        /* 0x2d */      "add_e",
        /* 0x2e */       "or_e",
        /* 0x2f */       "sl_e",

        /* 0x30 */        "b_e",
        /* 0x31 */     "modu_e",
        /* 0x32 */      "sub_e",
        /* 0x33 */     "user_e",
        /* 0x34 */     "wcsr_e",
        /* 0x35 */      "mod_e",
        /* 0x36 */     "call__e",
        /* 0x37 */    "sexth_e",
        /* 0x38 */       "bi_e",
        /* 0x39 */     "cmpe_e",
        /* 0x3a */     "cmpg_e",
        /* 0x3b */    "cmpge_e",
        /* 0x3c */   "cmpgeu_e",
        /* 0x3d */    "cmpgu_e",
        /* 0x3e */    "calli_e",
        /* 0x3f */    "cmpne_e"
    ];

    var emmiters = [
        /* OPCODE      OP */
        /* 0x00 */     srui_e,
        /* 0x01 */     nori_e,
        /* 0x02 */     muli_e,
        /* 0x03 */       sh_e,
        /* 0x04 */       lb_e,
        /* 0x05 */      sri_e,
        /* 0x06 */     xori_e,
        /* 0x07 */       lh_e,
        /* 0x08 */     andi_e,
        /* 0x09 */    xnori_e,
        /* 0x0a */       lw_e,
        /* 0x0b */      lhu_e,
        /* 0x0c */       sb_e,
        /* 0x0d */     addi_e,
        /* 0x0e */      ori_e,
        /* 0x0f */      sli_e,

        /* 0x10 */      lbu_e,
        /* 0x11 */       be_e,
        /* 0x12 */       bg_e,
        /* 0x13 */      bge_e,
        /* 0x14 */     bgeu_e,
        /* 0x15 */      bgu_e,
        /* 0x16 */       sw_e,
        /* 0x17 */      bne_e,
        /* 0x18 */    andhi_e,
        /* 0x19 */    cmpei_e,
        /* 0x1a */    cmpgi_e,
        /* 0x1b */   cmpgei_e,
        /* 0x1c */  cmpgeui_e,
        /* 0x1d */   cmpgui_e,
        /* 0x1e */     orhi_e,
        /* 0x1f */   cmpnei_e,

        /* 0x20 */      sru_e,
        /* 0x21 */      nor_e,
        /* 0x22 */      mul_e,
        /* 0x23 */     divu_e,
        /* 0x24 */     rcsr_e,
        /* 0x25 */       sr_e,
        /* 0x26 */      xor_e,
        /* 0x27 */      div_e,
        /* 0x28 */      and_e,
        /* 0x29 */     xnor_e,
        /* 0x2a */ reserved_e,
        /* 0x2b */    scall_e,
        /* 0x2c */    sextb_e,
        /* 0x2d */      add_e,
        /* 0x2e */       or_e,
        /* 0x2f */       sl_e,

        /* 0x30 */        b_e,
        /* 0x31 */     modu_e,
        /* 0x32 */      sub_e,
        /* 0x33 */     user_e,
        /* 0x34 */     wcsr_e,
        /* 0x35 */      mod_e,
        /* 0x36 */     call__e,
        /* 0x37 */    sexth_e,
        /* 0x38 */       bi_e,
        /* 0x39 */     cmpe_e,
        /* 0x3a */     cmpg_e,
        /* 0x3b */    cmpge_e,
        /* 0x3c */   cmpgeu_e,
        /* 0x3d */    cmpgu_e,
        /* 0x3e */    calli_e,
        /* 0x3f */    cmpne_e
    ];

    function decode_instr(ics, op) {
        ics.op = op >>> 0;
        ics.I_OPC   = op >>> 26;
        ics.I_IMM5  = op & 0x1f;
        ics.I_IMM16 = op & 0xffff;
        ics.I_IMM26 = op & 0x3ffffff;
        ics.I_R0    = (op >> 21) & 0x1f;
        ics.I_R1    = (op >> 16) & 0x1f;
        ics.I_R2    = (op >> 11) & 0x1f;
    }

    function step(instructions) {
        var i = 0;
        var blocks = 10 * instructions;
        var ics = cs; // internal cs -> speeds things up
        var bc = ics.block_cache;
        var block;
        var es; // emmiter state
        var ps = ics.pic.state; // pic state
        var op, pc, opcode;
        var rpc; // ram-based pc
        var ram_base = ics.ram_base;
        var dv = ics.ram.dv;

        var prologue;
        var body;
        var epilogue;
        var block_text;


        do {
            if ((ps.ip & ps.im) && ics.ie.ie == 1) {
                // here is the correct place to treat exceptions
                raise_exception(ics, 6);
            }

            pc = ics.pc;
            if (!bc[pc]) {
                // emmit a block

                prologue = [];
                body = [];
                epilogue = [];
                block_text = [];

                block = new Array(3); // block = [BLOCK_END, BLOCK_CODE, BLOCK_LENGTH];
                block[0] = pc;

                // This assures the generated code declares all its variables and,
                // as crazy as it sounds, helps performance a little bit.
                prologue.push("'use strict';\n");

                // variables for load_e and store_e
                // $i : index in ram
                // $u : unsigned addr
                // $t : tmp
                prologue.push("var $i, $u, $t;\n");
                prologue.push("var $r = cs.regs;\n");
                prologue.push("var $v8 = cs.ram.v8;\n");
                prologue.push("var $dv = cs.ram.dv;\n");
                prologue.push("var $c = 0;\n"); // loop counter
                prologue.push("var $n = " + pc + ";\n");

                body.push(BLOCK_LOOP);
                body.push(": while ($c < 3) {\n");
                body.push("    $c++;\n");
                body.push("    ");
                body.push(BLOCK_CHOICE);
                body.push(": switch($n) {\n");
                block[2] = 0;
                do {
                    // Instruction fetching:
                    // supports only code from ram (faster)
                    rpc = block[0] - ram_base;
                    op = dv.getUint32(rpc);

                    // supports code outside ram
                    // op = ibus.read_32(block[0]);

                    es = {};
                    decode_instr(es, op);
                    es.I_PC = block[0];
                    opcode = es.I_OPC;

                    // push instruction code
                    body.push("case ");
                    body.push(es.I_PC);
                    body.push(": ");
                    body.push((emmiters[opcode])(es));
                    block[2] += 1;

                    if (ics.block_exit[opcode]) {
                        // block exit falls through default
                        body.push("default: break ");
                        body.push(BLOCK_LOOP);
                        body.push(";\n");

                        // statistics
                        ics.n_blocks += 1;
                        ics.size_blocks += block[2];
                        if (block[2] > ics.max_block) {
                            ics.max_block = block[2];
                        }
                        break;
                    } else {
                        block[0] = (block[0] + 4) >>> 0;
                    }
                } while (true);
                body.push("    }\n"); // close switch
                body.push("}\n");     //close while

                epilogue.push('cs.next_pc = $n;\n');
                block_text.push(prologue.join(''));
                block_text.push(body.join(''));
                block_text.push(epilogue.join(''));
                block[1] = new Function('cs', block_text.join(''));
                bc[pc] = block;
            }
            block = bc[pc];
            (block[1])(ics);
            ics.pc = ics.next_pc;
        } while (++i < blocks);

        return i;
    }

    // initialization
    reset(params);

    return {
        cs: cs,
        step: step,
    }
};
