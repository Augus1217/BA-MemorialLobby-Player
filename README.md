# BA Memorial Lobby Player

《蔚藍檔案》(Blue Archive) Memorial Lobby **模擬器** built with Electron + PixiJS + Spine. Reproduces the in-game lobby experience: a fullscreen immersive scene where the character idles in her room, reacts to you, and speaks with live lip-sync.

## Features

- 266 lobby skeletons from `assets/lobby_index.json` (main LOD variant per lobby, quirk handling for `Airi0/Airi`, `CH9996/CH0996`, `juri/Juri`)
- Immersive, tool-free presentation: auto-hiding HUD (‹/› to switch lobby, ♪ for BGM), cinematic vignette, floating dust motes, soft glow and floor shadow
- Room scene layer: lobbies that ship one (`Aru_Scene`, `Akari_Scene`, `Fuuka_Scene`, `Momoi_Scene`, `Wakamo_Scene_0`) render the room behind the character with parallax
- Spine playback model faithful to the game:
  - Track 0: `Start_Idle_01` intro → `Idle_01` loop
  - **Eyes follow your cursor** — driven frame-by-frame from each lobby's own `Look_01` pose animation (identical to the in-game "抓眼睛" mechanic)
  - Tap: random voiced `Talk_NN` (syncs `_M` + `_A` on tracks 1 & 2)
  - Long-press / hold: `Pat_01` loop, `PatEnd` on release
  - Autonomous idle chatter (no forced look — eyes already follow you)
- Voice driven by the skeleton's embedded animation events (`Sound/` + `Talk`), routed through a WebAudio analyser; mouth-bone `scaleY` responds to live RMS amplitude on top of the baked `_M` lip-sync
- BGM per lobby from `lobby_bgm_mapping.csv` (`Theme_*.ogg`)
- Camera from `lobby_camera_config.json`: character fills the playback area, wheel/pinch zoom with cursor anchor, `MaxScale` clamp, `Weight` smoothing, subtle idle drift (no drag pan — the camera is fixed)
- `CAPTURE=<png path>` env for headless screenshots, `#lobby=<name>` deep-links to a lobby

## Setup

1. `npm install`
2. Copy the game assets (not included in this repo — see below): `python3 scripts/copy_assets.py` produces `assets/{spine,scene,voice,bgm,data,lobby_index.json}`
3. `npm start`

### Controls

| Input | Action |
| --- | --- |
| Move cursor | Her eyes follow you (eyes-follow-cursor, the "抓眼睛" mechanic) |
| Tap (quick) | Character talks (random voiced line) |
| Hold (0.4s+) | Headpat, release to finish |
| Scroll / pinch | Zoom |
| ‹ / › | Previous / next lobby |
| ♪ | Toggle BGM |

### Preparing assets

The assets are extracted from the game, so they are intentionally **not** committed. Run the copy script with source paths (defaults are this machine's extraction directories; override with env vars or edit the defaults at the top of the script):

```bash
BA_SRC_SPINE=/path/to/SpineLobbies \
BA_SRC_MEDIA=/path/to/GL_Extracted/Media \
BA_SRC_BGM=/path/to/Media/Audio/BGM \
BA_SRC_DATA=/path/to/BA_MemorialLobby/data \
python3 scripts/copy_assets.py
```

The script copies only the main skeleton variant (skips `_1/_2/_3` LOD copies), copies the `JP_*` voice folders and `Theme_*.ogg` BGM, and regenerates `assets/lobby_index.json`. Room skeletons (folders like `Aru_Scene`) are copied to `assets/scene/` and recorded in the manifest.

Sources referenced:
- `SpineLobbies`: `Assets/_MX/SpineLobbies` from an extracted BA client (`.skel` / `.atlas` / `.png`)
- `Media`: `GL_Extracted/Media` containing `JP_*` voice folders
- BGM: `GL_RawData/Media/Audio/BGM` containing `Theme_*.ogg`
- data: `lobby_voice_schedule.json`, `lobby_bgm_mapping.csv`, `lobby_camera_config.json`

## Stack

- Electron, Vite (`dev` via `main.js` spawning a system `node`, `vite build` for production)
- `pixi.js` 8.19.0, `@esotericsoftware/spine-pixi-v8` 4.2.119 (spine-core 4.2 parses 4.2.x lobby files)
- WebAudio `AnalyserNode` for real-time mouth amplitude
