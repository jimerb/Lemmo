#!/usr/bin/env python3
"""Tiny PE virtual-address reader for LemmingsRevolution.exe static analysis.

Usage: pemem.py EXE dwords VA COUNT     -> dump COUNT u32 values at VA
       pemem.py EXE doubles VA COUNT    -> dump COUNT doubles at VA
       pemem.py EXE str VA              -> C string at VA
"""
import struct
import sys


class PE:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        pe = struct.unpack_from('<I', self.d, 0x3c)[0]
        nsec = struct.unpack_from('<H', self.d, pe + 6)[0]
        optsz = struct.unpack_from('<H', self.d, pe + 20)[0]
        self.base = struct.unpack_from('<I', self.d, pe + 24 + 28)[0]
        self.secs = []
        so = pe + 24 + optsz
        for i in range(nsec):
            name, vsz, va, rsz, raw = struct.unpack_from('<8sIIII', self.d, so + i * 40)
            self.secs.append((self.base + va, vsz, rsz, raw))

    def read(self, va, n):
        for sva, vsz, rsz, raw in self.secs:
            if sva <= va < sva + max(vsz, rsz):
                off = va - sva
                b = self.d[raw + off: raw + min(off + n, rsz)]
                return b + b'\0' * (n - len(b))
        raise ValueError(hex(va))

    def u32(self, va, n=1):
        return struct.unpack('<%dI' % n, self.read(va, 4 * n))

    def f64(self, va, n=1):
        return struct.unpack('<%dd' % n, self.read(va, 8 * n))

    def cstr(self, va):
        b = self.read(va, 256)
        return b.split(b'\0')[0].decode('latin1')


if __name__ == '__main__':
    pe = PE(sys.argv[1])
    kind, va = sys.argv[2], int(sys.argv[3], 16)
    if kind == 'dwords':
        print(' '.join('%08x' % x for x in pe.u32(va, int(sys.argv[4]))))
    elif kind == 'doubles':
        print(pe.f64(va, int(sys.argv[4])))
    else:
        print(pe.cstr(va))
