#!/bin/sh

dd if=/dev/zero of=flash.img bs=256k count=128

# u-boot
dd if=u-boot.bin of=flash.img bs=256k conv=notrunc

# kernel at base + 0x40000  (0x04040000)
dd if=vmlinux.img of=flash.img bs=256k conv=notrunc seek=1

# initrd at base + 0x240000 (0x04240000)
dd if=initrd.img of=flash.img bs=256k conv=notrunc seek=9

# to boot:
# setenv bootcmd 'ping 1.1.1.1; cp.b 04240000 08400000 01000040;bootm 04040000 08400000'

# setenv bootargs 'root=/dev/ram0 ip=dhcp console=ttyS0,115200 ramdisk_size=16384'

# boot