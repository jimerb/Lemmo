# Lemmings Revolution — Reverse-Engineered Game Specification

Source: the CD in the drive (volume `Revolution`, Take-Two Interactive Europe / Psygnosis,
version 1.20.000, built 2000-04). **This is _Lemmings Revolution_ (2000)**, the 3D
"rotating cylinder" Lemmings, not the 1991 original. Everything below was recovered
from the shipped files with REA + Ghidra 12.1.4 (`LEMMINGS REVOLUTION.EXE`, SHA-256
`6ced1ceb…b094`, 6,322 functions; decompile dump in `re/decompiled.c`, one file per
function in `re/funcs/`).

Confidence tags: **[O]** observed directly in code/data, **[I]** inferred from code
structure or data patterns, **[?]** open question.

---

## 1. Disc layout and file formats

| File | What it is |
|---|---|
| `LEMMINGS REVOLUTION.EXE` | The game itself (runs from CD; installer just copies support files). PDB path `D:\lrpc\Source\SkyIslands\Release`. |
| `LEMMINGS.BOX` (323 MB) | `LEMBOX` archive, 10,661 files: levels, textures, sprites, sounds, music. |
| `PATCH.BOX` | `LEMBOX` overriding 2 levels (VH22_KF1, VH09_MT), the level map and the language files. The EXE loads PATCH.BOX first. |
| `*.AVI` | Intel Indeo 5 cut-scenes (frontend, credits, complete, failed, congrats, gameover). |
| `*.CAB/.HDR`, `SETUP.*` | InstallShield 5 installer (registry setup, DirectX 7a). Not needed. |

### 1.1 LEMBOX archive [O] — `tools/lembox.py`
```
"LEMBOX" | u32 n | u32 names_size | n × {u32 len, char name[len]} |
u32 n | u32 offset[n] | u32 n | u32 size[n] | data…
```

### 1.2 Compressed textures (`*.BMP`, `*.ALF`) [O] — `tools/lrbmp.py`
These aren't plain BMP files. Loader `FUN_0045015a` ("LoadBMPImage.cpp"), with the decompressor in hand-written asm at `0x467e03`:
```
u8 chunks | chunks × {u16 chunk_size(incl 5-byte hdr), u16 unpacked, u8 method, payload}
method 3 = stored, 4 = LZ77 + 3 canonical-Huffman tables (literal-run, match-len, distance)
```
The output is an ordinary Windows BMP. `.ALF` files are the matching alpha masks. Names with a
`Hi`/`Lo` suffix are detail levels. Prefixes encode blending: `^` alpha-blended, `~` additive,
`_` colour-keyed, `+` shadow, `$` sprite sheet. All textures are converted to PNG in
`assets/textures/`.

### 1.3 Sprites (`SPRITES\*.SPR`) [O] — `tools/sprparse.py`
`u32 animCount; anim × { u32 frames; frame × { u32 nAngles; angle × FRAME }; str name; f64 duration }`
then a list of vec3 sets. FRAME = sheet rect (`x,y` in the 256² sheet, plus `w,h` and anchor `ax,ay`)
and the UVs. Each animation frame has **5 pre-rendered viewing angles** (the camera
orbits the cylinder). Lemming animations (in `LemmingsHi.spr`), each with its duration:
`bash 1s(24f) block 1s build 1s climb 1s dig 1s drown 1s explode 1s fall 1s flip 1s mine 1s(25f)
shrug 0.5s float 1s umbopen 1s walk 1s(12f) cartwheel 2s`. Variants: `LemmingsWater`, `LemmingsAcid`,
`EvilRat`, `Trampoline`.

