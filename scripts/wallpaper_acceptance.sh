#!/usr/bin/env bash
# wallpaper_acceptance.sh — 桌布模式驗收（lean-testing 紀律：單實例、逐次驗證清理）
# 用法：bash scripts/wallpaper_acceptance.sh [--real]
#   預設用 BA_WALLPAPER_TYPE=normal 代理視窗（不動真桌面）；--real 掛真桌面層
set -u
cd "$(dirname "$0")/.."
LOG=/tmp/bq/wall_acceptance.log
PNG=/tmp/bq/wall_acceptance.png
mkdir -p /tmp/bq

pass=0; fail=0
ok()   { echo "PASS: $1"; pass=$((pass+1)); }
bad()  { echo "FAIL: $1"; fail=$((fail+1)); }
cleanup() {
  pkill -9 -x electron 2>/dev/null
  sleep 1
  local vid; vid=$(ss -ltnp 2>/dev/null | grep ':5173' | grep -oP 'pid=\K\d+' | head -1)
  [ -n "$vid" ] && kill -9 "$vid" 2>/dev/null
  sleep 0.5
  if pgrep -x electron > /dev/null; then bad "electron 清場驗證（仍有殘留）"; else ok "electron 清場驗證歸零"; fi
}
trap cleanup EXIT

wait_ready() {  # $1=log；最多 93s；回傳 0=ready
  sleep 3   # electron spawn 本身要幾秒
  for i in $(seq 1 90); do
    grep -q "worker 0 ready" "$1" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

# 0) 起跑前環境必須乾淨
if pgrep -x electron > /dev/null; then
  echo "已有 electron 在跑——先清場再驗收"; pkill -9 -x electron; sleep 1
fi

env_flags=()
[ "${1:-}" != "--real" ] && env_flags+=("BA_WALLPAPER_TYPE=normal")

# ===== Phase A：capture 驗證（CAPTURE_WORKER 會在 ready+5s 截圖後退出 app）=====
echo "== Phase A：啟動 --wallpaper（capture 模式）=="
rm -f "$LOG" "$PNG"
env DISPLAY=:0 "${env_flags[@]}" CAPTURE_WORKER="$PNG" CAPTURE_DELAY=5000 \
  setsid ./node_modules/.bin/electron . --wallpaper > "$LOG" 2>&1 &

if wait_ready "$LOG"; then ok "worker ready 回報"; else bad "worker ready 回報（見 $LOG）"; fi
for i in $(seq 1 12); do [ -s "$PNG" ] && break; sleep 1; done
if [ -s "$PNG" ]; then ok "worker 截圖產出（$(du -h "$PNG" | cut -f1)）"; else bad "worker 截圖產出"; fi
if grep -qE "\[renderer\]\[uncaught\]|\[renderer\]\[unhandled\]|Cannot find module" "$LOG"; then
  bad "log 無未捕捉例外"; grep -E "\[renderer\]\[uncaught\]|\[renderer\]\[unhandled\]|Cannot find module" "$LOG" | head -3
else ok "log 無未捕捉例外"; fi
pkill -9 -x electron 2>/dev/null; sleep 1

# ===== Phase B：活體驗證（不帶 CAPTURE_WORKER；singleton＋記憶體）=====
echo "== Phase B：singleton＋記憶體 =="
rm -f "$LOG"
env DISPLAY=:0 "${env_flags[@]}" \
  setsid ./node_modules/.bin/electron . --wallpaper > "$LOG" 2>&1 &
if wait_ready "$LOG"; then ok "Phase B worker ready"; else bad "Phase B worker ready（見 $LOG）"; fi

# singleton：第二實例 --wallpaper 應立即退出（意圖轉交首實例）
timeout 10 env DISPLAY=:0 ./node_modules/.bin/electron . --wallpaper > /dev/null 2>&1
rc=$?
[ "$rc" = "0" ] && ok "singleton：第二實例 exit 0" || bad "singleton：第二實例 exit=$rc"

# 記憶體（資訊性：manager+worker+GPU 整棵樹；worker 單體才是桌布常駐成本）
total_kb=$(ps -eo rss,comm | awk '/electron/{s+=$1} END{print s+0}')
mb=$((total_kb / 1024))
echo "== 記憶體：electron 全樹 RSS ≈ ${mb} MB（manager＋worker＋GPU；worker 單體目標 250-400MB）=="
[ "$mb" -lt 1800 ] && ok "全樹記憶體 < 1800MB" || bad "全樹記憶體 ${mb}MB ≥ 1800MB"

echo "== 結果：$pass PASS / $fail FAIL =="
exit $fail
