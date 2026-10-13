# Lemmings Revolution — reverse engineering workspace

The groundwork for a modern web remake of **Lemmings Revolution** (Psygnosis/Take-Two, 2000),
recovered from the original CD.

* **`docs/SPEC.md`**: the game specification: world model, cell flags, physics constants,
  every lemming action, skill rules, level objects, and all file formats.
* **`assets/levels/*.json`**: all 102 levels in a clean JSON format (grid, entrances, exits,
  skills, fluids, triggers, traps, the cylinder lattice), plus `index.json` (campaign order,
  titles, time limits, save targets).
* **`assets/textures/**.png`**: every texture decoded from the custom compressed BMP format.
* `extracted/`: raw files from `LEMMINGS.BOX` / `PATCH.BOX` and the disc (EXE, installer files).
* `re/`: the Ghidra decompile of the EXE (`decompiled.c`, plus `funcs/<addr>.c`, one file per function).

## Tools (`tools/`, Python 3, Pillow needed only for PNG output)
```
python3 tools/lembox.py list|extract ARCHIVE [OUTDIR] [filter]   # LEMBOX archives
python3 tools/lvlparse.py LEVEL.LVL                              # full level parser
python3 tools/export_levels.py                                   # -> assets/levels/*.json
python3 tools/lrbmp.py IN.BMP OUT.bmp | --dir SRC DST            # texture decompressor
python3 tools/sprparse.py FILE.SPR                               # sprite/animation tables
python3 tools/pemem.py EXE dwords|doubles|str 0xVA [n]           # read EXE data by address
```
Level viewer: run `python3 -m http.server 8765` in this folder and open
<http://localhost:8765/tools/viewer.html>.

The original game data is copyrighted. Use these extractions as reference for your own build;
don't redistribute them.
