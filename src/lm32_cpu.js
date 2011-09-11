"use strict";

// Conventions:
// * always use mask 0xffffffff when writing registers;
// * never use mask 0xffffffff when reading registers;
// * always use unsigned32 when writing to pc

lm32.Lm32Cpu = function (params) {
    // dependencies
    var bits = lm32.bits;
    var MMU = params.MMU;
    var INTERRUPT_LINES = params.INTERRUPT_LINES;

    // constants

    // results values
    var BRANCH_RESULT = 0;
    var BREAK_RESULT = 0;
    var BRET_RESULT = 0;
    var ERET_RESULT = 0;
    var RET_RESULT = 0;

    // exception ids
    var EXCEPT_RESET = 0;
    var EXCEPT_BREAKPOINT = 1;
    var EXCEPT_INSTRUCTION_BUS_ERROR = 2;
    var EXCEPT_WATCHPOINT = 3;
    var EXCEPT_DATA_BUS_ERROR = 4;
    var EXCEPT_DIVIDE_BY_ZERO = 5;
    var EXEPT_INTERRUPT = 6;
    var EXCEPT_SYSTEM_CALL = 7;

    // general purpose register indices
    var REG_GP = 26; // global pointer
    var REG_FP = 27; // frame pointer
    var REG_SP = 28; // stack pointer
    var REG_RA = 29; // return address
    var REG_EA = 30; // exception address
    var REG_BA = 31; // breakpoint address

    // control and status register indices:
    var CSR_IE = 0x0; // interrupt enable
    var CSR_IM = 0x1; // interrupt mask
    var CSR_IP = 0x2; // interrupt pending
    var CSR_ICC = 0x3; // instruction cache control
    var CSR_DCC = 0x4; // data_cache_control
    var CSR_CC = 0x5; // cycle counter
    var CSR_CFG = 0x6; // configuration
    var CSR_EBA = 0x7; // exception base address


    var nregs = 32;

    // TODO move initialization to reset method
    // last instruction issue as defined in the architecture manual, page 51
    this.result = 0;
    this.issue = 0;

    // general purpose registers
    this.regs = [];
    for (var i = 0; i < nregs; i++) {
        this.regs[i] = 0;
    }


    // control status registers

    // program counter: unsigned, two lower bits should always be 0
    this.pc = 0;

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
    }

    this.ie_wrt = function(val) {
        val = val & 0x7; // only 3 bits;
        this.ie.ie = (val & 0x1) ? 1 : 0;
        this.ie.eie = (val & 0x2) ? 1 : 0;
        this.ie.bie = (val & 0x4) ? 1 : 0;
    }

    this.im = 0;        // interrupt mask
    this.ip = 0;        // interrupt pending
    this.icc = 0;       // instruction cache control
    this.dcc = 0;       // data cache control
    this.cc = 0;        // cycle counter
    this.cfg = 0;     // TODO configuration - set value

    this.eba = 0;       // TODO exception base address (what is EBA_RESET)?


    // instruction formats (page 49 of architecture manual)
    function instr_yzx(op) {
        // y z x is the order in which the registers appear in the opcode
        return {
            rx: bits.rmsr_u(op, bits.mask11_15, 11),
            ry: bits.rmsr_u(op, bits.mask21_25, 21),
            rz: bits.rmsr_u(op, bits.mask16_20, 16)
        };

    }

    function instr_yximm16(op) {
        // register register
        return {
            rx: bits.rmsr_u(op, bits.mask16_20, 16),
            ry: bits.rmsr_u(op, bits.mask21_25, 21),
            imm16: op & bits.mask00_15
        }
    }


    // Helpers:

    function raise_debug_exception(id) {
        // TODO what is DEBA?
        this.regs[REG_BA] = this.pc & bits.mask00_31;
        this.ie.bie = this.ie.ie;
        this.ie.ie = 0;
        this.pc = bits.unsigned32(DEBA + id * 32);
    }

    function raise_exception(id) {
        // TODO what is EBA?
        this.regs[REG_EA] = this.pc & bits.mask00_31;
        this.ie.eie = this.ie.ie;
        this.ie.ie = 0;
        this.pc = bits.unsigned32(EBA + id * 32);
    }


    // instruction implementations:
    // in these instructions, "this" should be bound to the CPU
    // op -> operation line (32 bits)
    function add(op) {
        var i = instr_yzx(op);
        this.regs[i.rx] = (this.regs[i.ry] + this.regs[i.rz]) & bits.mask00_31;
        this.result = 1;
        this.issue = 1;
    }

    function addi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = (this.regs[i.ry] + bits.sign_extend_16_32(i.imm16)) & bits.mask00_31;
        this.result = 1;
        this.issue = 1;
    }

    function and(op) {
        var i = instr_yzx(op);
        // logical ops don't need to and with mask00_31
        this.regs[i.rx] = this.regs[i.ry] & this.regs[i.rz];
        this.result = 1;
        this.issue = 1;
    }

    function andhi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] & (i.imm16 << 16);
        this.result = 1;
        this.issue = 1;
    }

    function andi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] & bits.zero_extend_16_32(i.imm16);
        this.result = 1;
        this.issue = 1;
    }

    function b(op) {
        var rx = bits.rmsr_u(op, bits.mask21_25, 21);
        this.pc = bits.unsigned32(this.regs[rx]);
        this.result = BRANCH_RESULT;
        this.issue = 4;
    }

    function be(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (vrx === vry) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function bg(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (vrx > vry) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function bge(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (vrx >= vry) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function bgeu(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (bits.unsigned32(vrx) >= bits.unsigned32(vry)) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function bgu(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (bits.unsigned32(vrx) > bits.unsigned32(vry)) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function bi(op) {
        var imm26 = op & bits.mask00_25;
        this.pc = bits.unsigned32(this.pc + bits.sign_extend_28_32(imm26 << 2));
        this.issue = 4;
        this.result = BRANCH_RESULT;
    }

    function bne(op) {
        var i = instr_yximm16(op);
        var vrx = this.regs[i.rx];
        var vry = this.regs[i.ry];
        this.issue = 1; // issue when not taken
        if (vrx !== vry) {
            this.pc = bits.unsigned32(this.pc + bits.sign_extend_18_32(i.imm16 << 2));
            this.issue = 4; // issue when taken
        }
        this.result = BRANCH_RESULT;
    }

    function break_(op) {
        raise_debug_exception(EXCEPT_BREAKPOINT);
        this.issue = 4;
        this.result = BREAK_RESULT;
    }

    function bret(op) {
        this.pc = bits.unsigned32(this.regs[REG_BA]);
        this.ie.ie = this.ie.bie;
        this.issue = 4;
        this.result = BRET_RESULT;
    }

    function call(op) {
        var rx = bits.rmsr_u(op, bits.mask21_25, 21);
        this.regs[REG_RA] = (this.pc + 4) & bits.mask00_31;
        this.pc = bits.unsigned32(this.regs[rx]);
        this.issue = 4;
        this.result = 1;
    }

    function calli(op) {
        var imm26 = op & bits.mask00_25;
        this.regs[REG_RA] = (this.pc + 4) & bits.mask00_31;
        this.pc = bits.unsigned32(bits.sign_extend_28_32(imm26 << 2));
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

    function divu(op) {
        var i = instr_yzx(op);
        var vry = this.regs[i.ry];
        var vrz = this.regs[i.rz];
        var u = bits.unsigned32;
        if (vrz === 0) {
            raise_exception(EXCEPT_DIVIDE_BY_ZERO);
        } else {
            this.regs[i.rx] = (Math.floor(u(vry) / u(vrz))) & bits.mask00_31;
        }
        this.issue = 34;
        this.result = 34;
    }

    function eret(op) {
        this.pc = bits.unsigned32(this.regs[REG_EA]);
        this.ie.ie = this.ie.eie;
        this.issue = 3;
        this.result = ERET_RESULT;
    }

    // TODO complete letter L
    function lb(op) {
        // load signed byte
        // TODO complete
    }

    function lbu(op) {
        // load unsigned byte
        // TODO complete
    }

    function lh(op) {

    }

    function lhu(op) {

    }

    function lw(op) {

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
        this.issue = 1;
        this.result = 1;
    }

    function orhi(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] | (i.imm16 << 16);
        this.issue = 1;
        this.result = 1;
    }

    function rcsr(op) {
        // TODO finish this
        var csr = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        var val;
        switch (csr) {
            case CSR_IE:
                val = this.ie_val();
                break;
            case CSR_IM:
                val = this.im;
                break;
            case CSR_IP:
                val = this.ip;
                break;
            case CSR_ICC:
                val = this.icc;
                break;
            case CSR_DCC:
                val = this.dcc;
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
            default:
                throw ("No such CSR register: " + csr);
                break;
        }
        this.regs[rx] = (val) & bits.mask00_31;
    }

    function ret(op) {
        this.issue = 4;
        this.result = RET_RESULT;
        this.pc = bits.unsigned32(this.regs[REG_RA]);
    }

    // TODO implement memory operations
    function sb(op) {

    }

    function scall(op) {

    }

    function setxb(op) {
        // sign extend byte to word
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        this.regs[rx] = (this.regs[ry] << 24) >> 24;
        this.issue = 1;
        this.result = 1;
    }

    function setxh(op) {
        // sign extend half-word to word
        var ry = bits.rmsr_u(op, bits.mask21_25, 21);
        var rx = bits.rmsr_u(op, bits.mask11_15, 11);
        this.regs[rx] = (this.regs[ry] << 16) >> 16;
        this.issue = 1;
        this.result = 1;
    }

    function sh(op) {

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
        this.regs[i.rx] = (this.regs[i.ry] - this.regs[i.rz]) & bits.mask00_31;
        this.issue = 1;
        this.result = 1;
    }

    function sw(op) {
        // TODO
    }

    function wcsr(op) {
        // TODO
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
        this.issue = 1;
        this.result = 1;
    }

    function xori(op) {
        var i = instr_yximm16(op);
        this.regs[i.rx] = this.regs[i.ry] ^ bits.zero_extend_16_32(i.imm16);
        this.issue = 1;
        this.result = 1;
    }


}
