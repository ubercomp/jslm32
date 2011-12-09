/**
 * LatticeMico32 emulation by interpretation.
 *
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 10/09/11 17:21
 *
 * Specification available at:
 *   http://milkymist.org/socdoc/lm32_archman.pdf
 *
 * NOTES:
 *   Contrary to what the manual says, branch instructions are in the xyimm16 format
 */
"use strict";

// Conventions:
// * always use mask 0xffffffff when writing registers;
// * never use mask 0xffffffff when reading registers;
// * always use unsigned32 when writing to pc

lm32.Lm32Cpu = function (params) {
    // dependencies
    var bits = lm32.bits;

    // current instruction
    this.I_OPC   = 0;  // opcode
    this.I_IMM5  = 0;  // immediate (5 bits)
    this.I_IMM16 = 0;  // immediate (16 bits)
    this.I_IMM26 = 0;  // immediate (26 bits)
    this.I_CSR   = 0;  // control and status register
    this.I_R0    = 0;  // R0
    this.I_R1    = 0;  // R1
    this.I_R2    = 0;  // R2

    // initialization
    this.reset(params);

    // constants

    // results values
    var RESULT_BRANCH = 0;
    var RESULT_BREAK  = 0;
    var RESULT_BRET   = 0;
    var RESULT_ERET   = 0;
    var RESULT_SCALL  = 0;
    var RESULT_STORE  = 0;

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

    // comparison helpers (I think google closure compiler will inline these)
    function fcond_eq(a, b) {
        return (a == b);
    }

    function fcond_g(a, b) {
        return (a > b);
    }

    function fcond_ge(a, b) {
        return (a >= b);
    }

    function fcond_geu(a, b) {
        return (bits.unsigned32(a) >= bits.unsigned32(b));
    }

    function fcond_gu(a, b) {
        return (bits.unsigned32(a) > bits.unsigned32(b));
    }

    function fcond_ne(a, b) {
        return (a != b);
    }

    // non-debug exception
    function raise_exception(id, trace_log) {
        if(id == 4) {
            console.log("IGNORING BUS_ERROR EXCEPTION");
            return;
        }
        if(trace_log) {
            console.log("Raising exception (id = " + id + ") at " + bits.format(this.pc));
        }

        switch(id) {
            case EXCEPT_DATA_BUS_ERROR:
            case EXCEPT_DIVIDE_BY_ZERO:
            case EXCEPT_INSTRUCTION_BUS_ERROR:
            case EXCEPT_INTERRUPT:
            case EXCEPT_SYSTEM_CALL:
                // non-debug
                this.regs[REG_EA] = this.pc | 0;
                this.ie.eie = this.ie.ie;
                this.ie.ie = 0;
                var base = this.dc.re ? this.deba : this.eba;
                // exceptions write straight to pc (not next_pc)
                this.pc = bits.unsigned32(base + id * 32);
                break;

            case EXCEPT_BREAKPOINT:
            case EXCEPT_WATCHPOINT:
                // debug
                this.regs[REG_BA] = this.pc | 0;
                this.ie.bie = this.ie.ie;
                this.ie.ie = 0;
                // exceptions write straight to pc (not next_pc)
                this.pc = bits.unsigned32(this.deba + id * 32);
                break;
            default:
                throw ("Unhandled exception with id " + id);
                break;
        }
    }
    this.raise_exception = raise_exception;

    // instruction implementations:
    // in these instructions, "this" should be bound to the CPU

    // arithmetic and comparison instructions
    function add() {
        this.regs[this.I_R2] = (this.regs[this.I_R0] + this.regs[this.I_R1]) | 0;
        this.result = 1;
        this.issue = 1;
    }

    function addi() {
        this.regs[this.I_R1] = (this.regs[this.I_R0] + bits.sign_extend(this.I_IMM16, 16)) | 0;
        this.result = 1;
        this.issue = 1;
    }

    function and() {
        // logical ops don't need to and with mask00_31
        this.regs[this.I_R2] = this.regs[this.I_R0] & this.regs[this.I_R1];
        this.result = 1;
        this.issue = 1;
    }

    function andhi() {
        this.regs[this.I_R1] = this.regs[this.I_R0] & (this.I_IMM16 << 16);
        this.result = 1;
        this.issue = 1;
    }

    function andi() {
        this.regs[this.I_R1] = this.regs[this.I_R0] & bits.zero_extend(this.I_IMM16, 16);
        this.result = 1;
        this.issue = 1;
    }

    /**
     * @param reg_p is this an register to register compare?
     * @param fcond function to compare two values;
     */
    function compare(reg_p, fcond) {
        var rx = reg_p ? this.I_R2 : this.I_R1;
        var ry = reg_p ? this.I_R0 : this.I_R0;
        var rz = reg_p ? this.I_R1 : -1;

        var a = this.regs[ry];
        var b = reg_p ? this.regs[rz] : bits.sign_extend(this.I_IMM16, 16);

        if(fcond(a, b)) {
            this.regs[rx] = 1;
        } else {
            this.regs[rx] = 0;
        }

        this.issue = 1;
        this.result = 2;
    }
    this.compare = compare;


    function cmpe() {
        this.compare(true, fcond_eq);
    }

    function cmpei() {
        this.compare(false, fcond_eq);
    }

    function cmpg() {
        this.compare(true, fcond_g);
    }

    function cmpgi() {
        this.compare(false, fcond_g);
    }

    function cmpge() {
        this.compare(true, fcond_ge);
    }

    function cmpgei() {
        this.compare(false, fcond_ge);
    }

    function cmpgeu() {
        this.compare(true, fcond_geu);
    }

    function cmpgeui() {
        this.compare(false, fcond_geu)
    }

    function cmpgu() {
        this.compare(true, fcond_gu);
    }

    function cmpgui() {
        this.compare(false, fcond_gu);
    }

    function cmpne() {
        this.compare(true, fcond_ne);
    }

    function cmpnei() {
        this.compare(false, fcond_ne);
    }

    function div() {
        var vr0 = this.regs[this.I_R0];
        var vr1 = this.regs[this.I_R1];
        if(vr1 === 0) {
            this.raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[this.I_R2] = (Math.floor(vr0/vr1)) | 0;
        }
        this.issue = 34;
        this.result = 34;
    }

    function divu() {
        var vr0 = this.regs[this.I_R0];
        var vr1 = this.regs[this.I_R1];
        var u = bits.unsigned32;

        if (vr1 === 0) {
            this.raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[this.I_R2] = (Math.floor(u(vr0) / u(vr1))) | 0;
        }
        this.issue = 34;
        this.result = 34;
    }

    function mod() {
        var vr0 = this.regs[this.I_R0];
        var vr1 = this.regs[this.I_R1];
        if (vr1 === 0) {
            this.raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[this.I_R2] = (vr0 % vr1) | 0;
        }
        this.issue = 34;
        this.result = 34;
    }

    function modu() {
        var vr0 = this.regs[this.I_R0];
        var vr1 = this.regs[this.I_R1];
        var u = bits.unsigned32;
        if (vr1 === 0) {
            this.raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[this.I_R2] = (u(vr0) % u(vr1)) | 0;
        }
        this.issue = 34;
        this.result = 34;
    }

    function mul() {
        this.regs[this.I_R2] = (this.regs[this.I_R0] * this.regs[this.I_R1]) | 0;
        this.result = 3;
        this.issue = 1;
    }

    function muli() {
        this.regs[this.I_R1] = (this.regs[this.I_R0] * bits.sign_extend(this.I_IMM16, 16)) | 0;
        this.result = 3;
        this.issue = 1;
    }

    function nor() {
        this.regs[this.I_R2] = ~(this.regs[this.I_R0] | this.regs[this.I_R1]);
        this.result = 1;
        this.issue = 1;
    }

    function nori() {
        this.regs[this.I_R1] = ~(this.regs[this.I_R0] | bits.zero_extend(this.I_IMM16, 16));
        this.issue = 1;
        this.result = 1;
    }

    function or() {
        this.regs[this.I_R2] = (this.regs[this.I_R0] | this.regs[this.I_R1]);
        this.result = 1;
        this.issue = 1;
    }

    function ori() {
        this.regs[this.I_R1] = (this.regs[this.I_R0] | bits.zero_extend(this.I_IMM16, 16));
        this.issue = 1;
        this.result = 1;
    }

    function orhi() {
        this.regs[this.I_R1] = this.regs[this.I_R0] | (this.I_IMM16 << 16);
        this.issue = 1;
        this.result = 1;
    }

    function sextb() {
        // sign extend byte to word
        this.regs[this.I_R2] = (this.regs[this.I_R0] << 24) >> 24;
        this.issue = 1;
        this.result = 1;
    }

    function sexth() {
        // sign extend half-word to word
        this.regs[this.I_R2] = (this.regs[this.I_R0] << 16) >> 16;
        this.issue = 1;
        this.result = 1;
    }

    function sl() {
        this.regs[this.I_R2] = this.regs[this.I_R0] << (this.regs[this.I_R1] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function sli() {
        this.regs[this.I_R1] = this.regs[this.I_R0] << this.I_IMM5;
        this.issue = 1;
        this.result = 2;
    }

    function sr() {
        this.regs[this.I_R2] = this.regs[this.I_R0] >> (this.regs[this.I_R1] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function sri() {
        this.regs[this.I_R1] = this.regs[this.I_R0] >> this.I_IMM5;
        this.issue = 1;
        this.result = 2;
    }

    function sru() {
        this.regs[this.I_R2] = this.regs[this.I_R0] >>> (this.regs[this.I_R1] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function srui() {
        this.regs[this.I_R1] = this.regs[this.I_R0] >>> this.I_IMM5;
        this.issue = 1;
        this.result = 2;
    }

    function sub() {
        this.regs[this.I_R2] = (this.regs[this.I_R0] - this.regs[this.I_R1]) | 0;
        this.issue = 1;
        this.result = 1;
    }

    function xnor() {
        this.regs[this.I_R2] = ~(this.regs[this.I_R0] ^ this.regs[this.I_R1]);
        this.issue = 1;
        this.result = 1;
    }

    function xnori() {
        this.regs[this.I_R1] = ~(this.regs[this.I_R0] ^ bits.zero_extend(this.I_IMM16, 16));
        this.issue = 1;
        this.result = 1;
    }

    function xor() {
        this.regs[this.I_R2] = this.regs[this.I_R0] ^ this.regs[this.I_R1];
        this.issue = 1;
        this.result = 1;
    }

    function xori() {
        this.regs[this.I_R1] = this.regs[this.I_R0] ^ bits.zero_extend(this.I_IMM16, 16);
        this.issue = 1;
        this.result = 1;
    }

    // branch and call implementations
    function b() {
        var r0 = this.I_R0;
        this.issue = 4;

        if(r0 == REG_EA) {
            // eret -> restore eie
            this.ie.ie = this.ie.eie;
            this.issue = 3;
        } else if(r0 == REG_BA) {
            // bret -> restore bie
            this.ie.ie = this.ie.bie;
        }

        this.next_pc = bits.unsigned32(this.regs[r0]);
        this.result = RESULT_BRANCH;
    }

    function bi() {
        var imm26 = this.I_IMM26;
        this.next_pc = bits.unsigned32(this.pc + bits.sign_extend(imm26 << 2, 28));
        this.issue = 4;
        this.result = RESULT_BRANCH;
    }

    function branch_conditional(fcond) {
        this.issue = 1; // issue when not taken
        var a = this.regs[this.I_R0];
        var b = this.regs[this.I_R1];
        if(fcond(a, b)) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend(this.I_IMM16 << 2, 18));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }
    this.branch_conditional = branch_conditional;

    function be() {
        this.branch_conditional(fcond_eq);
    }

    function bg() {
        this.branch_conditional(fcond_g);
    }

    function bge() {
        this.branch_conditional(fcond_ge);
    }

    function bgeu() {
        this.branch_conditional(fcond_geu);
    }

    function bgu() {
        this.branch_conditional(fcond_gu);
    }

    function bne() {
        this.branch_conditional(fcond_ne);
    }

    function call_() {
        this.regs[REG_RA] = (this.pc + 4) | 0;
        this.next_pc = bits.unsigned32(this.regs[this.I_R0]);
        this.issue = 4;
        this.result = 1;
    }

    function calli() {
        var imm26 = this.I_IMM26;
        this.regs[REG_RA] = (this.pc + 4) | 0;
        this.next_pc = bits.unsigned32(this.pc + bits.sign_extend(imm26 << 2, 28));
        this.issue = 4;
        this.result = 1;
    }

    function scall() {
        var imm5 = this.I_IMM5;
        if(imm5 == 7) {
            this.raise_exception(EXCEPT_SYSTEM_CALL);
        } else if(imm5 == 2) {
            this.raise_exception(EXCEPT_BREAKPOINT);
        } else {
            throw "Invalid opcode";
        }
        this.issue = 4;
        this.result = RESULT_SCALL;
    }

    // load and store instructions
    // helper functions
    function sign_extend_8(val) {
        return bits.sign_extend(val, 8);
    }

    function sign_extend_16(val) {
        return bits.sign_extend(val, 16);
    }

    function zero_extend_8(val) {
        return bits.zero_extend(val, 8);
    }

    function zero_extend_16(val) {
        return bits.zero_extend(val, 16);
    }

    function to_32_bits(val) {
        return val | 0;
    }

    /**
     *
     * @param width the width to read (8, 16 or 32)
     * @param func the function to apply before assigning the result to a register
     */
    function load(width, func) {
        var addr = this.regs[this.I_R0] + bits.sign_extend(this.I_IMM16, 16);
        var uaddr = bits.unsigned32(addr);
        if(uaddr >= 0xbffe000 & uaddr < 0xbfff000) {
            console.log('Read from hwsetup');
        }
        var ok = false;
        var val = undefined;
        switch(width) {
            case 8:
                val = this.mmu.read_8(uaddr);
                break;
            case 16:
                val = this.mmu.read_16(uaddr);
                break;
            case 32:
                val = this.mmu.read_32(uaddr);
                break;
            default:
                throw ("invalid width - should never happen");
                break;
        }

        if(val !== undefined) {
            ok = true;
            this.regs[this.I_R1] = func(val);
        }

        if(!ok) {
            console.log("Error reading at address " + bits.format(uaddr) + " with width " + width);
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = 3;
    }
    this.load = load;

    function lb() {
        this.load(8, sign_extend_8);
    }

    function lbu() {
        this.load(8, zero_extend_8);
    }

    function lh() {
        this.load(16, sign_extend_16);
    }

    function lhu() {
        this.load(16, zero_extend_16);
    }

    function lw() {
        this.load(32, to_32_bits);
    }

    function store(width) {
        var addr = this.regs[this.I_R0] + bits.sign_extend(this.I_IMM16, 16);
        var uaddr = bits.unsigned32(addr);
        var ok;
        switch(width) {
            case 8:
                ok = this.mmu.write_8(uaddr, this.regs[this.I_R1]);
                break;
            case 16:
                ok = this.mmu.write_16(uaddr, this.regs[this.I_R1]);
                break;
            case 32:
                ok = this.mmu.write_32(uaddr, this.regs[this.I_R1]);
                break;
            default:
                console.log("Error writing to address " + bits.format(uaddr) + " with width " + width);
                break;
        }
        if(!ok) {
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = RESULT_STORE;
    }
    this.store = store;

    function sb() {
        this.store(8);
    }

    function sh() {
        this.store(16);
    }

    function sw() {
        this.store(32);
    }


    // csr instructions
    function rcsr() {
        var csr = this.I_CSR;
        var r2 = this.I_R2;
        var val;
        var read = true;
        switch (csr) {
            // These cannot be read from:
            case CSR_ICC:
            case CSR_DCC:
            case CSR_BP0:
            case CSR_BP1:
            case CSR_BP2:
            case CSR_BP3:
            case CSR_WP0:
            case CSR_WP1:
            case CSR_WP2:
            case CSR_WP3:
                read = false;
                console.log("Invalid read on csr 0x" + csr.toString(16));
                break;

            case CSR_DC:
                val = this.dc_val();
                break;

            case CSR_IE:
                val = this.ie_val();
                break;
            case CSR_IM:
                val = this.pic.get_im();
                break;
            case CSR_IP:
                val = this.pic.get_ip();
                break;
            case CSR_CC:
                val = this.cc;
                break;
            case CSR_CFG:
                val = this.cfg;
                break;
            case CSR_EBA:
                val = this.eba;
                break;

            case CSR_DEBA:
                val = this.deba;
                break;

            case CSR_JTX:
                val = this.jtx;
                break;
            case CSR_JRX:
                val = this.jrx;
                break;

            default:
                read = false;
                throw ("No such CSR register: " + csr);
                break;
        }
        if(read) {
            this.regs[r2] = (val) | 0;
        } else {
            console.log("Reading from invalid CSR: 0x" + csr.toString(16));
        }
        this.issue = 1;
        this.result = 1;
    }

    function wcsr() {
        var csr = this.I_CSR;
        var rx = this.I_R1;
        var val = this.regs[rx];
        switch(csr) {
            // these cannot be written to:
            case CSR_CC:
            case CSR_CFG:
                console.log("Cannot write to csr number " + csr);
                break;

            case CSR_IP:
                this.pic.set_ip(val);
                break;

            case CSR_IE:
                this.ie_wrt(val);
                break;
            case CSR_IM:
                this.pic.set_im(val);
                break;
            case CSR_ICC:
            case CSR_DCC:
                break; // i just fake icc
            case CSR_EBA:
                this.eba = val & 0xffffff00;
                break;
            case CSR_DC:
                this.dc_wrt(val);
                break;

            case CSR_DEBA:
                this.deba = val & 0xffffff00;
                break;

            case CSR_JTX:
                //console.log("Writing CSR_JTX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
                this.jtx = val;
                break;

            case CSR_JRX:
                //console.log("Writing CSR_JRX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
                this.jrx = val;
                break;

            case CSR_BP0:
                this.bp0 = val; break;
            case CSR_BP1:
                this.bp1 = val; break;
            case CSR_BP2:
                this.bp3 = val; break;
            case CSR_BP3:
                this.bp3 = val; break;

            case CSR_WP0:
                this.wp0 = val; break;
            case CSR_WP1:
                this.wp1 = val; break;
            case CSR_WP2:
                this.wp2 = val; break;
            case CSR_WP3:
                this.wp3 = val; break;
        }
        this.issue = 1;
        this.result = 1;
    }

    // reserved instruction
    function reserved() {
        console.log("Someone called the reserved instruction. Not cool!");
        throw "This should never be  called";
    }


    this.optable = [
        /* OPCODE      OP */
        /* 0x00 */     srui.bind(this),
        /* 0x01 */     nori.bind(this),
        /* 0x02 */     muli.bind(this),
        /* 0x03 */       sh.bind(this),
        /* 0x04 */       lb.bind(this),
        /* 0x05 */      sri.bind(this),
        /* 0x06 */     xori.bind(this),
        /* 0x07 */       lh.bind(this),
        /* 0x08 */     andi.bind(this),
        /* 0x09 */    xnori.bind(this),
        /* 0x0a */       lw.bind(this),
        /* 0x0b */      lhu.bind(this),
        /* 0x0c */       sb.bind(this),
        /* 0x0d */     addi.bind(this),
        /* 0x0e */      ori.bind(this),
        /* 0x0f */      sli.bind(this),

        /* 0x10 */      lbu.bind(this),
        /* 0x11 */       be.bind(this),
        /* 0x12 */       bg.bind(this),
        /* 0x13 */      bge.bind(this),
        /* 0x14 */     bgeu.bind(this),
        /* 0x15 */      bgu.bind(this),
        /* 0x16 */       sw.bind(this),
        /* 0x17 */      bne.bind(this),
        /* 0x18 */    andhi.bind(this),
        /* 0x19 */    cmpei.bind(this),
        /* 0x1a */    cmpgi.bind(this),
        /* 0x1b */   cmpgei.bind(this),
        /* 0x1c */  cmpgeui.bind(this),
        /* 0x1d */   cmpgui.bind(this),
        /* 0x1e */     orhi.bind(this),
        /* 0x1f */   cmpnei.bind(this),

        /* 0x20 */      sru.bind(this),
        /* 0x21 */      nor.bind(this),
        /* 0x22 */      mul.bind(this),
        /* 0x23 */     divu.bind(this),
        /* 0x24 */     rcsr.bind(this),
        /* 0x25 */       sr.bind(this),
        /* 0x26 */      xor.bind(this),
        /* 0x27 */      div.bind(this),
        /* 0x28 */      and.bind(this),
        /* 0x29 */     xnor.bind(this),
        /* 0x2a */ reserved.bind(this),
        /* 0x2b */    scall.bind(this),
        /* 0x2c */    sextb.bind(this),
        /* 0x2d */      add.bind(this),
        /* 0x2e */       or.bind(this),
        /* 0x2f */       sl.bind(this),

        /* 0x30 */        b.bind(this),
        /* 0x31 */     modu.bind(this),
        /* 0x32 */      sub.bind(this),
        /* 0x33 */ reserved.bind(this),
        /* 0x34 */     wcsr.bind(this),
        /* 0x35 */      mod.bind(this),
        /* 0x36 */     call_.bind(this),
        /* 0x37 */    sexth.bind(this),
        /* 0x38 */       bi.bind(this),
        /* 0x39 */     cmpe.bind(this),
        /* 0x3a */     cmpg.bind(this),
        /* 0x3b */    cmpge.bind(this),
        /* 0x3c */   cmpgeu.bind(this),
        /* 0x3d */    cmpgu.bind(this),
        /* 0x3e */    calli.bind(this),
        /* 0x3f */    cmpne.bind(this)
    ];

    this.opnames = [
        "srui",
        "nori",
        "muli",
        "sh",
        "lb",
        "sri",
        "xori",
        "lh",
        "andi",
        "xnori",
        "lw",
        "lhu",
        "sb",
        "addi",
        "ori",
        "sli",

        "lbu",
        "be",
        "bg",
        "bge",
        "bgeu",
        "bgu",
        "sw",
        "bne",
        "andhi",
        "cmpei",
        "cmpgi",
        "cmpgei",
        "cmpgeui",
        "cmpgui",
        "orhi",
        "cmpnei",

        "sru",
        "nor",
        "mul",
        "divu",
        "rcsr",
        "sr",
        "xor",
        "div",
        "and",
        "xnor",
        "reserved",
        "raise",
        "sextb",
        "add",
        "or",
        "sl",

        "branch",
        "modu",
        "sub",
        "reserved",
        "wcsr",
        "mod",
        "call",
        "sexth",
        "bi",
        "cmpe",
        "cmpg",
        "cmpge",
        "cmpgeu",
        "cmpgu",
        "calli",
        "cmpne"
    ];

};

lm32.Lm32Cpu.prototype.irq_handler = function(level) {
    //console.log('board cpu_irq_handler');
    switch(level) {
        case 0:
            this.interrupt = false;
            break;
        case 1:
            this.interrupt = true;
            break;
        default:
            throw ("Unknown level: " + level);
            break;
    }
};

lm32.Lm32Cpu.prototype.reset = function(params) {
    this.mmu = params.mmu;
    // last instruction issue as defined in the architecture manual, page 51
    this.result = 0;
    this.issue = 0;

    // general purpose registers
    this.regs = new Array(32);
    for (var i = 0; i < 32; i++) {
        this.regs[i] = 0;
    }

    // control and status registers
    // program counter: unsigned, two lower bits should always be 0
    this.pc = params.bootstrap_pc;
    this.next_pc = this.pc + 4; // jumps write on next_pc

    this.pic = new lm32.Lm32Pic(this.irq_handler.bind(this));

    // interrupt enable
    this.ie = {
        ie: 0,
        bie: 0,
        eie: 0
    };

    this.ie_val = function() {
        var ie = this.ie.ie ? 1 : 0;
        var bie = this.ie.bie ? 1 : 0;
        var eie = this.ie.eie ? 1 : 0;
        return (ie) | (eie << 1) | (bie << 2);
    };

    this.ie_wrt = function(val) {
        val = val & 0x7; // only 3 bits;
        this.ie.ie = (val & 0x1) ? 1 : 0;
        this.ie.eie = (val & 0x2) ? 1 : 0;
        this.ie.bie = (val & 0x4) ? 1 : 0;
    };

    // interrupt pending
    this.interrupt = false;
    
    this.cc = 0;        // cycle counter

    // configuration:
    // revision: 3
    // watchpoints: 4
    // breakpoints: 4
    // interruptions: 32
    // REV                  WP       BP          INT               J  R  H  G  IC DC CC  X  U  S  D  M
    // 31 30 29 28 27 26 25 24 23 22 21 20 19 18 17 16 15 14 13 12 11 10 09 08 07 06 05 04 03 02 01 00
    // 0  0  0  0  1  1  0  1  0  0  0  1  0  0  1  0  0  0  0  0  0  0  0  0  1  1  1  1  1  1  1  1
    //(0  0  0  0)(1  1  0  1)(0  0  0  1)(0  0  1  0)(0  0  0  0)(0  0  0  0)(1  1  1  1)(0  1  1  1)
    //     0           d           1           2            0          0            f          7
    this.cfg = 0x0d1200f7; // using qemu's

    this.eba = params.bootstrap_eba;       // exception base address

    // debug control and status registers
    this.dc = {
        ss: 0,  // single step enabled (1 bit)
        re: 0,  // remap exceptions (1 bit) - if set, use DEBA for all exceptions
        c0: 0, // 2 bit value
        c1: 0, // 2 bit value
        c2: 0, // 2 bit value
        c3: 0 // 2 bit value
    };

    this.dc_val = function() {
        var ss = this.dc.ss?1:0;
        var re = this.dc.re?1:0;
        var c0 = this.dc.c0 & 0x3;
        var c1 = this.dc.c1 & 0x3;
        var c2 = this.dc.c2 & 0x3;
        var c3 = this.dc.c3 & 0x3;
        return (ss)|(re<<1)|(c0<<2)|(c1<<4)|(c2<<6)|(c3<<8);
    };

    this.dc_wrt = function(val) {
        val = val & 0x3ff; // 10 bits only
        this.dc.ss = val & 0x1 ? 1: 0;
        this.dc.re = val & 0x2 ? 1: 0;
        this.dc.c0 = (val & (0x3 << 2)) >> 2;
        this.dc.c1 = (val & (0x3 << 4)) >> 4;
        this.dc.c2 = (val & (0x3 << 6)) >> 6;
        this.dc.c3 = (val & (0x3 << 8)) >> 8;
    };

    this.deba = params.bootstrap_deba;
    this.jtx = 0;
    this.jrx = 0;
    this.bp0 = 0;
    this.bp1 = 0;
    this.bp2 = 0;
    this.bp3 = 0;
    this.wp0 = 0;
    this.wp1 = 0;
    this.wp2 = 0;
    this.wp3 = 0;
};

lm32.Lm32Cpu.prototype.set_timers = function(timers) {
    this.timers = timers;
};

lm32.Lm32Cpu.prototype.tick = function(ticks) {
    for(var t in this.timers) {
        (this.timers[t]).on_tick(ticks);
    }
};

/**
 * Runs the processor during a certain number of clock cycles.
 * @param clocks the number of clock cycles to run
 */
lm32.Lm32Cpu.prototype.step = function(instructions) {
    var bits = lm32.bits;
    var i = 0;
    var inc;
    var op, pc, opcode;
    var ticks = 0;
    while(i < instructions) {
        if(this.interrupt && (this.ie.ie == 1) && ((this.pic.get_ip() & this.pic.get_im()) != 0)) {
            // here is the correct place to treat exceptions
            // otherwise pc will be overriden
            this.raise_exception(6);
        }

        pc = this.pc;
        this.next_pc = bits.unsigned32(pc + 4);
        op = this.mmu.read_32(pc);

        // Instruction decoding:
        this.I_OPC   = bits.rmsr_u(op, bits.mask26_31, 26);
        this.I_IMM5  = op & 0x1f;
        this.I_IMM16 = op & 0xffff;
        this.I_IMM26 = op & 0x3ffffff;
        this.I_CSR   = bits.rmsr_u(op, bits.mask21_25, 21);
        this.I_R0    = this.I_CSR;
        this.I_R1    = bits.rmsr_u(op, bits.mask16_20, 16);
        this.I_R2    = bits.rmsr_u(op, bits.mask11_15, 11);

        opcode = this.I_OPC;
        (this.optable[opcode])();
        inc = this.issue + this.result;
        this.tick(inc);
        ticks += inc; // TODO look at instructions and see if all are setting issue and result correctly
        this.cc = (this.cc + inc) | 0;
        this.pc = this.next_pc;
        i++;
    }
    return ticks;
};

lm32.Lm32Cpu.prototype.dump_ie = function() {
    var fmt = lm32.bits.format;
    console.log('ie=' + fmt(this.ie_val()) + '(IE=' + this.ie.ie + ' EIE=' + this.ie.eie + ' BIE=' + this.ie.bie + ')');
};

lm32.Lm32Cpu.prototype.dump = function() {
    var i;
    var fmt = lm32.bits.format;
    console.log("DUMP:");
    console.log('');
    console.log('IN: PC=' + fmt(this.pc));
    console.log('ie=' + fmt(this.ie_val()) + '(IE=' + this.ie.ie + ' EIE=' + this.ie.eie + ' BIE=' + this.ie.bie + ')');
    console.log('im='+ fmt(this.pic.get_im()) + ' ip=' + fmt(this.pic.get_ip()));
    console.log('eba=' + fmt(this.eba) + ' deba=' + fmt(this.deba));
    
    for(i = 0; i < 32; i++) {
        if(this.regs[i] != 0) {
            console.log("r" + i + " = " + lm32.bits.format(this.regs[i]));
        }
    };
};
