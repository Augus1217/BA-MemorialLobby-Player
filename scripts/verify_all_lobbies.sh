#!/usr/bin/env bash
# 全庫驗證：實機影片 vs 我們渲染（新背景、現行出貨樣貌 mode=auto+mild）。
# 有實機影片的廳才驗；載入畫面影片自動跳過（變異數過濾）。可續跑。
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
OUT=docs/lobby_verify.csv
[ -f "$OUT" ] || echo "lobby,meanD_R,meanD_G,meanD_B,meanAbs,darkP5差,darkP25差,blowout差,verdict" >> "$OUT"
VIDS=/home/augus/Pictures/out
PROBE="DISPLAY=:0 PROBE_MODE=beam WIDTH=1300 HEIGHT=1006"

for V in "$VIDS"/*.skel.mp4; do
  BASE=$(basename "$V" .skel.mp4)
  # 解析我們的 lobby key（大小寫不分）
  KEY=$(python3 - "$BASE" <<'PYEOF'
import json, sys
name = sys.argv[1].lower()
idx = json.load(open('assets/data/lobby_index.json'))
keys = list(idx.keys()) if isinstance(idx, dict) else []
hit = next((k for k in keys if k.lower() == name), None)
print(hit or '')
PYEOF
)
  [ -z "$KEY" ] && { echo "SKIP-NOKEY $BASE"; continue; }
  grep -q "^${KEY}," "$OUT" 2>/dev/null && continue
  # 影片時長與抽幀點（60%/75%/90%，取變異數最高幀＝避開載入畫面）
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V" 2>/dev/null | head -1)
  [ -z "$DUR" ] && { echo "SKIP-NOFFPROBE $KEY"; continue; }
  BEST=""
  BESTVAR=0
  for PCT in 60 75 90; do
    T=$(python3 -c "print(round($DUR*$PCT/100, 2))")
    W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$V" 2>/dev/null | head -1)
    H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$V" 2>/dev/null | head -1)
    [ -z "$W" ] && continue
    ffmpeg -y -v error -ss "$T" -i "$V" -frames:v 1 -f rawvideo -pix_fmt yuv420p /tmp/bq/vv_$$.yuv 2>/dev/null
    [ -f /tmp/bq/vv_$$.yuv ] || continue
    VAR=$(python3 -c "
import numpy as np, sys
sys.path.insert(0, 'scripts')
from zone_stats import load_real
im = load_real('/tmp/bq/vv_$$.yuv', $W, $H)
print(round(float(im.std()), 1))" 2>/dev/null)
    BETTER=$(python3 -c "print(1 if float('${VAR:-0}') > float('${BESTVAR:-0}') + 5 else 0)" 2>/dev/null)
    if [ "$BETTER" = "1" ]; then
      BESTVAR=$VAR
      cp /tmp/bq/vv_$$.yuv /tmp/bq/verify_real.yuv
      BEST="$T,$W,$H"
    fi
    rm -f /tmp/bq/vv_$$.yuv
  done
  [ -z "$BEST" ] && { echo "SKIP-LOADINGSCREEN $KEY"; echo "$KEY,,,,,,LOADINGSCREEN" >> "$OUT"; continue; }
  T=$(echo "$BEST" | cut -d, -f1); W=$(echo "$BEST" | cut -d, -f2); H=$(echo "$BEST" | cut -d, -f3)
  # 我們的渲染（現行出貨樣貌：mode=auto 路由＋mild；vignette 由 runner 固定關閉——已知混淆，記錄於文檔）
  rm -f /tmp/bq/beam_beam_t*.png "/tmp/bq/beam_${KEY}.json"
  DISPLAY=:0 PROBE_MODE=beam LOBBY="$KEY" WIDTH=1300 HEIGHT=1006 \
    EXTRA="&camera=0&psOnly=zzz&waterStr=0" TIMEOUT_MS=360000 \
    ./node_modules/.bin/electron tests/interact_main.js >/dev/null 2>&1
  OURS=$(ls /tmp/bq/beam_beam_t*.png 2>/dev/null | tail -1)
  [ -z "$OURS" ] && { echo "SKIP-NOCAPTURE $KEY"; continue; }
  ROW=$(python3 scripts/verify_lobby_frame.py /tmp/bq/verify_real.yuv "$W" "$H" "$OURS" 2>/dev/null)
  if [ -n "$ROW" ]; then
    echo "$KEY,$ROW" >> "$OUT"
    echo "$KEY → $ROW"
  else
    echo "SKIP-COMPAREFAIL $KEY"
  fi
  rm -rf "/tmp/bq/ud-interact-${KEY}"
done
echo "==== 完成 ===="
column -t -s, "$OUT" 2>/dev/null | tail -40
