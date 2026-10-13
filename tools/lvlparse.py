#!/usr/bin/env python3
"""Sequential parser for Lemmings Revolution compiled levels (COMPILED\\*.LVL).

Mirrors the EXE's loader FUN_004432c1 (and its sub-readers) as recovered with
Ghidra/REA. Function addresses are noted next to each reader for traceability.

Usage: lvlparse.py LEVEL.LVL [--json OUT.json] [--summary]
"""
import json
import os
import struct
import sys


class Stream:
    def __init__(self, data):
        self.d = data
        self.p = 0

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def u16(self):
        v = struct.unpack_from('<H', self.d, self.p)[0]
        self.p += 2
        return v

    def u32(self):
        v = struct.unpack_from('<I', self.d, self.p)[0]
        self.p += 4
        return v

    def i32(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]
        self.p += 4
        return v

    def f64(self, n=None):
        if n is None:
            v = struct.unpack_from('<d', self.d, self.p)[0]
            self.p += 8
            return v
        v = list(struct.unpack_from('<%dd' % n, self.d, self.p))
        self.p += 8 * n
        return v

    def raw(self, n):
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    def str(self):                      # FUN_0047d930: u32 len + chars, no NUL
        n = self.u32()
        return self.raw(n).decode('latin1')

    def magic(self, expect):            # FUN_0047da27
        s = self.str()
        if s != expect:
            raise ValueError('expected %r at 0x%x, got %r' % (expect, self.p, s))

    def strlist(self):
        return [self.str() for _ in range(self.u32())]

    def u32array(self):                 # FUN_0043b640
        n = self.u32()
        return list(struct.unpack_from('<%dI' % n, self.raw(4 * n))) if n else []

    def bytearray_(self):               # FUN_0043b700
        return self.raw(self.u32())


# ---------------------------------------------------------------- 3D model ("Object 09")
def read_poly(s, ptype):
    """One polygon record (FUN_00479f2a/9d/ff4/a067 + material-prefixed variants)."""
    poly = {}
    if ptype >= 4:
        poly['material'] = s.u32()
        ptype -= 4
    nverts = 3 if ptype in (0, 1) else 4
    smooth = ptype in (1, 3)
    if not smooth:
        poly['normal'] = s.f64(3)
        poly['d'] = s.f64()
        poly['verts'] = [{'i': s.u32(), 'uv': s.f64(2)} for _ in range(nverts)]
    else:
        poly['verts'] = [{'i': s.u32(), 'uv': s.f64(2), 'n': s.f64(3), 'd': s.f64()}
                         for _ in range(nverts)]
    return poly


def read_polylist(s):                   # FUN_00469b9f
    s.magic('PolyList 09')
    ptype, count, _size = s.u32(), s.u32(), s.u32()
    if ptype > 7:
        raise ValueError('unknown polygon type %d at 0x%x' % (ptype, s.p))
    return {'type': ptype, 'polys': [read_poly(s, ptype) for _ in range(count)]}


def read_node_base(s, node):            # FUN_0046bb63
    node['matrix'] = s.f64(9)           # FUN_00482108: 3x3
    node['pos'] = s.f64(3)
    node['name'] = s.str()
    node['f100'], node['f108'] = s.f64(), s.f64()
    node['children'] = [read_node(s) for _ in range(s.u32())]
    return node


def read_mesh(s, node):                 # FUN_00469568
    node['vertices'] = [s.f64(3) for _ in range(s.u32())]
    node['normals'] = [s.f64(3) for _ in range(s.u32())]
    mats = []
    for _ in range(s.u32()):            # FUN_0046b4d5
        mats.append({'texture': s.str(), 'flags': s.u32()})
    node['materials'] = mats
    lists = []
    for _ in range(s.u32()):
        s.u32()                         # allocation size of the in-memory list
        lists.append(read_polylist(s))
    node['polylists'] = lists
    return read_node_base(s, node)


