#!/usr/bin/env python3
"""Export every Lemmings Revolution level to gameplay-ready JSON for the web port.

Output: assets/levels/<NAME>.json and assets/levels/index.json
Grid encoding: "cells" is run-length encoded [[value, count], ...] in row-major order,
row 0 = BOTTOM of the cylinder (world Y up), 256 columns that wrap.
"""
import glob
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lvlparse  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
SKILLS = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger',
          'special', 'nuke']
FLUIDS = {0: 'water', 1: 'lava', 2: 'acid'}


def rle(cells):
    out = []
    for v in cells:
        if out and out[-1][0] == v:
            out[-1][1] += 1
        else:
            out.append([v, 1])
    return out


def levelmap():
    d = open(os.path.join(ROOT, 'extracted/patch/COMPILED/LEVELMAP.DAT'), 'rb').read()
    p, rows = 0, []
    while p < len(d):
        n = struct.unpack_from('<I', d, p)[0]
        name = d[p + 4:p + 4 + n].decode('latin1')
        p += 4 + n
        n = struct.unpack_from('<I', d, p)[0]
        title = d[p + 4:p + 4 + n].decode('latin1')
        p += 4 + n
        t, save, total = struct.unpack_from('<3I', d, p)
        p += 12
        rows.append({'slot': len(rows), 'name': name, 'title': title, 'time': t,
                     'save': save, 'total': total})
    return rows


def xyz(v):
    return [round(c, 4) for c in v]


def placed(e):
    return {'pos': xyz(e['pos']), 'min': xyz(e['v48']), 'max': xyz(e['v60']), 'id': e['id']}


def model_names(m, acc):
    if isinstance(m, dict):
        for k, v in m.items():
            if k in ('name', 'key', 'texture', 'sprite') and isinstance(v, str):
                acc.append(v)
            model_names(v, acc)
    elif isinstance(m, list):
        for v in m:
            model_names(v, acc)
    return acc


def entrance_type(e):
    names = ' '.join(model_names(e.get('model'), [])).lower()
    return 2 if 'lem_box_acid' in names else 1 if 'lem_box_water' in names else 0


def export(path):
    L = lvlparse.parse(path)
    c = L['cylinder']
    out = {
        'name': os.path.splitext(os.path.basename(path))[0],
        'timeLimit': L['time_limit'],
        'toSave': L['u16_50a8'],
        'skills': {SKILLS[i]: n for i, n in enumerate(L['skills']) if i != 8},
        'specialSkillSlot': L['skills'][8],
        'spriteSets': dict(zip(['normal', 'water', 'acid', 'rat'], L['sprite_sets'])),
        'grid': {'cols': 256, 'rows': c['rows'], 'rowZeroIsBottom': True, 'cells': rle(c['cells'])},
        'cylinder': {
            'lattice': [[[xyz(p[:3]), xyz(p[3:])] for p in ring] for ring in c['profile_pairs']],
            'innerTexture': c['inner_texture'], 'outerTexture': c['outer_texture'],
        },
        'entrances': [dict(placed(e), lemmos=e['lemmings'], releaseRate=e['a0'],
                           releaseRateMin=e['a4'], releaseRateMax=e['a8'], index=e['index'],
                           spawn=[e['u9a'], e['u9c']],
                           dir=-1 if e['ub4'] == 0xffff else 1, lemType=entrance_type(e))
                      for e in L['entrances']],
        'exits': [dict(placed(e), variant=e['n98']) for e in L['exits']],
        'fluids': [dict(placed(f), type=FLUIDS.get(f['fluid_type'], f['fluid_type']), mode=f['mode'],
                        levelA=f['level_a'], levelB=f['level_b']) for f in L['fluids']],
        'triggers': [dict(placed(t), kind=t['kind'], value=t.get('value'),
                          rects=t.get('rects'), rects2=t.get('rects2'), rect=t.get('rect'))
                     for t in L['triggers']],
        'traps': [dict(placed(o), cls=o['class'], name=o['name'], anim=o['anim'],
                       sound1=o['sound1'], sound2=o['sound2']) for o in L['objects']],
        'teleporters': [dict(placed(o), sound1=o['sound1'], sound2=o['sound2']) for o in L['list1f90']],
        'counters': [{'pos': xyz(o['pos']), 'id': o['id'], 'values': o['v40'],
                      'limit': o['b4']} for o in L['list1f60']],
        'preplacedLemmos': [{'pos': xyz(l['pos']), 'dir': l['dir'], 'gravity': l['gravity'],
                               'climber': l['climber'], 'floater': l['floater'], 'type': l['type'],
                               'blocking': l.get('starts_blocking', False)}
                              for l in L['lemmings'] + L['lemmings2']],
        'sounds': L['sounds'],
        'models': [m['key'] for m in L['named_objects']],
    }
    return out


def main():
    dst = os.path.join(ROOT, 'assets/levels')
    os.makedirs(dst, exist_ok=True)
    index = levelmap()
    names = {}
    for p in sorted(glob.glob(os.path.join(ROOT, 'extracted/box/COMPILED/*.LVL'))):
        pp = p.replace('/box/', '/patch/')
        p = pp if os.path.exists(pp) else p
        lv = export(p)
        names[lv['name'].upper()] = lv['name']
        json.dump(lv, open(os.path.join(dst, lv['name'] + '.json'), 'w'), separators=(',', ':'))
    for row in index:
        row['file'] = names.get(row['name'].upper())
    json.dump(index, open(os.path.join(dst, 'index.json'), 'w'), indent=1)
    print('exported', len(names), 'levels;', sum(1 for r in index if r['file']), 'in campaign map')


if __name__ == '__main__':
    main()
