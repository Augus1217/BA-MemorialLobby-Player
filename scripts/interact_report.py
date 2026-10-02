#!/usr/bin/env python3
"""互動探針巡檢報告：讀 /tmp/bq/interact_*.json（tests/interact_batch.sh 產物），
對每 lobby 判定四類互動的觸發狀態，輸出彙總表與異常清單。
判定基準：
  talk   = 語音 id 觸發（字尾 _MemorialLobby_*）＋字幕出現
  pat    = Pat_XX 動畫出現在任一軌（無 hairpat 區的 lobby＝N/A）
  look   = busy='look'（eyeFollow）＋Touch_Eye 骨骼有位移
  special= 互動模式對應的 clip（Pinch/Touch/HandFollow）出現
用法：python3 scripts/interact_report.py [--json]
"""
import json, glob, os, sys

rows = []
for f in sorted(glob.glob('/tmp/bq/interact_*.json')):
    L = os.path.basename(f)[9:-5]
    tags = {}
    for line in open(f, encoding='utf-8', errors='replace'):
        try:
            d = json.loads(line)
            tags[d.get('tag')] = d
        except Exception:
            pass
    if 'lobby' not in tags:
        rows.append((L, 'EMPTY', '', '', '', '', 'probe 未啟動'))
        continue
    talk = tags.get('talk', {}).get('trace', [])
    voice = next((t.get('id') for t in talk if t.get('ev') == 'voice'), None)
    sub = next((t for t in talk if t.get('ev') == 'subtitle'), None)
    pat = tags.get('pat', {}).get('trace', [])
    patAnim = next((t.get('anim', '') for t in pat if t.get('ev') == 'pat-anim'), '')
    look = tags.get('look', {}).get('trace', [])
    lookBusy = next((t.get('eyeFollow') for t in look if t.get('ev') == 'look-anim'), False)
    lookBone = tags.get('look', {}).get('bone', [])
    lookMoved = max((p['x'] for p in lookBone), default=0) - min((p['x'] for p in lookBone), default=0)
    sp = tags.get('special', {}).get('trace', [])
    spAnim = next((t.get('anim', '') for t in sp if t.get('ev') == 'special-anim'), '')
    mode = tags.get('lobby', {}).get('interactionMode')
    err = tags.get('error', {}).get('err')

    talkOk = bool(voice) and bool(sub)
    patOk = 'Pat_' in patAnim
    lookOk = bool(lookBusy) or lookMoved > 5
    spOk = (mode is None) or any(k in spAnim for k in ('Pinch', 'Touch', 'HandFollow'))
    status = 'PASS' if (talkOk and patOk and lookOk and spOk) else 'CHECK'
    detail = []
    if not talkOk: detail.append(f"talk={voice}/sub={bool(sub)}")
    if not patOk: detail.append('pat未觸發（無hairpat區=正確）')
    if not lookOk: detail.append(f'look位移={lookMoved:.1f}')
    if not spOk: detail.append(f'special={spAnim or "無"}')
    rows.append((L, status, voice or '-', 'Y' if sub else 'N', str(patOk), str(lookOk), '; '.join(detail) or '-'))

npass = sum(1 for r in rows if r[1] == 'PASS')
if '--json' in sys.argv:
    print(json.dumps([{'lobby': r[0], 'status': r[1], 'voice': r[2], 'sub': r[3], 'pat': r[4], 'look': r[5], 'detail': r[6]} for r in rows], ensure_ascii=False, indent=1))
else:
    print(f"巡檢 lobby 數: {len(rows)}  PASS: {npass}  CHECK: {len(rows)-npass}")
    print(f"{'lobby':<28} {'狀態':<6} {'talk語音':<34} {'字幕':<3} {'pat':<5} {'look':<5} 備註")
    for L, st, v, s, p, lk, det in rows:
        if st != 'PASS':
            print(f"{L:<28} {st:<6} {v:<34} {s:<3} {p:<5} {lk:<5} {det}")
    print('\n（僅列 CHECK 項；完整明細見上方 --json）')
