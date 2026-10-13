#!/usr/bin/env python3
"""Dump the transitive closure of deserialization functions reachable from a root
(functions that, directly or via callees, call the stream primitives)."""
import re, sys, os
FD = sys.argv[1]; roots = sys.argv[2:]
PRIM = {'0047dab8','00402560','00402580','00402540','0047d930','00423360','0043b5b0'}
code = {}
for fn in os.listdir(FD):
    code[fn[:-2]] = open(os.path.join(FD, fn)).read()
calls = {a: set(re.findall(r'FUN_([0-9a-f]{8})', t)) - {a} for a, t in code.items()}
memo = {}
def reads(a, stack=()):
    if a in PRIM: return True
    if a in memo: return memo[a]
    if a in stack or a not in calls: return False
    r = any(reads(c, stack + (a,)) for c in calls[a])
    memo[a] = r; return r
seen = []; todo = list(roots)
while todo:
    a = todo.pop(0)
    if a in seen or a in PRIM or a not in code: continue
    seen.append(a)
    for c in sorted(calls[a]):
        if reads(c): todo.append(c)
skip = re.compile(r'^\s*$|ExceptionList|puStack_c|local_8 = |local_8\._0_1_|FUN_00403eb0|FUN_0040f860|^  [a-z0-9 ]+ \*?[A-Za-z0-9_]+( \[\d+\])?;$')
for a in seen:
    print('\n'.join(l for l in code[a].splitlines() if not skip.search(l)))
