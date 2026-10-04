#!/usr/bin/env python3
# GT(viewer 語義) vs plain 捕捉的對位比對——批量分類儀器（十輪裁定模型：
# 遊戲 lobby＝gamma 域合成＝plain/viewer 語義；逐廳差異＝|mean diff| 分級）。
# 用法：python3 scripts/gt_vs_plain.py <gt.ppm> <plain.png> [out_aligned.png]
# 輸出：JSON 一行（alignment、masked mean diff、zone stats）
import sys, json
import numpy as np
from PIL import Image

def read_any(p):
    if p.endswith('.ppm'):
        with open(p, 'rb') as f:
            data = f.read()
        parts = data.split(b'\n', 3)
        w, h = map(int, parts[1].split())
        return np.frombuffer(parts[3], dtype=np.uint8).reshape(h, w, 3)
    return np.asarray(Image.open(p).convert('RGB'))

def estimate_scale(gt, plain, cx=None, cy=None):
    """多尺度模板匹配估 GT→plain 的縮放比（plain 中央特徵區在 GT 中搜尋）。"""
    h, w = plain.shape[:2]
    tw, th = 300, 240
    x0 = (w - tw)//2 if cx is None else int(cx - tw/2)
    y0 = (h - th)//2 if cy is None else int(cy - th/2)
    tpl = plain[y0:y0+th, x0:x0+tw]
    best = None
    for scale in [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5]:
        s = (max(8, int(tw*scale)), max(8, int(th*scale)))
        t = np.asarray(Image.fromarray(tpl.astype(np.uint8)).resize(s), dtype=np.float64)
        if s[0] >= gt.shape[1] or s[1] >= gt.shape[0]: continue
        step = 6
        for y in range(0, gt.shape[0]-s[1], step):
            for x in range(0, gt.shape[1]-s[0], step):
                d = np.abs(gt[y:y+s[1], x:x+s[0]] - t).mean()
                if best is None or d < best[0]: best = (d, scale, x, y)
    return best   # (diff, scale, x, y)

def main():
    gt_path, plain_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None
    scale_est = len(sys.argv) > 4 and sys.argv[4] == '--scale'
    gt = read_any(gt_path).astype(np.float64)
    plain = read_any(plain_path).astype(np.float64)
    if gt.shape != plain.shape:
        print(json.dumps({'err': f'shape {gt.shape} vs {plain.shape}'}))
        return
    mask = np.zeros(gt.shape[:2], bool)
    mask[80:930, 40:1260] = True   # 遮 HUD 條
    if scale_est:
        b = estimate_scale(gt, plain)
        if b:
            print(json.dumps({'scaleEst': {'diff': round(float(b[0]),1), 'scale': b[1], 'x': b[2], 'y': b[3]}}))
            return
    best = None
    for dy in range(-12, 13):
        for dx in range(-12, 13):
            g = np.roll(np.roll(gt, dy, axis=0), dx, axis=1)
            s = np.abs(g - plain)[mask].mean()
            if best is None or s < best[0]:
                best = (s, dy, dx)
    s, dy, dx = best
    g = np.roll(np.roll(gt, dy, axis=0), dx, axis=1)
    d = g - plain
    # 分區（zone_stats 同口徑）
    sys.path.insert(0, __file__.rsplit('/', 1)[0])
    from zone_stats import crop_aspect
    def zs(img):
        r = crop_aspect(img.astype(np.uint8)).astype(np.float64)
        lum = 0.2126*r[:,:,0] + 0.7152*r[:,:,1] + 0.0722*r[:,:,2]
        p90, p25 = np.percentile(lum, 90), np.percentile(lum, 25)
        return {'all': r.reshape(-1,3).mean(axis=0).round(1).tolist(),
                'bright': r[lum>=p90].mean(axis=0).round(1).tolist(),
                'dark': r[lum<=p25].mean(axis=0).round(1).tolist()}
    out = {'align': {'dy': int(dy), 'dx': int(dx)}, 'meanAbsDiff': round(float(s), 2),
           'signedDiff': d[mask].reshape(-1,3).mean(axis=0).round(2).tolist(),
           'gt': zs(g), 'plain': zs(plain)}
    if out_path:
        Image.fromarray(g.astype(np.uint8)).save(out_path)
    print(json.dumps(out))

if __name__ == '__main__':
    main()
