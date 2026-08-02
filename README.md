# BA Memorial Lobby Player

《蔚藍檔案》(Blue Archive) Memorial Lobby viewer built with Electron + PixiJS + Spine. Loads the in-game lobby spine animations (idle / talk / pat) with the matching voice lines and BGM, plus camera controls and amplitude-driven lip-sync.

## Features

- 266 lobby skeletons from `assets/lobby_index.json` (main LOD variant per lobby, quirk handling for `Airi0/Airi`, `CH9996/CH0996`, `juri/Juri`)
- Three animation tracks:
  - Track 0: idle / start (`Idle_*`)
  - Track 1: random `Talk_N_M` (voiced, animation-event driven)
  - Track 2: `Pat_01_A` (headpat)
- Japanese voice lines routed through a WebAudio analyser; mouth-bone `scaleY` is driven by live RMS amplitude (lip-sync) on top of the built-in mouth timelines in `_M` animations
- BGM per lobby from `lobby_bgm_mapping.csv` (`Theme_*.ogg`)
- Camera from `lobby_camera_config.json`: auto-fit on load, wheel zoom around the cursor, drag pan, `MaxScale` clamp, `Weight` smoothing
- In-app menu: select lobby, play voice, toggle BGM; `#lip` LED shows when mouth is animating
- `CAPTURE=<png path>` env for headless screenshots, `HASH=selftest` for an in-app self-test

## Setup

1. `npm install`
2. Copy the game assets (not included in this repo — see below): `python3 scripts/copy_assets.py` produces `assets/{spine,voice,bgm,data,lobby_index.json}`
3. `npm start`

### Preparing assets

The assets are extracted from the game, so they are intentionally **not** committed. Run the copy script with source paths (defaults are this machine's extraction directories; override with env vars or edit the defaults at the top of the script):

```bash
BA_SRC_SPINE=/path/to/SpineLobbies \
BA_SRC_MEDIA=/path/to/GL_Extracted/Media \
BA_SRC_BGM=/path/to/Media/Audio/BGM \
BA_SRC_DATA=/path/to/BA_MemorialLobby/data \
python3 scripts/copy_assets.py
```

The script copies only the main skeleton variant (skips `_1/_2/_3` LOD copies and `_scene`/`_bg` files), copies the `JP_*` voice folders and `Theme_*.ogg` BGM, and regenerates `assets/lobby_index.json`.

Sources referenced:
- `SpineLobbies`: `Assets/_MX/SpineLobbies` from an extracted BA client (`.skel` / `.atlas` / `.png`)
- `Media`: `GL_Extracted/Media` containing `JP_*` voice folders
- BGM: `GL_RawData/Media/Audio/BGM` containing `Theme_*.ogg`
- data: `lobby_voice_schedule.json`, `lobby_bgm_mapping.csv`, `lobby_camera_config.json`

## Stack

- Electron, Vite (`dev` via `main.js` spawning a system `node`, `vite build` for production)
- `pixi.js` 8.19.0, `@esotericsoftware/spine-pixi-v8` 4.2.119 (spine-core 4.2 parses 4.2.x lobby files)
- WebAudio `AnalyserNode` for real-time mouth amplitude
