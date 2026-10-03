#!/usr/bin/env python3
"""flicker_scan.py — 從實機錄影偵測閃爍事件（星星/光斑），輸出事件表。

用法：python3 scripts/flicker_scan.py <影片目錄的密集幀目錄> [--out events.json]
幀目錄：ffmpeg -i video.webm -vf fps=2 dense/d_%04d.png（fps=2 → 時間×2=幀號）
偵測：亮度>225 的連通亮區（粗網格 120px 聚類）→ 跨幀追蹤 →
      「持續 1~3s、非首尾幀、面積<1500px」的突現且消失事件＝閃爍候選。
大面積事件（>1500px）為相機移動造成的大型亮部變化，排除。
"""
import sys, json, glob
import numpy as np
from PIL import Image

d = sys.argv[1] if len(sys.argv) > 1 else '.'
frames = sorted(glob.glob(f'{d}/d_*.png'))
lums = [np.array(Image.open(f).convert('L')) for f in frames]
L = np.stack(lums)
T, H, W = L.shape
bright = L > 225
cell = 120
def blobs(mask):
    gh, gw = H//cell, W//cell
    out = []
    for gy in range(gh):
        for gx in range(gw):
            m = mask[gy*cell:(gy+1)*cell, gx*cell:(gx+1)*cell]
            if m.sum() > 40:
                ys, xs = np.where(m)
                out.append((gx*cell+xs.mean(), gy*cell+ys.mean(), m.sum()))
    return out
tracks = []
for t in range(T):
    bs = blobs(bright[t])
    used = set()
    for tr in tracks:
        if tr['frames'][-1] == t-1:
            lx, ly, _ = tr['pos'][-1]
            best = None
            for i,(cx,cy,n) in enumerate(bs):
                if i in used: continue
                if abs(cx-lx)<180 and abs(cy-ly)<180:
                    if best is None or n>bs[best][2]: best=i
            if best is not None:
                tr['frames'].append(t); tr['pos'].append(bs[best]); used.add(best)
    for i,(cx,cy,sz) in enumerate(bs):
        if i not in used:
            tracks.append({'frames':[t],'pos':[(cx,cy,sz)]})
events = []
for tr in tracks:
    dur = tr['frames'][-1]-tr['frames'][0]+1
    f0, f1 = tr['frames'][0], tr['frames'][-1]
    if 2<=dur<=6 and f0>0 and f1<T-1:
        px = sum(p[2] for p in tr['pos'])/len(tr['pos'])
        cx = sum(p[0] for p in tr['pos'])/len(tr['pos'])
        cy = sum(p[1] for p in tr['pos'])/len(tr['pos'])
        if px < 1500:
            events.append({'t_start': round(f0/2,1), 't_end': round(f1/2,1),
                           'x': round(cx), 'y': round(cy), 'avg_px': round(px)})
outf = sys.argv[sys.argv.index('--out')+1] if '--out' in sys.argv else '/tmp/bq/flicker_events.json'
json.dump(events, open(outf,'w'), indent=1)
print(f'{len(events)} flicker events -> {outf}')