### 1.4 Levels (`COMPILED\*.LVL`) [O] — `tools/lvlparse.py` (parses all 102 levels with 0 trailing bytes)
The file is a serialized object graph that mirrors `FUN_004432c1`:
1. Magic `"Level 23"`, 6 u32 memory hints, 4 bools (load sprite sets normal/water/acid/rat).
2. Name lists: textures, sprites, extra anims, named 3D objects, sounds, model files, level path.
3. **Cylinder** (`FUN_00439fd3`): lattice, 3D mesh, `rows`, then the collision grid
   (`u32 count; u32 cell[rows*256]`), a shading index, a 256-entry vector table, and texture names.
4. Background scenery ("Object 09" 3D model trees with keyframe animation and "PolyList 09" meshes).
5. Entity lists: paths, pre-placed lemmings, entrances, exits, counters, fluids, teleporters,
   triggers (skill pads / levers / anti-grav / rect zones), STAT/DYNA/FALL trap objects.
6. Skill counts `u32[10]`, flags, **lemmings to save (u16)**, **time limit (u32 s)**, events.

`tools/export_levels.py` turns all of this into `assets/levels/<NAME>.json` plus `index.json`
(the campaign order, titles, time, save/total from `COMPILED\LEVELMAP.DAT`).

### 1.5 Other data
* `COMPILED\LEVELMAP.DAT` [O]: 125 slots of `{str name, str title, u32 time, u32 save, u32 total}`.
  102 are real levels; the rest are `blank`. Difficulty tiers from the strings: Easy, Medium,
  Hard, Very Hard, Special (the level select is "Sky Islands").
* `COMPILED\RELEASERATE.PC` [O]: 99 doubles giving the **seconds between lemmings** for release rate 1..99
  (5.0 s at rate 1 down to 0.2 s at rate 99, roughly linear).
* `LANGUAGE\*.LTX`: UI and tutorial strings (offset table + text), in 6 languages.
* `MUSIC\LEMMING01-13.WAV`, `SOUNDS\*.WAV`: plain PCM.

---

## 2. World model

* The play field is a **cylinder grid: 256 columns × `rows` (96 in every shipped level)** [O].
  x wraps modulo 256 (`FUN_0040dec0`) and y is clamped to [0, rows-1] (`FUN_0040df50`).
* **Row 0 is the bottom; world Y is up** [O]. Each lemming has a gravity sign (`+0x44`, normally +1).
  Falling decreases y by `g·dist`, and a step up is `y+g`. Anti-gravity flips `g`.
* Cell index `x + y*256`. Each cell is a u32 bit-field [O, usage traced in code]:

| Bit | Meaning | Evidence |
|---|---|---|
| 0x0001 | solid earth (diggable) | walker/faller tests `&1`; builder sets `|=1` |
| 0x0002 | **metal**: blocks bash/mine/dig/explosion | carve rules |
| 0x0004 | one-way: can't be bashed/mined **rightwards** (dir +1) | `local_18=4` |
| 0x0008 | one-way: can't be bashed/mined **leftwards** (dir −1) | `local_18=8` |
| 0x0010 | can't dig **down** (gravity +1) | digger mask 0x10 |
| 0x0020 | can't dig **up** (gravity −1) | digger mask 0x20 |
| 0x0040, 0x0100 | queried by unreferenced helpers [?] | `FUN_0042f3f4/f53d` |
| 0x0080 | object footprint (entrance/exit/trap); not collidable | stamped by `FUN_0043119b`, ignored by ground tests |
| 0x0200 | **water** surface/volume | fluid object stamps it |
| 0x0400 | marks cells of a closed sliding door (stamped as 0x403 with earth+metal) | `FUN_00427554` / `FUN_004275d4` |
| 0x0800 | lemming-only barrier (rats/type 3 pass); turns walkers, stops carving | walker + bash |
| 0x1000 | **trampoline cell**: landing here starts a Bounce | faller |
| 0x2000 | **lava** | fluid stamps it |
| 0x4000 | **acid** | fluid stamps it |
| 0x8000 | **spinner pad**: a walker whose floor cell has it flips gravity (action 0x2b, "cartwheel" anim), but only while the anti-gravity trigger around it is enabled | walker `FUN_0041bffc`, list `0x4c8a48` |

