#!/usr/bin/env python3
# 從 beam JSON 抽 view record → GT mtx 參數字串（fallback＝CH0230 慣例值）
import json, sys
lobby = sys.argv[1]
try:
    recs = [json.loads(l) for l in open(f'/tmp/bq/beam_{lobby}.json') if l.strip()]
    v = [r for r in recs if r.get('tag') == 'view'][0]
    print(f"{v['a']},{v['tx']},{v['ty']}")
except Exception:
    print('0.4642857,648,950')
