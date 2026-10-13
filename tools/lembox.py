#!/usr/bin/env python3
"""Lister/extractor for Lemmings Revolution LEMBOX archives (LEMMINGS.BOX, PATCH.BOX).

Format (little-endian), reverse engineered from the shipped files:
  char[6]  "LEMBOX"
  u32      file_count
  u32      names_block_size          (bytes after this field up to the offset table)
  file_count x { u32 name_len; char name[name_len] }   (no NUL, '\\' separators)
  u32      file_count
  u32      offsets[file_count]       (absolute file offsets)
  u32      file_count
  u32      sizes[file_count]
  ...file data...

Usage: lembox.py list ARCHIVE
       lembox.py extract ARCHIVE OUTDIR [substring-filter]
"""
import os
import struct
import sys


def read_index(path):
    with open(path, 'rb') as f:
        if f.read(6) != b'LEMBOX':
            raise SystemExit('not a LEMBOX archive')
        n, names_size = struct.unpack('<II', f.read(8))
        block = f.read(names_size)
        names, p = [], 0
        for _ in range(n):
            ln = struct.unpack_from('<I', block, p)[0]
            names.append(block[p + 4:p + 4 + ln].decode('latin1'))
            p += 4 + ln
        n2 = struct.unpack('<I', f.read(4))[0]
        offsets = struct.unpack('<%dI' % n2, f.read(4 * n2))
        n3 = struct.unpack('<I', f.read(4))[0]
        sizes = struct.unpack('<%dI' % n3, f.read(4 * n3))
    assert n == n2 == n3
    return list(zip(names, offsets, sizes))


def main():
    cmd, arc = sys.argv[1], sys.argv[2]
    idx = read_index(arc)
    if cmd == 'list':
        for name, off, size in idx:
            print('%10d %10d %s' % (off, size, name))
        return
    out = sys.argv[3]
    flt = sys.argv[4].upper() if len(sys.argv) > 4 else None
    with open(arc, 'rb') as f:
        for name, off, size in idx:
            if flt and flt not in name.upper():
                continue
            rel = name.replace('\\', '/').lstrip('./')
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst) or out, exist_ok=True)
            f.seek(off)
            with open(dst, 'wb') as g:
                g.write(f.read(size))


if __name__ == '__main__':
    main()
