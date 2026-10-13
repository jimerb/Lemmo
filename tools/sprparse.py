#!/usr/bin/env python3
"""Parser for Lemmings Revolution sprite definitions (SPRITES\\*.SPR), per FUN_00483ee0.

  u32 anim_count
  anim_count x {
      u32 view_count                          (pre-rendered camera angles)
      view_count x { u32 frame_count; frame_count x FRAME }
      str name (u32 len + chars)
      f64 duration_seconds
  }
  u32 set_count; set_count x { u32 n; n x vec3(f64) }   (FUN_0047c633)
FRAME (FUN_00485cd0): u32 a,b,c,d; f64 u0,v0,u1,v1; u32 e,f,w,h; str sheet

Usage: sprparse.py FILE.SPR [--json OUT]
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from lvlparse import Stream  # noqa: E402


def parse(path):
    s = Stream(open(path, 'rb').read())
    anims = []
    for _ in range(s.u32()):
        views = []
        for _ in range(s.u32()):
            frames = []
            for _ in range(s.u32()):
                frames.append({'i': [s.i32() for _ in range(4)], 'uv': s.f64(4),
                               'j': [s.i32() for _ in range(4)], 'sheet': s.str()})
            views.append(frames)
        anims.append({'views': views, 'name': s.str(), 'duration': s.f64()})
    sets = [[s.f64(3) for _ in range(s.u32())] for _ in range(s.u32())]
    extra = s.f64((len(s.d) - s.p) // 8) if len(s.d) > s.p else []  # lemming sets: 48 doubles
    return {'anims': anims, 'sets': sets, 'extra': extra}


if __name__ == '__main__':
    r = parse(sys.argv[1])
    if '--json' in sys.argv:
        json.dump(r, open(sys.argv[sys.argv.index('--json') + 1], 'w'))
    for a in r['anims']:
        print('%-14s dur=%.3f views=%d frames/view=%s first=%s' % (
            a['name'], a['duration'], len(a['views']), [len(v) for v in a['views']][:3],
            a['views'][0][0] if a['views'] and a['views'][0] else None))
