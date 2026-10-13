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


def s32(v):
    return v - (1 << 32) if v >= 1 << 31 else v


def cmds(rs):
    return None if rs is None else [[s32(r[0]) if r[0] >= 1 << 31 else r[0], r[1], r[2], r[3]] for r in rs]


def trigger(t):
    out = dict(placed(t), kind=t['kind'], value=s32(t['value']) if isinstance(t.get('value'), int) else None,
               rects=cmds(t.get('rects')), rects2=cmds(t.get('rects2')), rect=t.get('rect'),
               delay=t['f98'], flag=t['ba0'], active=t['b38'])
    if t['kind'] == 'kind4':
        out['dir'] = s32(t['bc'])
        out['cmd'] = t['rect'][:3] + [0]
    return out


def trap(o):
    out = dict(placed(o), cls=o['class'], name=o['name'], anim=o['anim'], sound1=o['sound1'],
               sound2=o['sound2'], active=o['b38'], killAll=o['b1d1'], oneShot=o['b1d3'])
    if o['class'] == 'DYNA':
        out.update(path=o['path1'], path2=o['path2'], box=o['v208'] + o['v218'], speed=o['f1f8'],
                   seg=o['u1e8'], s=o['f1f0'], reverse=o['b200'])
    return out


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
        'fluids': [dict(placed(f), type=FLUIDS.get(f['fluid_type'], f['fluid_type']), mode=f['mode'], active=f['b38'],
                        levelA=f['level_a'], levelB=f['level_b']) for f in L['fluids']],
        'triggers': [trigger(t) for t in L['triggers']],
        'traps': [trap(o) for o in L['objects']],
        'paths': [{'closed': p['closed'], 'name': p['name'], 'junctions': p['ints'],
                   'keys': [{'len': round(k['t'], 4) if k['t'] != float('inf') else 1e9, 'n': k['n'],
                             'p': xyz(k['a']), 'v': xyz(k['b'])} for k in p['keys']]}
                  for p in L['paths']],
        'teleporters': [dict(placed(o), partner=o['u98'], delay=o['fa0'], exit=xyz(o['v1b0'][:2]),
                             sound1=o['sound1'], sound2=o['sound2']) for o in L['list1f90']],
        # "Counter" objects (list 0x1f60) are sliding metal doors; some count Lemmo's through.
        'counters': [{'pos': xyz(o['pos']), 'id': o['id'], 'values': o['v40'], 'rect': o['v40'],
                      'active': o['b38'], 'mode': o['b4'], 'open': o['a0'] == 1, 'count': o['ac'], 'countDir': s32(o['a8'])}
                     for o in L['list1f60']],
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