def read_node(s):                       # FUN_0046bc94
    kind = s.u32()
    node = {'kind': ['group', 'mesh', 'sprite', 'camera'][kind] if kind < 4 else kind}
    if kind == 0:
        return read_node_base(s, node)
    if kind == 1:
        return read_mesh(s, node)
    if kind == 2:                       # FUN_0047b43c billboard sprite
        node['size'] = s.f64(3)
        node['b110'] = bool(s.u8())
        node['animated'] = bool(s.u8())
        if not node['animated']:
            node['texture'] = s.str()
            node['uv'] = s.f64(4)
        else:                           # FUN_00468be2
            node['anim'] = {'a': s.u32(), 'b': s.u32(), 'c': s.u32(), 'd': s.u32(),
                            'sprite': s.str()}
        node['frame'] = s.u32()
        return read_node_base(s, node)
    if kind == 3:                       # FUN_0047afa1
        node['f118'], node['f120'] = s.f64(), s.f64()
        node['v2'] = s.f64(2)
        node['v3a'], node['v3b'] = s.f64(3), s.f64(3)
        return read_node_base(s, node)
    raise ValueError('unknown node kind %d at 0x%x' % (kind, s.p - 4))


def read_anim(s):                       # FUN_00476267
    a = {'length': s.f64()}
    tracks = []
    for _ in range(s.u32()):            # FUN_004772e0 -> FUN_004775a0
        node = s.u32()
        keys = []
        for _ in range(s.u32()):        # FUN_00477b20 -> FUN_0047cea1
            keys.append({'t': s.f64(), 'v1': s.f64(3), 'v2': s.f64(3),
                         'q': s.f64(4), 'flag': s.u8()})
        tracks.append({'node': node, 'keys': keys})
    a['tracks'] = tracks
    uvtracks = []
    for _ in range(s.u32()):            # FUN_004773f0 -> FUN_0047c92d
        tid = s.u32()
        keys = [{'t': s.f64(), 'a': s.f64(2), 'b': s.f64(2)} for _ in range(s.u32())]
        uvtracks.append({'id': tid, 'keys': keys, 'x': s.u32(),
                         'arr1': s.u32array(), 'arr2': s.u32array()})
    a['uvtracks'] = uvtracks
    a['events'] = [{'a': s.u32(), 'b': s.u32(), 't': s.f64()} for _ in range(s.u32())]
    a['name'] = s.str()
    a['nodes'] = s.u32array()
    return a


def read_object(s):                     # FUN_004749af "Object 09"
    s.magic('Object 09')
    obj = {'root': read_node(s)}
    obj['b2c'] = bool(s.u8())
    if s.u8():
        obj['anims'] = [read_anim(s) for _ in range(s.u32())]
    return obj


# ---------------------------------------------------------------- cylinder (play field)
def read_cylinder(s):                   # FUN_00439fd3
    c = {}
    c['base_u32'] = s.u32()             # FUN_0043d0f0
    c['base_f64'] = s.f64()
    c['profile_pairs'] = [[s.f64(3) + s.f64(3) for _ in range(32)] for _ in range(s.u32())]
    c['profile'] = [s.f64(32) for _ in range(s.u32())]
    c['unused_u32'] = s.u32()           # read and discarded by the loader
    c['mesh'] = read_mesh(s, {'kind': 'mesh'})   # FUN_00469568 at +0x30
    c['rows'] = s.u32()                 # FUN_0043aa63
    c['radius'] = s.f64()               # FUN_0043a4ca
    c['arr42c'] = s.u32array()
    c['arr43c'] = [(s.u32(), s.u32(), s.u32()) for _ in range(s.u32())]
    c['cells_offset'] = s.p
    c['cells'] = s.u32array()           # index = x + y*256
    c['shade_index'] = list(s.bytearray_())
    c['vec_table'] = [s.f64(3) for _ in range(256)]
    c['inner_texture'] = s.str()
    c['outer_texture'] = s.str()
    blocks = []
    for _ in range(32):                 # FUN_00460c40 -> FUN_00461343
        items = []
        for _ in range(s.u32()):
            items.append({'v': s.u32(), 'a': s.u16(), 'b': s.u16(), 'f': s.f64(5)})
        blocks.append(items)
    c['column_blocks'] = blocks
    return c


