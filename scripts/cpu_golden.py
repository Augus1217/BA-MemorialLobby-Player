#!/usr/bin/env python3
# CPU 黃金光柵化器：以官方 spine 語義軟體渲染 meshdump，與我們的 GPU 輸出逐像素比對。
# 語義鏈（鐵譜）：loader 於 sRGB 域 CPU 預乘（texPMA=rgb×a）→ shader 摺疊
# vColor.rgb=aColor.rgb×aColor.a、vColor.a=aColor.a → frag=texPMA×vColor →
# blend（normal=ONE/OMISA、additive=ONE/ONE、screen=ONE/OneMinusSrcColor）於 gamma 畫布。
# 用法：cpu_golden.py <meshdump.json> <capture.png> [--vflip]
import sys, json, base64
import numpy as np
from PIL import Image

ASSET = 'assets/spine/CH0230_home/'
dump = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get('tag') == 'meshdump':
        dump.extend(r['slots'])
print(f'slots: {len(dump)}')

W, H = 1300, 1006
BG = np.array([5, 6, 13], dtype=np.float64) / 255.0   # app backgroundColor 0x05060d
fb = np.ones((H, W, 3), dtype=np.float64) * BG

pages = {}
def page_img(name, vflip):
    key = (name, vflip)
    if key not in pages:
        img = Image.open(ASSET + name).convert('RGBA')
        a = np.asarray(img, dtype=np.float64) / 255.0
        if vflip:
            a = a[::-1]
        a[..., :3] *= a[..., 3:4]           # loader CPU 預乘（sRGB 域）
        pages[key] = a
    return pages[key]

def sample_bilinear(img, x, y):
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(np.int64); y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    c00 = img[y0, x0]; c10 = img[y0, x0 + 1]; c01 = img[y0 + 1, x0]; c11 = img[y0 + 1, x0 + 1]
    return (c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy)

def render(vflip):
    fb = np.ones((H, W, 3), dtype=np.float64) * BG
    n_slots = 0
    for s in dump:
        wv = np.frombuffer(base64.b64decode(s['wv']), dtype=np.float32).astype(np.float64)
        uvs = np.frombuffer(base64.b64decode(s['uvs']), dtype=np.float32).astype(np.float64)
        nv = len(wv) // 2
        if nv < 3 or len(uvs) < nv * 2:
            continue
        img = page_img(s['page'], vflip)
        sc = np.array(s['sc']); ac = np.array(s['ac'])
        aColor = sc * ac
        vrgb = aColor[:3] * aColor[3]        # PMA 摺疊
        va = aColor[3]
        bm = s['bm']
        px = wv[0::2]; py = wv[1::2]
        uu = uvs[0::2]; vv = uvs[1::2]
        tris = np.frombuffer(base64.b64decode(s['tris']), dtype=np.uint16).astype(np.int64) if s.get('tris') else np.arange(nv, dtype=np.int64)
        for t0, t1, t2 in zip(tris[0::3], tris[1::3], tris[2::3]):
            x0, x1, x2 = px[t0], px[t1], px[t2]
            y0, y1, y2 = py[t0], py[t1], py[t2]
            u0, u1, u2 = uu[t0], uu[t1], uu[t2]
            v0, v1, v2 = vv[t0], vv[t1], vv[t2]
            det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if abs(det) < 1e-9:
                continue
            bx0 = max(0, int(min(x0, x1, x2))); bx1 = min(W - 1, int(np.ceil(max(x0, x1, x2))))
            by0 = max(0, int(min(y0, y1, y2))); by1 = min(H - 1, int(np.ceil(max(y0, y1, y2))))
            if bx1 < bx0 or by1 < by0:
                continue
            xs = np.arange(bx0, bx1 + 1) + 0.5
            ys = np.arange(by0, by1 + 1) + 0.5
            gx, gy = np.meshgrid(xs, ys)
            w0 = ((x1 - gx) * (y2 - gy) - (x2 - gx) * (y1 - gy)) / det
            w1 = ((x2 - gx) * (y0 - gy) - (x0 - gx) * (y2 - gy)) / det
            w2 = 1.0 - w0 - w1
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            tu = w0 * u0 + w1 * u1 + w2 * u2
            tv = w0 * v0 + w1 * v1 + w2 * v2
            tex = sample_bilinear(img, tu * img.shape[1], tv * img.shape[0])
            src_rgb = tex[..., :3] * vrgb
            src_a = tex[..., 3:4] * va
            region = (slice(by0, by1 + 1), slice(bx0, bx1 + 1))
            dst = fb[region]
            m = inside[..., None]
            if bm == 1:      # additive ONE/ONE
                fb[region] = np.where(m, dst + src_rgb * src_a + dst * 0, dst) if False else dst + np.where(m, src_rgb * 1.0, 0)
                # pixi 'add' 預乘語義：out = src.rgb×1 + dst（src 已預乘 rgb）
                fb[region] = dst + np.where(m, src_rgb * 1.0, 0)
            elif bm == 3:    # screen
                fb[region] = dst + np.where(m, src_rgb - src_rgb * dst, 0)
            else:            # normal ONE/OMISA
                fb[region] = np.where(m, src_rgb + dst * (1 - src_a), dst)
        n_slots += 1
    return fb, n_slots

vflip = '--vflip' in sys.argv
fb, n_slots = render(vflip)
out = (np.clip(fb, 0, 1) * 255).astype(np.uint8)
Image.fromarray(out).save('/tmp/bq/cpu_golden.png')

cap = np.asarray(Image.open(sys.argv[2]).convert('RGB'), dtype=np.float64)
D = out.astype(np.float64) - cap
print(f'rendered slots: {n_slots}  (vflip={vflip})')
print(f'CPU − capture: mean={D.reshape(-1,3).mean(axis=0).round(2)} |mean|={np.abs(D).mean():.2f} '
      f'identical={(np.abs(D).max(axis=2)==0).mean()*100:.1f}% p95={np.percentile(np.abs(D),95):.1f}')
Image.fromarray((np.abs(D) * 2).clip(0, 255).astype(np.uint8)).save('/tmp/bq/cpu_golden_diff.png')
print('saved /tmp/bq/cpu_golden.png /tmp/bq/cpu_golden_diff.png')
