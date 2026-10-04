#!/usr/bin/env bash
# 批量「GT vs plain」分類驅動（十輪模型：遊戲 lobby＝gamma 合成＝plain/viewer 語義）
# 逐廳：plain 探針捕捉 → GT 鏈式渲染（同 t）→ 對位比對 → docs/gt_vs_plain.csv 追加
# 用法：scripts/gt_vs_plain_batch.sh LobbyA_home LobbyB_home ...
# 鐵律：單實例（16GiB）；每次 GT 前清 /tmp/lwjgl_augus；逐廳隔離 userData。
set -u
cd "$(dirname "$0")/.."
REPO=$PWD
GT_CP="/tmp/bq/gt_classes:/tmp/bq/lwjgl/343/lwjgl-3.4.3.jar:/tmp/bq/lwjgl/343/lwjgl-glfw-3.4.3.jar:/tmp/bq/lwjgl/343/lwjgl-opengl-3.4.3.jar:/tmp/bq/lwjgl/343/lwjgl-3.4.3-natives-linux.jar:/tmp/bq/lwjgl/343/lwjgl-glfw-3.4.3-natives-linux.jar:/tmp/bq/lwjgl/343/lwjgl-opengl-3.4.3-natives-linux.jar:/tmp/bq/skeletonViewer_stripped.jar"
OUT=/tmp/bq/batch
mkdir -p "$OUT"
CSV=docs/gt_vs_plain.csv
[ -f "$CSV" ] || echo "lobby,anchor,align_dy,align_dx,meanAbsDiff,signedR,signedG,signedB" >> "$CSV"

for LOBBY in "$@"; do
  echo "==== $LOBBY ===="
  rm -f /tmp/bq/beam_beam_t*.png "/tmp/bq/beam_${LOBBY}.json"
  DISPLAY=:0 PROBE_MODE=beam LOBBY=$LOBBY WIDTH=1300 HEIGHT=1006 \
    EXTRA="&camera=0&psOnly=zzz&waterStr=0&plain=1&hdr=0&POST=0" \
    ./node_modules/.bin/electron tests/interact_main.js >/dev/null 2>&1 || { echo "probe fail"; continue; }
  # 選 idle ≥5s 的最前錨點（JSON sample 的 phase 欄）
  ANCHOR=$(python3 - <<PYEOF
import json
try:
    recs = [json.loads(l) for l in open('/tmp/bq/beam_${LOBBY}.json') if l.strip()]
except Exception:
    print(''); raise SystemExit
last = ''
for r in recs:
    if r.get('tag') == 'sample' and isinstance(r.get('phase'), str) and r['phase'].startswith('idle'):
        v = float(r['phase'].split()[1])
        if v >= 5:
            print(r['t']); raise SystemExit
        last = r['t']
print(last)
PYEOF
)
  [ -z "$ANCHOR" ] && { echo "no idle anchor"; continue; }
  PNG="/tmp/bq/beam_beam_t${ANCHOR%.*}.png"
  [ "$ANCHOR" = "${ANCHOR%.*}" ] && PNG="/tmp/bq/beam_beam_t${ANCHOR}.png"
  [ -f "$PNG" ] || PNG=$(ls /tmp/bq/beam_beam_t*.png 2>/dev/null | head -1)
  [ -f "$PNG" ] || { echo "no capture"; continue; }
  mkdir -p "$OUT/$LOBBY"
  cp "$PNG" "$OUT/$LOBBY/plain.png"
  # GT 鏈式渲染（同 t；a,tx,ty 來自探針上報的 spine.worldTransform）
  MTX=$(python3 scripts/probe_mtx.py "$LOBBY")
  echo "mtx=$MTX"
  rm -rf /tmp/lwjgl_augus
  DISPLAY=:0 java -cp "$GT_CP" GT "$REPO/assets/spine/$LOBBY" "$LOBBY.skel" \
    "$OUT/$LOBBY/gt.ppm" Idle_01 "$ANCHOR" 1300 1006 "$MTX" Start_Idle_01 2>&1 | tail -1
  PPM="$OUT/$LOBBY/gt.ppm.ppm"; [ -f "$PPM" ] || PPM="$OUT/$LOBBY/gt.ppm"
  [ -f "$PPM" ] || { echo "gt fail"; continue; }
  RES=$(python3 scripts/gt_vs_plain.py "$PPM" "$OUT/$LOBBY/plain.png" "$OUT/$LOBBY/gt_aligned.png")
  echo "$RES" | python3 -c "
import json,sys
try: r = json.loads(sys.stdin.read())
except Exception: print('parse fail'); raise SystemExit
if 'err' in r: print(r['err']); raise SystemExit
print(f\"align dy={r['align']['dy']} dx={r['align']['dx']}  |diff|={r['meanAbsDiff']}  signed={r['signedDiff']}\")
with open('$CSV','a') as f:
    f.write(f\"$LOBBY,$ANCHOR,{r['align']['dy']},{r['align']['dx']},{r['meanAbsDiff']},{r['signedDiff'][0]},{r['signedDiff'][1]},{r['signedDiff'][2]}\n\")
"
done
echo "==== CSV ===="
cat "$CSV"