# ---------------------------------------------------------------- level entities
def read_model(s):                      # FUN_00465914: attached visual
    kind = s.u32()
    if kind == 0:                       # FUN_00450f57: named 3D object
        m = {'kind': 'object', 'name': s.str(), 'f100': s.f64(), 'f108': s.f64(), 'f0f8': s.f64()}
        m['object'] = read_object(s)
        if s.u8():
            m['anim'] = s.str()
        return m
    if kind == 1:                       # FUN_0043cedf -> FUN_00468be2: animated sprite
        return {'kind': 'sprite', 'a': s.u32(), 'b': s.u32(), 'c': s.u32(), 'd': s.u32(),
                'sprite': s.str()}
    if kind == 2:                       # FUN_00466400: particle emitter
        m = {'kind': 'emitter', 'v1': s.f64(3), 'v2': s.f64(3), 'f': s.f64(), 'n': s.u32()}
        m['keys'] = [{'a': s.f64(3), 'b': s.f64(3), 'c': s.f64(4)} for _ in range(s.u32())]
        m['count'] = s.u32()
        s.u32()
        m['name1'], m['name2'] = s.str(), s.str()
        m['children'] = [read_model(s) for _ in range(s.u32())]
        return m
    raise ValueError('unknown model kind %d at 0x%x' % (kind, s.p - 4))


def entity(s):                          # FUN_00423291: every placed thing
    return {'pos': s.f64(3), 'f20': s.f64(), 'f30': s.f64(), 'b38': bool(s.u8()),
            'b28': bool(s.u8()), 'id': s.u16()}


def entity_model(s):                    # FUN_00432283
    e = entity(s)
    e['b40'] = bool(s.u8())
    has_model = s.u8()
    e['b41'] = bool(s.u8())
    if has_model:
        e['model'] = read_model(s)
    return e


def placed(s):                          # FUN_0043130e: entity + bounds/footprint
    e = entity_model(s)
    e['v48'], e['v60'] = s.f64(3), s.f64(3)
    e['pts78'] = [s.f64(3) for _ in range(s.u32())]
    e['pts88'] = [s.f64(3) for _ in range(s.u32())]
    return e


def rects(s):                           # FUN_00431dc0 -> FUN_00433fb9 (grid rectangles)
    return [[s.i32() for _ in range(4)] for _ in range(s.u32())]


def lemming(s):                         # FUN_0042fb5f: pre-placed lemming
    e = entity(s)
    e.update({'dir': s.i32(), 'gravity': s.i32(), 'b370': bool(s.u8()), 'climber': bool(s.u8()),
              'floater': bool(s.u8()), 'b4a': bool(s.u8()), 'type': s.u32(),
              'b5c': bool(s.u8()), 'b5f': bool(s.u8()), 'v68': s.f64(2),
              'v350': s.f64(2), 'v360': s.f64(2)})
    return e


def flyer(s):                           # FUN_0042da25 (uses "fly" anim)
    e = entity_model(s)
    e.update({'f60': s.f64(), 'f68': s.f64(), 'n50': s.u32(), 'anim1': s.str(), 'anim2': s.str(),
              'matrix': s.f64(9), 'vb8': s.f64(3), 'path': s.u32()})
    return e


def entrance(s):                        # FUN_00425e50: lemming hatch
    e = placed(s)
    e.update({'index': s.u32(), 'lemmings': s.u16(), 'u9a': s.u16(), 'u9c': s.u16(),
              'a0': s.u32(), 'a4': s.u32(), 'a8': s.u32(), 'bac': bool(s.u8()),
              'ub4': s.u16(), 'bb6': bool(s.u8()), 'bad': bool(s.u8())})
    return e


def exit_(s):                           # FUN_00426c6b
    e = placed(s)
    e.update({'n98': s.u32(), 'bb0': s.u32() != 0})
    return e


def counter_obj(s):                     # FUN_00424187 -> FUN_00427706
    e = entity(s)
    e.update({'b58': bool(s.u8()), 'v40': [s.u32() for _ in range(4)],
              'b4': s.u32(), 'a0': s.u32(), 'ac': s.u32(), 'b8': s.u32(), 'bc': s.u32(), 'a8': s.u32()})
    return e


