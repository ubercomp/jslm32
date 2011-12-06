/**
 * Copyright (c) 2011 Reginaldo Silva (reginaldo@ubercomp.com)
 * Created: 22/11/11 01:47
 * */
"use strict";
lm32.PFlashCFI01 = function(load_imgs,
                            sector_len,
                            nb_blocs, width,
                            id0, id1, id2, id3,
                            be) {
    this.log = false;
    this.total_len = sector_len * nb_blocs;

    console.log("Creating ram with size: " + lm32.bits.format(this.total_len));
    this.storage = new lm32.RAM(this.total_len, be);
    if(load_imgs) {
        var fake_mmu = new lm32.MMU();
        var fake_handlers = {
            write_8: this.storage.write_8.bind(this.storage)
        };
        fake_mmu.add_memory(0, this.total_len, fake_handlers);
        console.log("Loading U-Boot to FLASH");
        fake_mmu.load_binary("../linux/u-boot.bin", 0);
        console.log("DONE Loading U-Boot to flash");
        console.log("Loading Kernel to FLASH");
        fake_mmu.load_binary("../linux/vmlinux.img", 0x40000);
        console.log("DONE Loading Kernel to FLASH");
    }

    //cpu_register_physical_memory(base, total_len,
    //                off | pfl->fl_mem | IO_MEM_ROMD);

    // variables with automatic initialization
    this.bypass = 0;
    this.counter = 0;

    // TODO read initial data (use fake mmu)
    this.ro = 0;

    this.be = be;
    this.sector_len = sector_len;
    this.width = width;
    this.wcycle = 0;
    this.cmd = 0;
    this.status = 0;
    this.ident = new Array(4);
    this.ident[0] = id0;
    this.ident[1] = id1;
    this.ident[2] = id2;
    this.ident[3] = id3;

    /* Hardcoded CFI table */
    this.cfi_len = 0x52;
    this.cfi_table = new Array(this.cfi_len);
    for(var i = 0; i < this.cfi_len; i++) {
        this.cfi_table[i] = 0;
    }
    /* Standard "QRY" string */
    this.cfi_table[0x10] = 'Q'.charCodeAt(0);
    this.cfi_table[0x11] = 'R'.charCodeAt(0);
    this.cfi_table[0x12] = 'Y'.charCodeAt(0);

    /* Command set (Intel) */
    this.cfi_table[0x13] = 0x01;
    this.cfi_table[0x14] = 0x00;

    /* Primary extended table address (none) */
    this.cfi_table[0x15] = 0x31;
    this.cfi_table[0x16] = 0x00;

    /* Alternate command set (none) */
    this.cfi_table[0x17] = 0x00;
    this.cfi_table[0x18] = 0x00;

    /* Alternate extended table (none) */
    this.cfi_table[0x19] = 0x00;
    this.cfi_table[0x1A] = 0x00;

    /* Vcc min */
    this.cfi_table[0x1B] = 0x45;

    /* Vcc max */
    this.cfi_table[0x1C] = 0x55;

    /* Vpp min (no Vpp pin) */
    this.cfi_table[0x1D] = 0x00;

    /* Vpp max (no Vpp pin) */
    this.cfi_table[0x1E] = 0x00;

    /* Reserved */
    this.cfi_table[0x1F] = 0x07;

    /* Timeout for min size buffer write */
    this.cfi_table[0x20] = 0x07;
    /* Typical timeout for block erase */
    this.cfi_table[0x21] = 0x0a;
    /* Typical timeout for full chip erase (4096 ms) */
    this.cfi_table[0x22] = 0x00;
    /* Reserved */
    this.cfi_table[0x23] = 0x04;
    /* Max timeout for buffer write */
    this.cfi_table[0x24] = 0x04;
    /* Max timeout for block erase */
    this.cfi_table[0x25] = 0x04;
    /* Max timeout for chip erase */
    this.cfi_table[0x26] = 0x00;
    /* Device size */
    this.cfi_table[0x27] = lm32.bits.ctz32(this.total_len); // TODO ctz32 funciona?
    /* Flash device interface (8 & 16 bits) */
    this.cfi_table[0x28] = 0x02;
    this.cfi_table[0x29] = 0x00;
    /* Max number of bytes in multi-bytes write */
    if (width == 1) {
        this.cfi_table[0x2A] = 0x08;
    } else {
        this.cfi_table[0x2A] = 0x0B;
    }
    this.writeblock_size = 1 << this.cfi_table[0x2A];

    this.cfi_table[0x2B] = 0x00;
    /* Number of erase block regions (uniform) */
    this.cfi_table[0x2C] = 0x01;
    /* Erase block region 1 */
    this.cfi_table[0x2D] = nb_blocs - 1;
    this.cfi_table[0x2E] = (nb_blocs - 1) >> 8;
    this.cfi_table[0x2F] = sector_len >> 8;
    this.cfi_table[0x30] = sector_len >> 16;

    /* Extended */
    this.cfi_table[0x31] = 'P'.charCodeAt(0);
    this.cfi_table[0x32] = 'R'.charCodeAt(0);
    this.cfi_table[0x33] = 'I'.charCodeAt(0);

    this.cfi_table[0x34] = '1'.charCodeAt(0);
    this.cfi_table[0x35] = '1'.charCodeAt(0);

    this.cfi_table[0x36] = 0x00;
    this.cfi_table[0x37] = 0x00;
    this.cfi_table[0x38] = 0x00;
    this.cfi_table[0x39] = 0x00;

    this.cfi_table[0x3a] = 0x00;

    this.cfi_table[0x3b] = 0x00;
    this.cfi_table[0x3c] = 0x00;
};

