lm32.FakeFlash = function() {
    this.i = -1;
};

lm32.FakeFlash.prototype.read = function(offset) {
    this.i = this.i + 1;
    console.log('reading from flash at offset ' + offset);
    var ret = [
        0x00,
        0x00,
        0x51,
        0x00,
        0x51,
        0x52,
        0x59,
        0x00,
        0x02,
        0x00,
        0x02,
        0x01,
        0x7e,
        0x43,
        0x00,
        0x01,
        0x00,
        0x31,
        0x31,
        0x30,
        0x00,
        0x7f,
        0x04,
        0x00,
        0x19,
        0x00,
        0x00,
        0x09,
        0x0a,
        0x00,
        0x00,
        0x07,
        0x01
    ];
    return ret[this.i];
};

lm32.FakeFlash.prototype.write = function() {

};

lm32.FakeFlash.prototype.get_mmio_handlers = function() {
    var handlers = {
        read_8  : this.read.bind(this),
        read_16 : this.read.bind(this),
        read_32 : this.read.bind(this),
        write_8 : this.write.bind(this),
        write_16: this.write.bind(this),
        write_32: this.write.bind(this)
    };
    return handlers;
}

