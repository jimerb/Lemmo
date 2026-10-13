#!/usr/bin/env python3
"""Decoder for Lemmings Revolution compressed textures (*.BMP / *.ALF inside LEMMINGS.BOX).

Container (FUN_0045015a "LoadBMPImage.cpp"): if the file starts with 'BM' it is a plain
Windows BMP. Otherwise:
  u8 chunk_count
  chunk_count x { u16 chunk_size (incl. 5-byte header); u16 unpacked_size; u8 method;
                  payload[chunk_size-5] }
  method 3 = stored, method 4 = LZ + Huffman (hand-written asm at 0x467e03).
The concatenated output is a normal BMP (or raw alpha bytes for .ALF).

Method 4 stream: three code-length tables (literal-run, match-length, distance), each:
  byte0: high nibble = len[0], low nibble = nsym-2 (byte 0x00 = table absent -> gamma code)
  following bytes: low nibble, high nibble = len[1], len[2], ...
then an MSB-first bitstream:
  loop: n = decode(T0); copy n literal bytes (8 raw bits each)
        len = decode(T1) + 2; dist = decode(T2) + 1; copy len bytes from out[-dist]
Symbol k from a Huffman table maps to value k (k<2) or (1<<(k-1)) | next (k-1) bits.

Usage: lrbmp.py IN OUT.bmp      |   lrbmp.py --dir SRC DST  (convert a tree to PNG if Pillow present)
"""
import os
import struct
import sys


class Bits:
    def __init__(self, d, p):
        self.d, self.p, self.m = d, p, 0x80

    def bit(self):
        b = 1 if self.d[self.p] & self.m else 0
        self.m >>= 1
        if not self.m:
            self.m = 0x80
            self.p += 1
        return b

    def bits(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | self.bit()
        return v


def read_table(d, p):
    b0 = d[p]
    p += 1
    if b0 & 0x0f == 0:
        if b0:
            raise ValueError('bad table header')
        return None, p
    n = (b0 & 0x0f) + 2
    lens = [b0 >> 4]
    while len(lens) < n:
        b = d[p]
        p += 1
        lens.append(b & 0x0f)
        if len(lens) < n:
            lens.append(b >> 4)
    # canonical code assignment: increasing length, then symbol index
    codes = {}
    code = 0
    for L in range(1, 16):
        for sym, l in enumerate(lens):
            if l == L:
                codes[(L, code)] = sym
                code += 1
        code <<= 1
    return codes, p


def decode(bs, table):
    if table is None:                   # gamma code
        n = 0
        while bs.bit():
            n += 1
        return ((1 << n) | bs.bits(n)) - 1 if n else 0
    code, L = 0, 0
    while True:
        code = (code << 1) | bs.bit()
        L += 1
        if (L, code) in table:
            k = table[(L, code)]
            break
        if L > 16:
            raise ValueError('bad huffman code')
    if k < 2:
        return k
    return (1 << (k - 1)) | bs.bits(k - 1)


def unpack4(d, p, size):
    tabs = []
    for _ in range(3):
        t, p = read_table(d, p)
        tabs.append(t)
    bs = Bits(d, p)
    out = bytearray()
    while len(out) < size:
        n = decode(bs, tabs[0])
        for _ in range(n):
            out.append(bs.bits(8))
        if len(out) >= size:
            break
        ln = decode(bs, tabs[1]) + 2
        dist = decode(bs, tabs[2]) + 1
        for _ in range(ln):
            out.append(out[-dist])
    return bytes(out[:size])


def unpack(data):
    if data[:2] == b'BM':
        return data
    out = bytearray()
    p = 1
    for _ in range(data[0]):
        csize, usize, method = struct.unpack_from('<HHB', data, p)
        payload_start = p + 5
        if method == 3:
            out += data[payload_start:payload_start + csize - 5]
        elif method == 4:
            chunk = unpack4(data, payload_start, usize)
            if len(chunk) != usize:
                raise ValueError('size mismatch')
            out += chunk
        else:
            raise ValueError('unknown method %d' % method)
        p += csize
    return bytes(out)


def main():
    if sys.argv[1] == '--dir':
        src, dst = sys.argv[2], sys.argv[3]
        try:
            from PIL import Image
        except ImportError:
            Image = None
        ok = bad = 0
        for root, _, files in os.walk(src):
            for f in files:
                if not f.upper().endswith('.BMP'):
                    continue
                inp = os.path.join(root, f)
                rel = os.path.relpath(inp, src)
                try:
                    raw = unpack(open(inp, 'rb').read())
                except Exception as e:
                    bad += 1
                    print('FAIL', rel, e, file=sys.stderr)
                    continue
                outp = os.path.join(dst, rel)
                os.makedirs(os.path.dirname(outp), exist_ok=True)
                if Image:
                    import io
                    Image.open(io.BytesIO(raw)).save(outp[:-4] + '.png')
                else:
                    open(outp, 'wb').write(raw)
                ok += 1
        print('ok', ok, 'failed', bad)
    else:
        open(sys.argv[2], 'wb').write(unpack(open(sys.argv[1], 'rb').read()))


if __name__ == '__main__':
    main()
