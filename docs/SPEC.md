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
| 0x0400 | render/texture hint (mesh builder) [I] | `FUN_00461e0d` |
| 0x0800 | lemming-only barrier (rats/type 3 pass); turns walkers, stops carving | walker + bash |
| 0x1000 | **trampoline cell**: landing here starts a Bounce | faller |
| 0x2000 | **lava** | fluid stamps it |
| 0x4000 | **acid** | fluid stamps it |
| 0x8000 | spinner zone → cartwheel (unless already cartwheeling) | walker |

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
| 0xb | Rocket [I] | 0x23 | Drown |
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
1. A spinner zone (0x8000) ahead starts a Cartwheel, then a Fall.
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

### 3.8 Level objects [O for data, I for some semantics]
* **Entrance** ("lem box"): lemming count, release rate plus min/max, footprint.
* **Exit** (hot-air balloon basket): footprint; lemmings entering go to state 0x2a.
  Some exits have a capacity shown with the `_limit0-9` digit textures [I].
* **Fluids**: water/lava/acid volumes, optionally moving between two levels (mode 1) [I].
* **Triggers**: skill pads (kind 0), levers/switches (kind 1, value ±1), kind 2,
  **anti-gravity zones** (kind 3), and rect-zone triggers (kind 4) [I for kinds 0/2/4].
* **Teleporters** (two linked models, used in "The Lone Ranger") [I].
* **Traps**: STAT (static, `attack`/`rest` anims) and DYNA (moving, e.g. deathroller); 3D models
  `buzzsaw, tonweight, clawgrab, hammer, ghost, crab, venusf, robin, scorp, boot, icebreak,
  demolball, mincer, deathroller`.
* **Pre-placed lemmings**, including ones that start as blockers. Evil rats are type 3.

### 3.9 Win/lose [O for data, I for flow]
The level ends when every lemming is out or dead, the timer runs out, or a nuke finishes.
Success if saved ≥ `toSave`. UI strings: "You Totally Stormed That Level!", "You Failed To Rescue
Enough Lemmings!". Holding the balloon speeds up time; double-click nukes.

---

## 4. Open questions / next probes
* Exact semantics of trigger kinds 0, 2 and 4, and of counter objects (list 0x1f60). Read their
  virtual `Update`/`OnLemming` methods (vtables `0x4b1148`, `0x4b12b4`, `0x4b1178`, `0x4b0f00`).
* Rocket / Faster / Slower / Anti-gravity action details (ctors `0x41a520`, `0x416730`, `0x41ac50`, `0x40bac0`).
* How the bomb blast affects nearby lemmings, and whether blockers release.
* The 0x40, 0x100 and 0x400 cell bits.
* Runtime confirmation: none of this was observed running. It's all static analysis. The
  game could be run under Wine to validate timings.