lm32.PFlashCFI01.prototype.DPRINTF = function(str) {
  if(this.hasOwnProperty('log') && this.log) {
      console.log("PFLASH: " + str);
      console.log("CMD: " + lm32.bits.format(this.cmd));
  }
};

lm32.PFlashCFI01.prototype.read = function(offset, width, be) {
    var p;

    var ret = -1;
    var boff = offset & 0xFF; /* why this here ?? */

    if (this.width == 2) {
        boff = boff >> 1;
    } else if (this.width == 4) {
        boff = boff >> 2;
    }

    var fmt = lm32.bits.format;
    this.DPRINTF("pflash_read: reading offset " + fmt(offset) +  " under cmd " + fmt(this.cmd) + " width " + this.width);
    switch (this.cmd) {
        case 0x00:
            /* Flash area read */
            p = this.storage;
            this.DPRINTF("pflash_read: data offset " + fmt(offset) + " " + fmt(ret));
            switch (width) {
                case 1:
                    ret = p.read_8(offset);
                    break;
                case 2:
                    if (be) {
                        ret = p.read_8(offset) << 8;
                        ret |= p.read_8(offset + 1);
                    } else {
                        ret = p.read_8(offset);
                        ret |= p.read_8(offset + 1) << 8;
                    }
                    break;
                case 4:
                    if (be) {
                        ret = p.read_8(offset) << 24;
                        ret |= p.read_8(offset + 1) << 16;
                        ret |= p.read_8(offset + 2) << 8;
                        ret |= p.read_8(offset + 3);
                    } else {
                        ret = p.read_8(offset);
                        ret |= p.read_8(offset + 1) << 8;
                        ret |= p.read_8(offset + 2) << 16;
                        ret |= p.read_8(offset + 3) << 24;
                    }
                    break;
                default:
                    this.DPRINTF("BUG in pflash_read");
            }
            break;

        case 0x20: /* Block erase */
        case 0x50: /* Clear status register */
        case 0x60: /* Block /un)lock */
        case 0x70: /* Status Register */
        case 0xe8: /* Write block */
            /* Status register read */
            ret = this.status;
            this.DPRINTF("pflash_read: status " + fmt(ret));
            break;
        case 0x90:
            switch (boff) {
                case 0:
                    ret = this.ident[0] << 8 | this.ident[1];
                    this.DPRINTF("pflash_read: Manufacturer Code " + fmt(ret));
                    break;
                case 1:
                    ret = this.ident[2] << 8 | this.ident[3];
                    this.DPRINTF("pflash_read: Device ID Code " + fmt(ret));
                    break;
                default:
                    this.DPRINTF("pflash_read: Read Device Information boff=" + fmt(boff));
                    ret = 0;
                    break;
            }
            break;
        case 0x98: /* Query mode */
            if (boff > this.cfi_len) {
                ret = 0;
            }
            else {
                ret = this.cfi_table[boff];
            }
            break;
        default:
            /* This should never happen : reset state & treat it as a read */
            this.DPRINTF("pflash_read: unknown command state: " + fmt(this.cmd));
            this.wcycle = 0;
            this.cmd = 0;
    }
    return ret;
};

/* update flash content on disk */
lm32.PFlashCFI01.prototype.update = function(offset, size) {
    this.DPRINTF("update: NOT IMPLEMENTED");
};