* **3D placement** [O]: the cylinder carries a lattice of 7 rings (one per 16 rows) × 32 angular
  segments (one per 8 columns). Each lattice point stores an inner and an outer vec3, and a world
  position is a bilinear blend of the lattice by (x/8, y/16) plus a lerp by depth z∈[0,1]
  (`FUN_0043d56c`). Shipped levels are radius 50 (inner) to 60 (outer), 96 units tall, with
  small per-segment radius wobble. Terrain is drawn on `INN_*` and `OUT_*` textures split into
  8×3 tiles (`_<col>_<row>`, each with a `Hi` version), regenerated when cells change.
* The camera orbits the cylinder (right-drag rotates, SPACE zooms, "flip" views the inside or outside).

## 3. Simulation

Variable-dt simulation in **seconds** [O]. Every action consumes `dt` and loops while time is
left, so behaviour is frame-rate independent.

### 3.1 Lemming object [O]
`x,y,z` (doubles; x = column, y = feet row, z = depth), `dir` ±1 (+0x40), `gravity` ±1 (+0x44),
`climber` (+0x48), `floater` (+0x49), `umbrellaOpen` (+0x4b), `type` (+0x4c: 0 normal,
1 water lemming, 2 acid lemming, 3 evil rat), `speedMod` (+0x50: 3 = half speed), the current fluid,
one **primary action** (+0x340) and a list of **concurrent actions** (+0x374, e.g. bomb countdown).
Actions are classes. `SetAction` (`FUN_0042e696`) runs the new action's begin hook (sets
the animation), ends the old one, and either replaces the primary action or appends a concurrent one.

### 3.2 Action IDs (= skill enum where applicable) [O]
| id | Action | id | Action |
|---|---|---|---|
| 0 | Climber (climbing) | 0x12 | Walk |
| 1 | Floater (grant) | 0x13 | Fall |
| 2 | Bomb explosion | 0x1a | Splat / fell out of world |
| 3 | Blocker | 0x1d | Shrug (builder out of bricks) |
| 4 | Builder | 0x1e | Flip (climber tops out) |
| 5 | Basher | 0x1f | Bomb countdown (5 s) |
| 6 | Miner | 0x20 | "Oh no" before exploding |
| 7 | Digger | 0x21 | Bounce (trampoline) |
| 0xb | Rocket | 0x23 | Drown |
| 0xc | Cartwheel | 0x26 | Explode anim |
| 0xd | Anti-gravity | 0x2a | Exiting (into balloon) |
| 0xe | Trampoline (lemming becomes one) | 0x2b | Cartwheel via spinner zone |
| 0xf / 0x10 | Slower / Faster | 0x2c | Captured (teleporter/trap) |
| 9 | Nuke | 0x14–0x19, 0x2e | death-effect particle states (visual) |

### 3.3 Constants [O]
| Quantity | Value | Source |
|---|---|---|
| Walk speed | **5 columns/s** (halved if speedMod==3) | `DAT_004b10b0` |
| Climb speed | 5 rows/s | same constant |
| Fall speed | **20 rows/s**, floater 10 rows/s | `DAT_004b0a18` |
| Umbrella opens after | 10 rows fallen (floater only) | `DAT_004b03e8` |
| Fatal fall | > **30 rows** (unless floater, or water lemming on 0x200, or acid lemming on 0x4000) | `DAT_004b10a8` |
| Max step up / down while walking | 2 rows / 2 rows | walker `FUN_0041bffc` |
| Bomb countdown | 5 s | `FUN_00413d40(…,5,0)` |
| Explosion | 7×7 disc (9×9 alternate) of cells, skips metal / 0x200 / 0x800 | masks at `0x4b1528` / `0x4b155c` |
| Builder | 12 bricks; each brick = 2 cells at foot level ahead; warning sound when < 4 left | `FUN_0040f8d1` |
| Release interval | `RELEASERATE.PC[rate-1]` seconds | `FUN_0042609d` |
| Skill-cycle "frames" | 100 per animation loop (staggered actions) | `DAT_004bf4c8` |

