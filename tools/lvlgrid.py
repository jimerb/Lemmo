#!/usr/bin/env python3
"""Extract the 256-column collision grid from a Lemmings Revolution .LVL file.

The cylinder object (serialized by FUN_00439fd3 in the EXE) stores, in order:
  ... u32 count + count*u32 cells (count = rows*256, index = x + y*256, y=0 top)
      u32 count + count bytes   (per 2 columns x row -> index into 256-entry table)
      0x1800 bytes             (256 x 24-byte entries, 3 doubles each)
      str INN_<name>, str OUT_<name>  (u32 len + chars)
The cell array is located by anchoring on the length-prefixed INN_ name.

Usage: lvlgrid.py LEVEL.LVL [--json OUT.json] [--ascii]
"""
import json
import os
import struct
import sys


def find_grid(d, level_name):
    tag = ('INN_' + level_name).encode()
    anchor = d.find(struct.pack('<I', len(tag)) + tag)
    if anchor < 0:
        # fall back: any length-prefixed INN_ string
        i = 0
        while True:
            i = d.find(b'INN_', i)
            if i < 0:
                raise ValueError('INN_ anchor not found')
            ln = struct.unpack_from('<I', d, i - 4)[0]
            if 4 < ln < 64 and d[i + ln:i + ln + 4] and struct.unpack_from('<I', d, i + ln)[0] == ln:
                anchor = i - 4
                break
            i += 4
    tab = anchor - 0x1800
    for q in range(tab - 4, max(0, tab - 400000), -1):
        n = struct.unpack_from('<I', d, q)[0]
        if q + 4 + n == tab:
            for r in range(q - 4, max(0, q - 4 * 400000), -1):
                c = struct.unpack_from('<I', d, r)[0]
                if c and c % 256 == 0 and r + 4 + 4 * c == q:
                    rows = c // 256
                    cells = list(struct.unpack_from('<%dI' % c, d, r + 4))
                    shade = d[q + 4:q + 4 + n]
                    table = [struct.unpack_from('<3d', d, tab + 24 * i) for i in range(256)]
                    return {'rows': rows, 'cols': 256, 'cells': cells, 'cells_offset': r,
                            'shade_index': list(shade), 'vec_table': table}
    raise ValueError('grid not found')


def main():
    path = sys.argv[1]
    name = os.path.splitext(os.path.basename(path))[0]
    d = open(path, 'rb').read()
    g = find_grid(d, name)
    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        json.dump({'name': name, 'rows': g['rows'], 'cols': 256, 'cells': g['cells']}, open(out, 'w'))
    if '--ascii' in sys.argv:
        for y in range(g['rows']):
            print(''.join('.' if not g['cells'][y * 256 + x] else
                          ('M' if g['cells'][y * 256 + x] & 2 else
                           ('#' if g['cells'][y * 256 + x] & 1 else '?'))
                          for x in range(256)))
    print('%s rows=%d offset=0x%x' % (name, g['rows'], g['cells_offset']), file=sys.stderr)


if __name__ == '__main__':
    main()