def fluid(s):                           # FUN_0042acac (sets cell flag 0x200 water / 0x2000 other)
    e = placed(s)
    e['model2'] = read_model(s)
    if s.u8():
        e['model3'] = read_model(s)
    if s.u8():
        e['model4'] = read_model(s)
    e.update({'mode': s.u32(), 'fluid_type': s.u32(), 'u168': s.u32(), 'v170': s.f64(3),
              'u16c': s.u32(), 'level_a': s.f64(), 'f1a8': s.f64(), 'level_b': s.f64(),
              'name': s.str(), 'quads': [(s.f64(3), s.f64(3)) for _ in range(4)],
              'v278': s.f64(3), 'v290': s.f64(3), 'texture': s.str(), 'u140': s.u32()})
    return e


def two_model_obj(s):                   # FUN_004347ec
    e = placed(s)
    e['model_a'], e['model_b'] = read_model(s), read_model(s)
    e.update({'u98': s.u32(), 'fa0': s.f64(), 'v1b0': s.f64(3), 'name1': s.str(),
              'name2': s.str(), 'sound1': s.str(), 'sound2': s.str()})
    return e


def trigger_base(s):                    # FUN_00433cee
    e = placed(s)
    e.update({'f98': s.f64(), 'bb0': bool(s.u8()), 'ba0': bool(s.u8())})
    return e


TRIGGER_KINDS = {0: 'skill_pad', 1: 'kind1', 2: 'kind2', 3: 'antigrav', 4: 'kind4'}


def trigger(s):                         # FUN_00433dd9
    kind = s.u32()
    e = trigger_base(s)
    e['kind'] = TRIGGER_KINDS.get(kind, kind)
    if kind == 0:                       # FUN_00431b30
        e['value'] = s.u32()
        e['rects'] = rects(s)
    elif kind in (1, 2):                # FUN_00436fed / FUN_0043732d
        e['value'] = s.u32()
        e['rects'], e['rects2'] = rects(s), rects(s)
    elif kind == 3:                     # FUN_0041d730 (AntiGrav sound)
        e['bc'], e['b8'] = s.u32(), s.u32()
    elif kind == 4:                     # FUN_00432938
        e['b8'], e['bc'] = s.u32(), s.u32()
        e['rect'] = [s.i32() for _ in range(4)]
    else:
        raise ValueError('unknown trigger kind %d' % kind)
    return e


def stat(s):                            # FUN_004333d2 (STAT) <- FUN_004364f5
    e = placed(s)
    e.update({'b98': bool(s.u8()), 'fa8': s.f64(), 'uc0': s.u32(), 'b1d1': bool(s.u8()),
              'b1d2': bool(s.u8()), 'anim': s.str(), 'name': s.str(), 'sound1': s.str(),
              'sound2': s.str(), 'b1d0': bool(s.u8()), 'b1d3': bool(s.u8())})
    return e


def dyna(s):                            # FUN_0042576f (DYNA)
    tag = s.str()
    e = stat(s)
    e.update({'tag2': tag, 'v208': s.f64(2), 'v218': s.f64(2), 'path1': s.i32(), 'path2': s.i32(),
              'u1d8': s.u32(), 'u1e8': s.u32(), 'f1f0': s.f64(), 'f1f8': s.f64(),
              'b200': bool(s.u8())})
    return e


def fall(s):                            # FUN_00427ccd (FALL)
    tag = s.str()
    e = stat(s)
    e.update({'tag2': tag, 'sound1b': s.str(), 'sound2b': s.str(), 'f1d8': s.f64(),
              'f1e0': s.f64(), 'name1b': s.str(), 'name2b': s.str()})
    return e


TYPED = {'STAT': stat, 'DYNA': dyna, 'FALL': fall}


