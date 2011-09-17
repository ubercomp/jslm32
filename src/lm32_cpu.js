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
    var trace = lm32.util.trace;
    var disas = lm32.util.trace; // disassemble message

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
    var EXEPT_INTERRUPT              = 6;
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

    // is access at addr ok given width?
    function access_ok(addr, width) {
        var val = (width === 8) ||
            (((addr & 0x1) === 0) && width === 16) ||
            (((addr & 0x3) === 0) && width === 32);
        return val;
    }

    // instruction formats (page 49 of architecture manual)
    function instr_decode(op) {
        return {
            opcode: bits.rmsr_u(op, bits.mask26_31, 26),
            imm5:   op & 0x1f,
            imm16:  op & 0xffff,
            imm26:  op & 0x3ffffff,
            csr:    bits.rmsr_u(op, bits.mask21_25, 21),
            r0:     bits.rmsr_u(op, bits.mask21_25, 21),
            r1:     bits.rmsr_u(op, bits.mask16_20, 16),
            r2:     bits.rmsr_u(op, bits.mask11_15, 11)
        };
    }
    this.instr_decode = instr_decode;

    function instr_yzx(op) {
        // y z x is the order in which the registers appear in the opcode
        return {
            ry: bits.rmsr_u(op, bits.mask21_25, 21),
            rz: bits.rmsr_u(op, bits.mask16_20, 16),
            rx: bits.rmsr_u(op, bits.mask11_15, 11)
        };

    }

    function instr_xyimm16(op){
        // warning!!! this is used on store operations
        // i was using instr_yximm16 for store operations
        // that was a hard bug to catch...
        return {
            rx: bits.rmsr_u(op, bits.mask21_25, 21),
            ry: bits.rmsr_u(op, bits.mask16_20, 16),
            imm16: op & bits.mask00_15
        }
    }

    function instr_yximm16(op) {
        // register register
        return {
            ry: bits.rmsr_u(op, bits.mask21_25, 21),
            rx: bits.rmsr_u(op, bits.mask16_20, 16),
            imm16: op & bits.mask00_15
        }
    }


    // Helpers:
    // debug exception
    function raise_debug_exception(id) {
        if((id < 0) || (id > 7)) {
            throw ("Invalid exception ID: " + id);
        }
        trace("Raising debug exception (id = " + id +") at 0x" + bits.unsigned32(this.pc).toString(16));
        this.regs[REG_BA] = this.pc & bits.mask00_31;
        this.ie.bie = this.ie.ie;
        this.ie.ie = 0;
        this.next_pc = bits.unsigned32(this.deba + id * 32);
    }
    this.raise_debug_exception = raise_debug_exception;

    // non-debug exception
    function raise_exception(id) {
        if((id < 0) || (id > 7)) {
            throw ("Invalid exception ID: " + id);
        }
        trace("Raising exception (id = " + id + ") at 0x" + bits.unsigned32(this.pc).toString(16));
        this.regs[REG_EA] = this.pc & bits.mask00_31;
        this.ie.eie = this.ie.ie;
        this.ie.ie = 0;
        var base = this.dc.re ? this.deba : this.eba;
        this.next_pc = bits.unsigned32(base + id * 32);
    }
    this.raise_exception = raise_exception;

    // instruction implementations:
    // in these instructions, "this" should be bound to the CPU
    // op -> operation line (32 bits)
    function add(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = (this.regs[i.ry] + this.regs[i.rz]) & bits.mask00_31;
        //disas("add  r" + i.rx + ", r" + i.ry + ", r" + i.rz);
        this.result = 1;
        this.issue = 1;
    }

    function addi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = (this.regs[i.ry] + bits.sign_extend_16_32(i.imm16)) & bits.mask00_31;
        //disas("addi r" + i.rx + ", r" + i.ry, ", " + bits.sign_extend_16_32(i.imm16));
        this.result = 1;
        this.issue = 1;
    }

    function and(op) {
        var i = instr_yzx(op);
        // logical ops don't need to and with mask00_31
        this.regs[i.rx] = this.regs[i.ry] & this.regs[i.rz];
        //disas("and  r" + i.rx + ", r" + i.ry + ", r" + i.rz);
        this.result = 1;
        this.issue = 1;
    }

    function andhi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] & (i.imm16 << 16);
        disas("andhi r" + i.rx + ", r" + i.ry, ", 0x" + i.imm16.toString(16));
        this.result = 1;
        this.issue = 1;
    }

    function andi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] & bits.zero_extend_16_32(i.imm16);
        disas("andi r" + i.rx + ", r" + i.ry, ", 0x" + bits.zero_extend_16_32(i.imm16).toString(16));
        this.result = 1;
        this.issue = 1;
    }

    function b(op) {
        var rx = bits.rmsr_u(op, bits.mask21_25, 21);
        this.next_pc = bits.unsigned32(this.regs[rx]);
        //disas("b r" + rx);
        //disas("b 0x" + lm32.bits.unsigned32(this.regs[rx]).toString(16));
        this.result = RESULT_BRANCH;
        this.issue = 4;
    }

    function be(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("be r" + i.rx + ", r" + i.ry +", ", i.imm16);
        this.issue = 1; // issue when not taken
        if (vrx === vry) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function bg(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("bg r" + i.rx + ", r" + i.ry +", ", i.imm16);
        this.issue = 1; // issue when not taken
        if (vrx > vry) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function bge(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("bge r" + i.rx + ", r" + i.ry +", ", i.imm16);
        this.issue = 1; // issue when not taken
        if (vrx >= vry) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function bgeu(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("bgeu r" + i.rx + ", r" + i.ry +", ", i.imm16);
        this.issue = 1; // issue when not taken
        if (bits.unsigned32(vrx) >= bits.unsigned32(vry)) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function bgu(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("bgu r" + i.rx + ", r" + i.ry +", ", bits.sign_extend_18_32(i.imm16 << 2));
        this.issue = 1; // issue when not taken
        if (bits.unsigned32(vrx) > bits.unsigned32(vry)) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function bi(op) {
        var imm26 = op & bits.mask00_25;
        //disas("bi " + imm26<<2);
        this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_28_32(imm26 << 2));
        this.issue = 4;
        this.result = RESULT_BRANCH;
    }

    function bne(op) {
        var i = instr_xyimm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        //disas("bne r" + i.rx + ", r" + i.ry +", ", i.imm16);
        this.issue = 1; // issue when not taken
        if (vrx !== vry) {
            this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = RESULT_BRANCH;
    }

    function branch(op) {
        // calls the correct branch function, depending on op
        var path = bits.rmsr_u(op, bits.mask21_25, 21);
        switch(path) {
            case REG_RA:
                (ret.bind(this))(op); break;
            case REG_EA:
                (eret.bind(this))(op); break;
            case REG_BA:
                (bret.bind(this))(op); break;
            default:
                (b.bind(this))(op); break;
        }
    }

    function break_(op) {
        raise_debug_exception(EXCEPT_BREAKPOINT);
        this.issue = 4;
        this.result = RESULT_BREAK;
    }

    function bret(op) {
        this.next_pc = bits.unsigned32(this.regs[REG_BA]);
        this.ie.ie = this.ie.bie;
        this.issue = 4;
        this.result = RESULT_BRET;
    }

    function call(op) {
        var rx = bits.rmsr_u(op, bits.mask21_25, 21);
        this.regs[REG_RA] = (this.pc + 4) & bits.mask00_31;
        this.next_pc = bits.unsigned32(this.regs[rx]);
        this.issue = 4;
        this.result = 1;
    }

    function calli(op) {
        var imm26 = op & bits.mask00_25;
        this.regs[REG_RA] = (this.pc + 4) & bits.mask00_31;
        //disas("calli 0x" + bits.sign_extend_28_32(imm26 << 2).toString(16));
        this.next_pc = bits.unsigned32(this.pc + bits.sign_extend_28_32(imm26 << 2));
        this.issue = 4;
        this.result = 1;
    }

    function cmpe(op) {
        var i = instr_yzx(op);
        if (this.regs[i.ry] === this.regs[i.rz]) {
            this.regs[i.rx] = 1; // value when equal
        } else {
            this.regs[i.rx] = 0; // value when different
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpei(op) {
        var i = instr_yximm16(op);
        if (this.regs[i.ry] === bits.sign_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpg(op) {
        var i = instr_yzx(op);
        if (this.regs[i.ry] > this.regs[i.rz]) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgi(op) {
        var i = instr_yximm16(op);
        if (this.regs[i.ry] > bits.sign_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpge(op) {
        var i = instr_yzx(op);
        if (this.regs[i.ry] >= this.regs[i.rz]) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgei(op) {
        var i = instr_yximm16(op);
        if (this.regs[i.ry] >= bits.sign_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgeu(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        if (bits.unsigned32(vry) >= bits.unsigned32(vrz)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgeui(op) {
        var i = instr_yximm16(op);
        var vry = this.regs[i.ry];
        if (bits.unsigned32(vry) >= bits.zero_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgu(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        if (bits.unsigned32(vry) > bits.unsigned32(vrz)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpgui(op) {
        var i = instr_yximm16(op);
        var vry = this.regs[i.ry];
        if (bits.unsigned32(vry) > bits.zero_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpne(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        if (vry !== vrz) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function cmpnei(op) {
        var i = instr_yximm16(op);
        var vry = this.regs[i.ry];
        if (bits.unsigned32(vry) !== bits.sign_extend_16_32(i.imm16)) {
            this.regs[i.rx] = 1;
        } else {
            this.regs[i.rx] = 0;
        }
        this.issue = 1;
        this.result = 2;
    }

    function div(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        if(vrz === 0) {
            raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[i.rx] = (Math.floor(vry/vrz)) & bits.mask00_31;
        }
    }

    function divu(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        var u = bits.unsigned32;
        if (vrz == 0) {
            raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[i.rx] = (Math.floor(u(vry) / u(vrz))) & bits.mask00_31;
        }
        this.issue = 34;
        this.result = 34;
    }

    function eret(op) {
        this.next_pc = bits.unsigned32(this.regs[REG_EA]);
        this.ie.ie = this.ie.eie;
        this.issue = 3;
        this.result = RESULT_ERET;
    }
    function lb(op) {
        var i = instr_yximm16(op);
        var addr = this.regs[i.ry] + bits.sign_extend_16_32(i.imm16);
        var ok = false;
        var val = this.mmu.read_8(bits.unsigned32(addr));

        if(val !== undefined) {
            ok = true;
            this.regs[i.rx] = bits.sign_extend_8_32(val);
        }
        
        if(!ok) {
            lm32.util.error_report("Error reading byte (lb) at address 0x" + bits.unsigned32(addr).toString(16));
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = 3;
    }

    function lbu(op) {
        var i = instr_yximm16(op);
        var addr = this.regs[i.ry] + bits.sign_extend_16_32(i.imm16);
        var ok = false;
        var val = this.mmu.read_8(bits.unsigned32(addr));

        if(val !== undefined) {
            ok = true;
            this.regs[i.rx] = bits.zero_extend_8_32(val);
        }

        if(!ok) {
            lm32.util.error_report("Error reading byte (lbu) at address 0x" + bits.unsigned32(addr).toString(16));
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = 3;
    }

    function lh(op) {
        var i = instr_yximm16(op);
        var addr = this.regs[i.ry] + bits.sign_extend_16_32(i.imm16);
        var ok = false;
        var val = this.mmu.read_16(bits.unsigned32(addr));

        if(val !== undefined) {
            ok = true;
            this.regs[i.rx] = bits.sign_extend_16_32(val);
        }

        if(!ok) {
            lm32.util.error_report("Error reading half-word (lh) at address 0x" + bits.unsigned32(addr).toString(16));
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = 3;
    }

    function lhu(op) {
        var i = instr_yximm16(op);
        var addr = this.regs[i.ry] + bits.sign_extend_16_32(i.imm16);
        var ok = false;
        var val = this.mmu.read_16(bits.unsigned32(addr));

        if(val !== undefined) {
            ok = true;
            this.regs[i.rx] = bits.zero_extend_16_32(this.mmu.read_16(val));
        }

        if(!ok) {
            lm32.util.error_report("Error reading half-word (lhu) at address 0x" + bits.unsigned32(addr).toString(16));
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }
        
        this.issue = 1;
        this.result = 3;
    }

    function lw(op) {
        var i = instr_yximm16(op);
        var addr = this.regs[i.ry] + bits.sign_extend_16_32(i.imm16);
        var ok = false;
        var val = this.mmu.read_32(bits.unsigned32(addr));
        //disas("lw r" + i.rx + ", (r" + i.ry + " + 0x" + bits.unsigned32(bits.sign_extend_16_32(i.imm16)).toString(16) + ")");
        //disas("lw r" + i.rx + " 0x" + bits.unsigned32(addr).toString(16))
        if(val !== undefined) {
            ok = true;
            this.regs[i.rx] = val & 0xffffffff;
        }

        if(!ok) {
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = 3;
    }

    function mod(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        if (vrz === 0) {
            raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[i.rx] = (vry % vrz) & bits.mask00_31;
        }
        this.issue = 34;
        this.result = 34;
    }

    function modu(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        var u = bits.unsigned32;
        if (vrz === 0) {
            raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[i.rx] = (u(vry) % u(vrz)) & bits.mask00_31;
        }
        this.issue = 34;
        this.result = 34;
    }

    function mul(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = (this.regs[i.ry] * this.regs[i.rz]) & bits.mask00_31;
        this.result = 3;
        this.issue = 1;
    }

    function muli(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = (this.regs[i.ry] * bits.sign_extend_16_32(i.imm16)) & bits.mask00_31;
        this.result = 3;
        this.issue = 1;
    }

    // mv and mvhi are pseudo ops -> not implemented

    function nor(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = ~(this.regs[i.ry] | this.regs[i.rz]);
        this.result = 1;
        this.issue = 1;
    }

    function nori(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = ~(this.regs[i.ry] | bits.zero_extend_16_32(i.imm16));
        this.issue = 1;
        this.result = 1;
    }

    // not is a pseudo instruction -> not implemented

    function or(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = (this.regs[i.ry] | this.regs[i.rz]);
        this.result = 1;
        this.issue = 1;
    }

    function ori(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = (this.regs[i.ry] | bits.zero_extend_16_32(i.imm16));
        //disas("ori r" + i.rx + ", r" +i.ry + ", 0x" + bits.unsigned32(i.imm16 & 0xffff).toString(16));
        this.issue = 1;
        this.result = 1;
    }

    function orhi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] | (i.imm16 << 16);
        //disas("orhi r" + i.rx + ", r" +i.ry + ", 0x" + bits.unsigned32(i.imm16 & 0xffff).toString(16));
        this.issue = 1;
        this.result = 1;
    }

    /**
     * Calls either break_ or scall, depending on the last two bits of op
     * @param op
     */
    function raise(op) {
        var imm3 = op & 0x7;
        switch(imm3) {
            case 2:
                (break_.bind(this))(op); break;
            case 7:
                (scall.bind(this))(op); break;
            default:
                throw ("Unhandled raise op: " + imm3);
                break;
        }

    }

    function rcsr(op) {
        var csr = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        var val;
        var read = true;
        switch (csr) {
            // These cannot be read from:
            case CSR_ICC:
            case CSR_DCC:
            case CSR_DC:
            case CSR_BP0:
            case CSR_BP1:
            case CSR_BP2:
            case CSR_BP3:
            case CSR_WP0:
            case CSR_WP1:
            case CSR_WP2:
            case CSR_WP3:
                read = false;
                throw("Invalid read on csr 0x"+ csr.toString(16));
                break;

            case CSR_IE:
                val = this.ie_val();
                break;
            case CSR_IM:
                val = this.im;
                break;
            case CSR_IP:
                val = this.ip;
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
                //trace("Reading CSR_JTX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
                val = this.jtx;
                break;
            case CSR_JRX:
                //trace("Reading CSR_JRX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
                val = this.jrx;
                break;

            default:
                throw ("No such CSR register: " + csr);
                break;
        }
        if(read) {
            this.regs[rx] = (val) & bits.mask00_31;
        } else {
            lm32.util.error_report("Reading from invalid CSR: 0x" + csr.toString(16));
        }
        this.issue = 1;
        this.result = 2;
    }
    function reserved(op) {
        throw "This should never be  called";
    }

    // ret is a pseudo instruction -> do not implement
    function ret(op) {
        console.log("ret");
        this.next_pc = this.regs[REG_RA];
    }

    function sb(op) {
        var i = instr_xyimm16(op);
        var addr = this.regs[i.rx] + bits.sign_extend_16_32(i.imm16);
        var ok = this.mmu.write_8(bits.unsigned32(addr), this.regs[i.ry]);

        if(!ok) {
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }
        
        this.issue = 1;
        this.result = RESULT_STORE;
    }

    function scall(op) {
        raise_exception(EXCEPT_SYSTEM_CALL);
        this.issue = 4;
        this.result = RESULT_SCALL;
    }

    function sextb(op) {
        // sign extend byte to word
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        this.regs[rx] = (this.regs[ry] << 24) >> 24;
        this.issue = 1;
        this.result = 1;
    }

    function sexth(op) {
        // sign extend half-word to word
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        this.regs[rx] = (this.regs[ry] << 16) >> 16;
        this.issue = 1;
        this.result = 1;
    }

    function sh(op) {
        var i = instr_xyimm16(op);
        var addr = this.regs[i.rx] + bits.sign_extend_16_32(i.imm16);
        var ok = this.mmu.write_16(bits.unsigned32(addr), this.regs[i.ry]);
        if(!ok) {
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue = 1;
        this.result = RESULT_STORE;
    }

    function sl(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = this.regs[i.ry] << (this.regs[i.rz] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function sli(op) {
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask16_20, 16);
        var imm5 = op & 0x1f;
        this.regs[rx] = this.regs[ry] << imm5;
        this.issue = 1;
        this.result = 2;

    }

    function sr(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = this.regs[i.ry] >> (this.regs[i.rz] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function sri(op) {
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask16_20, 16);
        var imm5 = op & 0x1f;
        this.regs[rx] = this.regs[ry] >> imm5;
        this.issue = 1;
        this.result = 2;
    }

    function sru(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = this.regs[i.ry] >>> (this.regs[i.rz] & 0x1f);
        this.issue = 1;
        this.result = 2;
    }

    function srui(op) {
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask16_20, 16);
        var imm5 = op & 0x1f;
        this.regs[rx] = this.regs[ry] >>> imm5;
        this.issue = 1;
        this.result = 2;
    }

    function sub(op) {
        var i = instr_yzx(op);
        //disas("sub r" + i.rx + ", r" + i.ry + ", r" + i.rz);
        this.regs[i.rx] = (this.regs[i.ry] - this.regs[i.rz]) & bits.mask00_31;
        this.issue = 1;
        this.result = 1;
    }

    function sw(op) {
        var i = instr_xyimm16(op);
        var addr = this.regs[i.rx] + bits.sign_extend_16_32(i.imm16);
        var ok = this.mmu.write_32(bits.unsigned32(addr), this.regs[i.ry]);
        //console.log("mem[0x" + addr.toString(16) + "] = " + bits.unsigned32(this.regs[i.ry]).toString(16));
        if(!ok) {
            this.raise_exception(EXCEPT_DATA_BUS_ERROR);
        }

        this.issue =1;
        this.result = RESULT_STORE;
    }

    function wcsr(op) {
        var csr = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask16_20, 16);
        var val = this.regs[rx];
        //disas("wcsr " + csr + " r" + rx);
        //disas("r" + rx + " = 0x" + bits.unsigned32(val).toString(16));
        switch(csr) {
            // these cannot be written to:
            case CSR_IP:
            case CSR_CC:
            case CSR_CFG:
                throw("Cannot write to csr number " + csr);
                break; // TODO raise exception?

            case CSR_IE:
                this.ie_wrt(val);
                break;
            case CSR_IM:
                this.im = val;
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
                //trace("Writing CSR_JTX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
                this.jtx = val;
                break;

            case CSR_JRX:
                //trace("Writing CSR_JRX at PC: 0x" + bits.unsigned32(this.pc).toString(16));
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

    function xnor(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = ~(this.regs[i.ry] ^ this.regs[i.rz]);
        this.issue = 1;
        this.result = 1;
    }

    function xnori(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = ~(this.regs[i.ry] ^ bits.zero_extend_16_32(i.imm16));
        this.issue = 1;
        this.result = 1;
    }

    function xor(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = this.regs[i.ry] ^ this.regs[i.rz];
        //disas("xor r" + i.rx + ", r" + i.ry +", r" + i.rz);
        this.issue = 1;
        this.result = 1;
    }

    function xori(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] ^ bits.zero_extend_16_32(i.imm16);
        this.issue = 1;
        this.result = 1;
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
        /* 0x2b */    raise.bind(this),
        /* 0x2c */    sextb.bind(this),
        /* 0x2d */      add.bind(this),
        /* 0x2e */       or.bind(this),
        /* 0x2f */       sl.bind(this),

        /* 0x30 */   branch.bind(this),
        /* 0x31 */     modu.bind(this),
        /* 0x32 */      sub.bind(this),
        /* 0x33 */ reserved.bind(this),
        /* 0x34 */     wcsr.bind(this),
        /* 0x35 */      mod.bind(this),
        /* 0x36 */     call.bind(this),
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
    this.ip = 0;

    this.im = 0;        // interrupt mask
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
    this.cfg = 0xd1200f7; //using qemu's

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


lm32.Lm32Cpu.prototype.set_irq = function(irq_line, irq_value) {
    console.log("set_irq " + irq_line + " " + irq_value);
    if(irq_line > 32) {
        lm32.util.error_report("Trying to set invalid irq: " + irq_line);
        return;
    }
    if(irq_value) {
        this.ip = this.ip | (1 << irq_value);
        //if(this.ie && (this.ip & this.im)) {
        //    this.raise_exception(6); //except_interrupt
        //}
    } else {
        this.ip = this.ip & (~(1 << irq_value));
    }
}

/**
 * Runs the processor during a certain number of clock cycles.
 * @param clocks the number of clock cycles to run
 */
lm32.Lm32Cpu.prototype.step = function(instructions) {
    var bits = lm32.bits;
    var i = 0;
    var inc;
    var valid;
    var op, pc, opcode;
    var stats = [];
    for(var s = 0; s < 64; s++) {
        stats[s] = 0;
    }
    while(i <= instructions) {
        pc = this.pc;
        this.next_pc = bits.unsigned32(pc + 4);

        valid = (pc & 0x3) === 0;

        if(!valid) {
            // TODO remove this as it slows down processing?
            lm32.util.error_report("step: invalid pc at 0x" + this.pc.toString(16));
            this.raise_exception(2); // 2 = instruction bus error
            inc = 2; // arbitrary
        } else {
            op = this.mmu.read_32(pc);
            opcode = bits.rmsr_u(op, bits.mask26_31, 26);
            stats[opcode] = stats[opcode] + 1;
            //lm32.util.trace("Running opcode 0x" + opcode.toString(16) + " at pc 0x" + this.pc.toString(16) + " (" + this.opnames[opcode] + ")");
            (this.optable[opcode])(op);
            if(this.next_pc == 201248568) {
                //console.log("Jumping to addi from 0x" + pc.toString(16));
            }
            this.pc = this.next_pc;
            //lm32.util.trace("DUMP:");
            //for(var dump = 1; dump <= 4; dump++) {
            //    lm32.util.trace("    r" + dump + " = 0x" + lm32.bits.unsigned32(this.regs[dump]).toString(16));
            //}
            //lm32.util.trace("   r29" + " = 0x" + lm32.bits.unsigned32(this.regs[29]).toString(16))

            inc = this.issue + this.result;
            i++;
        }
        
        this.cc = (this.cc + inc) & bits.mask00_31;
    }
    function print_stats(opnames, stats) {
        var len = stats.length;
        for(var i = 0; i < len; i++) {
            if(stats[i] != 0) {
                console.log(opnames[i] + " = " + stats[i]);
            }
        }
    }
    
    print_stats(this.opnames, stats);
    this.dump();
};

lm32.Lm32Cpu.prototype.dump = function() {
    var u = lm32.bits.unsigned32;
    var s = function(x) { return "0x" + u(x).toString(16) };
    var i;
    for(i = 0; i < 32; i++) {
        if(this.regs[i] != 0) {
            console.log("r" + i + " = " + s(this.regs[i]));
        }
    };
};