lm32.PFlashCFI01.prototype.data_write = function(offset, value, width, be) {
    var p = this.storage;
    var fmt = lm32.bits.format;
    this.DPRINTF("pflash_data_write: block write offset " + fmt(offset) +
        " value " + fmt(value) + " counter " + fmt(this.counter));
    switch (width) {
        case 1:
            p.write_8(offset, value);
            break;
        case 2:
            if (be) {
                p.write_8(offset, value >> 8);
                p.write_8(offset + 1, value);
            } else {
                p.write_8(offset,  value);
                p.write_8(offset + 1, value >> 8);
            }
            break;
        case 4:
            if (be) {
                p.write_8(offset, value >> 24);
                p.write_8(offset + 1, value >> 16);
                p.write_8(offset + 2, value >> 8);
                p.write_8(offset + 3, value);
            } else {
                p.write_8(offset, value);
                p.write_8(offset + 1,value >> 8);
                p.write_8(offset + 2,value >> 16);
                p.write_8(offset + 3, value >> 24);
            }
            break;
    }
};

lm32.PFlashCFI01.prototype.error_flash_return_after_calling = function(offset, value) {
    var fmt = lm32.bits.format;
    this.DPRINTF("pflash_write: Unimplemented flash cmd sequence " +
    "(offset " + fmt(offset) + ", wcycle " + fmt(this.wcycle) + " cmd " + fmt(this.cmd) + " value " + fmt(value));

    this.reset_flash_return_after_calling();
};

lm32.PFlashCFI01.prototype.reset_flash_return_after_calling = function() {
    this.DPRINTF("cpu_register_physical_memory(pfl->base, pfl->total_len, pfl->off | IO_MEM_ROMD | pfl->fl_mem)");
    this.bypass = 0;
    this.wcycle = 0;
    this.cmd = 0;
};

