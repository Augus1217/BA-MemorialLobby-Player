#!/bin/bash
# 全 lobby 互動探針巡檢（單實例序列；每廳結果存 /tmp/bq/interact_<key>.json）
# 用法：tests/interact_batch.sh [批次檔]；批次檔每行一個 lobby key（預設=全部未測者）
cd "$(dirname "$0")/.."
KEYS=${1:-}
if [ -z "$KEYS" ]; then
  node --input-type=module -e "
import fs from 'fs';
const idx = JSON.parse(fs.readFileSync('assets/data/lobby_index.json', 'utf8'));
const done = new Set(fs.readdirSync('/tmp/bq').filter(f => f.startsWith('interact_')).map(f => f.slice(9, -5)));
console.log(Object.keys(idx).filter(k => !done.has(k)).join('\n'));
" > /tmp/bq/interact_pending.txt
  KEYS=/tmp/bq/interact_pending.txt
fi
total=$(wc -l < "$KEYS")
i=0
while read -r L; do
  [ -z "$L" ] && continue
  i=$((i+1))
  echo "[$(date +%H:%M:%S)] ($i/$total) $L" >> /tmp/bq/interact_batch.log
  LOBBY="$L" TIMEOUT_MS=150000 timeout -k 10 180 ./node_modules/.bin/electron tests/interact_main.js > /dev/null 2>&1 < /dev/null
  ok=$?
  echo "  exit=$ok lines=$(wc -l < /tmp/bq/interact_${L}.json 2>/dev/null || echo 0)" >> /tmp/bq/interact_batch.log
done < "$KEYS"
echo "[$(date +%H:%M:%S)] BATCH COMPLETE ($total)" >> /tmp/bq/interact_batch.log
