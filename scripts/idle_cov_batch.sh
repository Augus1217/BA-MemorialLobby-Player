#!/usr/bin/env bash
# 全庫 idle 期 additive 光覆蓋普查（slotsIdle 儀器）→ docs/idle_cov.csv
# 可續跑（跳過已完成）；逐廳清 userData 與 PNG（tmpfs 鐵律）；單實例。
set -u
cd "$(dirname "$0")/.."
OUT=docs/idle_cov.csv
LIST=/tmp/bq/idle_cov_lobbies.txt
[ -f "$LIST" ] || { echo "no lobby list"; exit 1; }
[ -f "$OUT" ] || echo "lobby,idleCov,n_slots" >> "$OUT"

while read -r LOBBY; do
  [ -z "$LOBBY" ] && continue
  if grep -q "^${LOBBY}," "$OUT" 2>/dev/null; then continue; fi
  rm -f /tmp/bq/beam_beam_t*.png "/tmp/bq/beam_${LOBBY}.json"
  DISPLAY=:0 PROBE_MODE=beam LOBBY="$LOBBY" WIDTH=1300 HEIGHT=1006 \
    EXTRA="&camera=0&psOnly=zzz&waterStr=0&plain=1&hdr=0&POST=0" TIMEOUT_MS=360 \
    ./node_modules/.bin/electron tests/interact_main.js >/dev/null 2>&1
  RES=$(python3 - "$LOBBY" <<'PYEOF'
import json, sys
lobby = sys.argv[1]
try:
    si = None
    for l in open(f'/tmp/bq/beam_{lobby}.json'):
        try:
            r = json.loads(l)
            if r.get('tag') == 'slotsIdle': si = r
        except Exception: pass
except Exception:
    print(f'{lobby},,'); raise SystemExit
if not si:
    print(f'{lobby},,'); raise SystemExit
VIEW = 1300*1006
cov = 0.0
for s in si['slots']:
    x0, y0, x1, y1 = s['bbox']
    ix0, iy0, ix1, iy1 = max(x0,0), max(y0,0), min(x1,1300), min(y1,1006)
    if ix1 <= ix0 or iy1 <= iy0: continue
    eff = max(0.0, min(1.0, s['a'] * (s['attA'] if s['attA'] is not None else 1)))
    cov += (ix1-ix0)*(iy1-iy0)*eff
print(f'{lobby},{round(cov/VIEW, 3)},{len(si["slots"])}')
PYEOF
)
  echo "$RES" >> "$OUT"
  # 逐廳清 userData（tmpfs 鐵律）
  rm -rf "/tmp/bq/ud-interact-${LOBBY}"
done < "$LIST"
echo "==== 完成 ===="
wc -l "$OUT"