def read_entities(s, L):
    bg = {'scenery': read_object(s)}    # FUN_00437d48
    if s.u8():
        bg['scenery2'] = read_object(s)
    L['background'] = bg
    L['u5110'] = s.u32()
    paths = []
    for _ in range(s.u32()):            # FUN_00447960 -> FUN_00452612 (spline paths)
        p = {'closed': bool(s.u8())}
        p['keys'] = [{'t': s.f64(), 'n': s.u32(), 'a': s.f64(2), 'b': s.f64(2)}
                     for _ in range(s.u32())]
        p['ints'] = s.u32array()
        p['name'] = s.str()
        paths.append(p)
    L['paths'] = paths
    L['anim_refs'] = [{'b': bool(s.u8()), 'a': s.str(), 'b2': s.str()} for _ in range(s.u32())]
    L['lemmings'] = [lemming(s) for _ in range(s.u32())]                    # list 0x1ec8
    L['lemmings2'] = []
    for _ in range(s.u32()):                                                # list 0x1ee0
        e = lemming(s)
        e['starts_blocking'] = bool(s.u8())
        L['lemmings2'].append(e)
    L['props'] = [entity_model(s) for _ in range(s.u32())]                 # list 0x1ea0
    L['flyers'] = [flyer(s) for _ in range(s.u32())]                       # list 0x1eb8
    L['entrances'] = [entrance(s) for _ in range(s.u32())]                 # list 0x1ef0
    L['u5568'] = s.u32()
    L['exits'] = [exit_(s) for _ in range(s.u32())]                        # list 0x1f00
    L['list1f30'] = [placed(s) for _ in range(s.u32())]
    L['list1f60'] = [counter_obj(s) for _ in range(s.u32())]
    L['fluids'] = [fluid(s) for _ in range(s.u32())]                       # list 0x1f70
    L['list1f90'] = [two_model_obj(s) for _ in range(s.u32())]
    L['list1f20'] = [entity_model(s) for _ in range(s.u32())]
    L['list1fa0'] = [placed(s) for _ in range(s.u32())]
    L['triggers'] = [trigger(s) for _ in range(s.u32())]                   # list 0x1f50
    objs = []
    for _ in range(s.u32()):                                                # list 0x1f10
        tag = s.str()
        o = TYPED[tag](s)
        o['class'] = tag
        objs.append(o)
    L['objects'] = objs
    L['skills'] = [s.u32() for _ in range(10)]                              # FUN_0045b86d
    L['skills_extra'] = s.u32()
    L['u32list_1fb0'] = s.u32array()
    L['flags'] = [bool(s.u8()) for _ in range(5)]
    L['u16_50a8'] = s.u16()
    L['time_limit'] = s.u32()
    L['events'] = [(s.u32(), s.u32(), s.u32()) for _ in range(s.u32())]   # FUN_0044d570
    L['_trailing'] = len(s.d) - s.p
    return L


def parse(path):
    s = Stream(open(path, 'rb').read())
    L = {'file': os.path.basename(path)}
    s.magic('Level 23')
    L['header_ints'] = [s.u32() for _ in range(6)]
    L['sprite_sets'] = [bool(s.u8()) for _ in range(4)]   # Lemmings, Water, Acid, EvilRat
    L['textures'] = s.strlist()         # FUN_00445c10
    L['sprites'] = s.strlist()          # FUN_00445eb0
    L['lemming_anims'] = s.strlist()    # FUN_00430420
    L['named_objects'] = []
    for _ in range(s.u32()):            # FUN_00439240 objects; vt+0x50 = FUN_00438a40
        name = s.str()
        s.u32()                         # discarded
        m = {'key': name, 'name': s.str(), 'f100': s.f64(), 'f108': s.f64(), 'f0f8': s.f64()}
        m['object'] = read_object(s)    # FUN_00450f57 body
        if s.u8():
            m['anim'] = s.str()
        L['named_objects'].append(m)
    L['sounds'] = s.strlist()           # FUN_00445a10
    L['model_files'] = s.strlist()      # FUN_00460730
    L['level_path'] = s.str()           # FUN_0048251d
    L['cylinder'] = read_cylinder(s)
    L['_offset_after_cylinder'] = s.p
    read_entities(s, L)
    return L


if __name__ == '__main__':
    L = parse(sys.argv[1])
    c = L['cylinder']
    print(L['level_path'], 'rows', c['rows'], 'radius', c['radius'], 'cells@0x%x' % c['cells_offset'],
          'after cyl 0x%x' % L['_offset_after_cylinder'])