lm32.PFlashCFI01.prototype.write = function(offset, value, width, be) {
    var p;
    var cmd = value;
    var fmt = lm32.bits.format;
    this.DPRINTF("pflash_write: writing offset " + fmt(offset) + " value " + fmt(value) + " width " + width + " wcycle " + this.wcycle);
    if (!this.wcycle) {
        /* Set the device in I/O access mode */
        this.DPRINTF("cpu_register_physical_memory(pfl->base, pfl->total_len, pfl->fl_mem)");
    }

    switch (this.wcycle) {
        case 0:
            /* read mode */
            switch (cmd) {
                case 0x00: /* ??? */
                    this.DPRINTF("goto reset_flash");
                    this.reset_flash_return_after_calling(); return;
                case 0x10: /* Single Byte Program */
                case 0x40: /* Single Byte Program */
                    this.DPRINTF("pflash_write: Single Byte Program");
                    break;
                case 0x20: /* Block erase */
                    p = this.storage;
                    offset &= ~(this.sector_len - 1);

                    this.DPRINTF("pflash_write: block erase at " + fmt(offset) + " bytes " + fmt(this.sector_len));
                    //memset(p + offset, 0xff, this.sector_len); // TODO check the conversion
                    for(var k = 0 ; k < this.sector_len; k++) {
                        p.write_8(offset + k, 0xff);
                    }

                    this.update(offset, this.sector_len);
                    this.status |= 0x80; /* Ready! */
                    break;
                case 0x50: /* Clear status bits */
                    this.DPRINTF("pflash_write: Clear status bits");
                    this.status = 0x0;
                    this.DPRINTF("goto reset_flash");
                    this.reset_flash_return_after_calling(); return;
                case 0x60: /* Block (un)lock */
                    this.DPRINTF("pflash_write: Block unlock");
                    break;
                case 0x70: /* Status Register */
                    this.DPRINTF("pflash_write: Read status register");
                    this.cmd = cmd;
                    return;
                case 0x90: /* Read Device ID */
                    this.DPRINTF("pflash_write: Read Device information");
                    this.cmd = cmd;
                    return;
                case 0x98: /* CFI query */
                    this.DPRINTF("pflash_write: CFI query");
                    break;
                case 0xe8: /* Write to buffer */
                    this.DPRINTF("pflash_write: Write to buffer");
                    this.status |= 0x80; /* Ready! */
                    break;
                case 0xff: /* Read array mode */
                    this.DPRINTF("pfash_write: Read array mode");
                    this.DPRINTF("goto reset_flash");
                    this.reset_flash_return_after_calling(); return;
                default:
                    this.DPRINTF("goto error flash");
                    this.error_flash_return_after_calling(offset, value); return;
            }
            this.wcycle++;
            this.cmd = cmd;
            return;
        case 1:
            switch (this.cmd) {
                case 0x10: /* Single Byte Program */
                case 0x40: /* Single Byte Program */
                    this.DPRINTF("pflash_write: Single Byte Program");
                    this.data_write(offset, value, width, be);
                    this.update(offset, width);
                    this.status |= 0x80; /* Ready! */
                    this.wcycle = 0;
                    break;
                case 0x20: /* Block erase */
                case 0x28:
                    if (cmd == 0xd0) { /* confirm */
                        this.wcycle = 0;
                        this.status |= 0x80;
                    } else if (cmd == 0xff) { /* read array mode */
                        this.DPRINTF("goto reset_flash");
                        this.reset_flash_return_after_calling(); return;
                    } else {
                        this.DPRINTF("goto error_flash")
                        this.error_flash_return_after_calling(offset, value); return;
                    }
                    break;
                case 0xe8:
                    this.DPRINTF("pflash_write: block write of " + fmt(value)+ " bytes");
                    this.counter = value;
                    this.wcycle++;
                    break;
                case 0x60:
                    if (cmd == 0xd0) {
                        this.wcycle = 0;
                        this.status |= 0x80;
                    } else if (cmd == 0x01) {
                        this.wcycle = 0;
                        this.status |= 0x80;
                    } else if (cmd == 0xff) {
                        this.DPRINTF("goto reset_flash");
                        this.reset_flash_return_after_calling(); return;
                    } else {
                        this.DPRINTF("pflash_write: Unknown (un)locking command");
                        this.DPRINTF("goto reset_flash");
                        this.reset_flash_return_after_calling(); return;
                    }
                    break;
                case 0x98:
                    if (cmd == 0xff) {
                        this.DPRINTF("goto reset_flash");
                        this.reset_flash_return_after_calling(); return;
                    } else {
                        this.DPRINTF("pflash_write: leaving query mode");
                    }
                    break;
                default:
                    this.DPRINTF("goto error_flash")
                    this.error_flash_return_after_calling(offset, value); return;
            }
            return;
        case 2:
            switch (this.cmd) {
                case 0xe8: /* Block write */
                    this.data_write(offset, value, width, be);

                    this.status |= 0x80;

                    if (!this.counter) {
                        var mask = this.writeblock_size - 1;
                        mask = ~mask;

                        this.DPRINTF("pflash_write: block write finished");
                        this.wcycle++;
                        /* Flush the entire write buffer onto backing storage.  */
                        this.update(offset & mask, this.writeblock_size);
                    }

                    this.counter--;
                    break;
                default:
                    this.DPRINTF("goto error_flash");
                    this.error_flash_return_after_calling(offset, value) ; return;
            }
            return;
        case 3: /* Confirm mode */
            switch (this.cmd) {
                case 0xe8: /* Block write */
                    if (cmd == 0xd0) {
                        this.wcycle = 0;
                        this.status |= 0x80;
                    } else {
                        this.DPRINTF('pflash_write: unknown command for "write block"');
                        this.DPRINTF("Write block confirm");
                        this.DPRINTF("goto reset_flash");
                        this.reset_flash_return_after_calling(); return;
                    }
                    break;
                default:
                    this.DPRINTF("goto error_flash");
                    this.error_flash_return_after_calling(offset, value); return;
            }
            return;
        default:
            /* Should never happen */
            this.DPRINTF("pflash_write: invalid write state");
            this.DPRINTF("goto reset_flash");
            this.reset_flash_return_after_calling(); return;
    }
    return;

    error_flash:
        this.error_flash_return_after_calling(offset, value); // NO need to return here
    reset_flash:
        this.reset_flash_return_after_calling();
};

lm32.PFlashCFI01.prototype.read_8_be = function(offset) {
    return this.read(offset, 1, 1)
};

lm32.PFlashCFI01.prototype.read_16_be = function(offset) {
    return this.read(offset, 2, 1);
};

lm32.PFlashCFI01.prototype.read_32_be = function(offset) {
    return this.read(offset, 4, 1);
};

lm32.PFlashCFI01.prototype.write_8_be = function(offset, value) {
    this.write(offset, value, 1, 1);
};

lm32.PFlashCFI01.prototype.write_16_be = function(offset, value) {
    this.write(offset, value, 2, 1);
};

lm32.PFlashCFI01.prototype.write_32_be = function(offset, value) {
    this.write(offset, value, 4, 1);
};

lm32.PFlashCFI01.prototype.get_mmio_handlers = function() {
    if(this.be) {
        var handlers_be = {
            read_8: this.read_8_be.bind(this),
            read_16: this.read_16_be.bind(this),
            read_32: this.read_32_be.bind(this),
            write_8: this.write_8_be.bind(this),
            write_16: this.write_16_be.bind(this),
            write_32: this.write_32_be.bind(this)
        };
        return handlers_be;
    } else {
        throw "NOT IMPLEMENTED";
    }
};