### 3.4 Walking (`FUN_0041bdd4` / `FUN_0041bffc`) [O]
x advances by 5·dt·dir. Each time x crosses a column boundary, the step check runs on the
column ahead (x', y = feet):
1. A spinner pad (0x8000) under the feet, inside an enabled anti-gravity trigger, flips gravity (0x2b), then Fall.
2. In fluid: drown unless (water lemming in water) or (acid lemming in acid). Lava always kills.
3. A barrier (0x800) at feet level turns the lemming around (ignored by type 3 / rats).
4. Feet cell empty: if the ground below is also empty, look down 1, then 2 more; if still empty,
   **Fall**; otherwise step down.
5. Feet cell solid: if cell+1 up is free, step up 1; if free at +2, step up 2;
   otherwise it's a wall: a climber starts **Climbing**, everyone else turns around.

### 3.5 Falling (`FUN_004160bd`, landing `FUN_00416433`) [O]
Moves cell by cell at 20 rows/s and counts rows fallen. A floater opens the umbrella at 10 rows
(the "float"/"umbopen" anims) and then falls at half speed. Landing: out of the world →
death; trampoline cell (0x1000) → Bounce; solid → splat if fallen > 30 rows (with the
exceptions above), otherwise walk.

### 3.6 Climbing (`FUN_004137ca`, `FUN_004139bf`) [O]
Climbs at 5 rows/s. Solid overhead → "Climber hit head": turn around and fall. Free top →
Flip over the edge (anim `flip`), then walk.

### 3.7 Skills (event tables of 100-step cycles) [O]
* **Basher**: tunnel 4 cells high. Carves at steps 12/16/60/64, moves 1/13 column on 12 sub-steps,
  snaps to the next column at step 92. Stops at metal, the matching one-way bit, or 0x800 ("chink" sound),
  and after 2 cycles with nothing to bash.
* **Digger**: per cycle, at step 25 clears 3 cells (x−1..x+1) below and moves down 1; stops at metal or
  no-dig bits; step 30 checks for ground and falls if there is none.
* **Miner**: diagonal tunnel. Carves rows 3..−1 at steps 12–20, creeps forward at steps 24–64,
  and at step 68 moves 1 forward and 1 down.
* **Builder**: step 81 lays a brick (2 cells ahead at foot level), step 90 climbs a step
  (blocked if the head hits). After 12 bricks → Shrug, then walk.
* **Blocker**: stands still and turns other lemmings around; falls if the ground disappears.
* **Bomber**: concurrent 5 s countdown → "Oh no" → explode (cells cleared, nearby lemmings affected [?]).
* **Climber / Floater**: permanent flags.

**Assignment rules** (`FUN_0045a0e0`) [O]: never to a drowning lemming or one in state 0x28.
Climber/floater need the flag to be unset; bomber needs no running countdown; block/build/bash/mine/dig
need the lemming on the ground, not falling/bouncing/flipping, and not climbing, blocking or
being a trampoline. Dig is also refused on a water or acid surface. Panel slot 8 is the level's **special skill**
(Rocket / Cartwheel / Anti-gravity / Trampoline / Slower / Faster). Slot 9 is Nuke.

### 3.8 Level objects and the command system [O unless marked]
Every placed object has an id (u16) and an **enabled** flag (entity +0x38). The level update (`FUN_004423d2`) only updates triggers, doors and fluids whose flag is set (`FUN_0041cba0`).

**Commands** (`FUN_00433b2e`) are 4 ints `[target, op, a, b]`, stored in the level as the triggers'
"rect" lists. `target >= 0` is looked up in the object table (`FUN_00444ba1`):
op **4** calls vtable+4 ("on"), op **5** vtable+8 ("off"), op **0** vtable+0xc ("set", a, b).
`target == -2` means the triggering lemming: `[-2, 6, 1]` gives it **Faster** (action 0x10,
`FUN_00416730`) and `[-2, 6, 2]` gives **Slower** (0xf, `FUN_0041ac50`, or refreshes a running one).
What on and off mean per object:

| Object | on (op 4) | off (op 5) | set (op 0) |
|---|---|---|---|
| Trigger | enable | disable | – |
| Door ("counter", list 0x1f60) | open | close | – |
| Fluid | fill to `levelA` | drain to `levelB` | – |
| STAT/DYNA trap | enable | disable, releasing caught lemmings | DYNA: path 0 / 1 / toggle (`FUN_00424583`) |
| Prop (list 0x1f20) | show | hide | – |

**Triggers** share a base update (`FUN_004339fc`): while the cooldown `f98` is over, call the idle hook
(vtable+0x24). Then, if the detector (vtable+0x1c) finds a lemming and the cooldown is over, fire
(vtable+0x20) and restart the cooldown. Detection tests the lemming position against the footprint
(`FUN_00430ba1`).
* **kind 0, button** (vtable `0x4b1148`): fires once (`state` 0→1) and runs `rects`.
* **kind 1, lever** (`0x4b1288`): state ±1. In state −1 a lemming walking right (dir +1) flips it to +1
  and runs `rects2`; in state +1 a lemming walking left flips it back and runs `rects`. Vtable slot 10
  applies the starting `value` at level start. In 220 of 231 doors and 516 of 520 fluids that start state
  agrees with the controlled object's own [I].
* **kind 2, timed plate** (`0x4b12b4`): a lemming on it runs `rects` (state 1). When the 5 s cooldown runs
  out the idle hook runs `rects2` (state 2).
* **kind 3, anti-gravity** (`0x4b0d80`): only the visual/sound object. Its enabled flag gates the spinner pads.
* **kind 4, speed pad** (`0x4b1178`): every lemming inside whose dir matches `bc` (0 = any) and whose
  gravity matches the flag gets the single command (Faster in every shipped level).

**Doors** (list 0x1f60, `FUN_00424187`, update `FUN_00423749`). The rect is `[x0, x1, yTop, yBottom]`
(half-open), with `a0` as the start state (1 open, 2 closed). Moving between states slides a fade value
at 3/s (`DAT_004bf6d0`). On reaching closed the cells get `|= 0x403`; on reaching open they get `&= ~0x403`.
A lemming inside while it closes is flagged (+0x5d) and dies (action 0x25). Mode `b4` 1 or 2 makes it a
**counting door**: lemmings entering the rect (mode 2 by walking, mode 1 by falling) increment `b0`,
or decrement it when they move in direction `a8`. When `b0` reaches `ac` it closes, once that lemming
is through. The remaining count is shown with the `_limit` digits.

**Fluids** (list 0x1f70, `FUN_0042acac`, update `FUN_0042b24d`). Mode 0 starts full at `levelA`.
Mode 1 starts drained at `levelB`, and its baked cells are cleared on load. Filling stamps the flag up to
`min.y + level`; draining clears and re-stamps. Rates come from the per-type table built in
`FUN_00428848`: water 2, lava 0.5, acid 1 rows/s. Type 0 stamps 0x200, type 1 stamps 0x2000. Acid is
not re-stamped by the original [O]; the remake stamps 0x4000 too.

**Teleporters** (list 0x1f90, `FUN_004347ec`, update `FUN_00434b0f`). `u98` is the **partner's object
id**, `fa0` the travel delay (0.5 s or 3 s in shipped levels) and `v1b0` the exit point. Links needn't be
symmetric (VH12 and VH18 have one-way and many-to-one links), and file order is often not the pairing
(M18, H06).

**Traps.** STAT (`0x4b11b0`, update `FUN_00432e3f`): while enabled, it catches lemmings inside the
footprint (`b1d1`: all of them, otherwise one per attack). With an attack animation named, it ignores
others until the animation ends [I: the remake uses 1.5 s]. `uc0` is the death action; `b1d3` makes it
switch off after one kill.
DYNA (`0x4b0f28`, update `FUN_0042478f`) is a STAT that moves along a **path** (level list after the
background). A path is a polyline of keys `{len, n, p(x,y), v(x,y)}` with position `p + v·s` for
`s ∈ [0, len]`. The trap advances `s` by `speed·dt` (`f1f8`), and `FUN_00451997` walks the keys:
open paths ping-pong (flag +0x200), closed paths loop. Each tick it clears earth along its leading
edge: `n` bit 1 means vertical, bit 0 positive, XOR the reverse flag. It reverses when that edge holds
metal. The kill box is `pos + v208 .. pos + v218`. `path2` plus the paths' junction lists let `set`
commands move it to the other track at a junction [I for the exact junction rule]. Which edge rows are
cut is [I]: the remake skips the box's bottom row so rollers don't trench their own floor.

**Pre-placed lemmings**, including ones that start as blockers. Evil rats are type 3.

### 3.9 Special skills (panel slot 8, type in +0x2c, factory `FUN_0045afeb`) [O unless marked]
* **Rocket** (0xb, `FUN_0041a520`): starts a type-1 countdown (`FUN_00413d40(5,1)`). On expiry
  (`FUN_00414370`) it gets action 0xb flight (`FUN_0041a662`): y moves against gravity at **25 rows/s**
  (`DAT_004b0c40`). Hitting a non-empty, non-footprint cell gives the explosion action (`FUN_004081b0` →
  blast `FUN_0043f510`); leaving the world kills it.
* **Cartwheel** (0xc, `FUN_0041cbc0` / update `FUN_0041cd24`): moves at walk speed × 2 (`DAT_004b0d48`),
  clearing the 3 body rows ahead. Metal or the one-way bit for its direction stops it (`FUN_0042f8b9`).
  It also clears the floor cell of each new column [O], which the remake doesn't copy [I]. A 5 s
  type-2 countdown runs alongside.
* **Trampoline** (0xe, `FUN_0041b630`): the lemming's column gets `0x882` (metal | footprint | barrier) on
  4 rows, and the cell above the feet gets `0x1082` (adding the trampoline bit). A faller landing on 0x1000
  starts **Bounce** (0x21, `FUN_0040eec4`): `h(t) = 35t − 12.5t²` at walk speed horizontally. The remake
  widens the springy cell to 3 columns.
* **Anti-gravity** (0xd, `FUN_0040bac0`): `FUN_0042f5e3` negates gravity.
* **Slower** (0xf): speedMod 3 (walk and climb at half speed) plus a 5 s countdown. **Faster** (0x10):
  speedMod 2, so the lemming update loop runs twice per tick (`FUN_0042e2bf`), for 5 s.
* Assignment (`FUN_0045a0e0`): rocket and cartwheel need a lemming that isn't a trampoline, blocker or
  climber. The trampoline excludes climbers. All of them need it on the ground and not falling,
  bouncing or flipping.

### 3.10 Win/lose [O for data, I for flow]
The level ends when every lemming is out or dead, the timer runs out, or a nuke finishes.
Success if saved ≥ `toSave`. UI strings: "You Totally Stormed That Level!", "You Failed To Rescue
Enough Lemmings!". Holding the balloon speeds up time; double-click nukes.

---

## 4. Open questions / next probes
* ~~Trigger kinds 0/2/4, counter objects, rocket/faster/slower/anti-gravity~~: resolved, see §3.8 and §3.9.
* Trap attack-animation lengths (they gate STAT traps) live in the model files and aren't parsed yet.
* How the bomb blast affects nearby lemmings, and whether blockers release.
* The 0x40 and 0x100 cell bits.
* Runtime confirmation: none of this was observed running. It's all static analysis. The
  game could be run under Wine to validate timings.
