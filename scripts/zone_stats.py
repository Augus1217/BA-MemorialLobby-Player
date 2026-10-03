#!/usr/bin/env python3
# bloom 校準分區統計（CH0284 校準協議）：
#   實機幀：ffmpeg 抽 raw YUV420p（繞開 range 誤標），手動 (Y-16)×255/219＋BT.709
#           ——CH0230 案確立的解碼修正（naive 解碼會把全部數字量在錯誤解碼上）
#   我方幀：beam 探針 capture PNG（1300×1035）
# 分區定義（兩側同法，自洽比較）：
#   all   = 裁到 1.2563 寬高比（1300:1035）後全幅均值
#   bright= 亮度 ≥ p90 像素均值          （bloom 主作用區）
#   dark  = 亮度 ≤ p25 像素均值          （veil/背景，驗證 bloom 不污染暗部）
# 用法：zone_stats.py real <frame.yuv> <w> <h>  |  zone_stats.py ours <frame.png>
import sys
import numpy as np

ASPECT = 1300 / 1035

def crop_aspect(rgb):
    h, w = rgb.shape[:2]
    tw = int(round(h * ASPECT))
    if tw <= w:
        x0 = (w - tw) // 2
        return rgb[:, x0:x0 + tw]
    th = int(round(w / ASPECT))
    y0 = (h - th) // 2
    return rgb[y0:y0 + th, :]

def stats(rgb, tag):
    r = crop_aspect(rgb).astype(np.float64)
    lum = 0.2126 * r[:, :, 0] + 0.7152 * r[:, :, 1] + 0.0722 * r[:, :, 2]
    p90, p25 = np.percentile(lum, 90), np.percentile(lum, 25)
    bright = r[lum >= p90].mean(axis=0)
    dark = r[lum <= p25].mean(axis=0)
    out = {
        'all': r.reshape(-1, 3).mean(axis=0).round(1).tolist(),
        'bright': bright.round(1).tolist(),
        'dark': dark.round(1).tolist(),
        'p90lum': round(float(p90), 1), 'p25lum': round(float(p25), 1),
    }
    print(f"{tag}: all={out['all']} bright={out['bright']} dark={out['dark']} "
          f"(p90={out['p90lum']} p25={out['p25lum']})")
    return out

def load_real(path, w, h):
    yuv = np.fromfile(path, dtype=np.uint8)
    n = w * h
    Y = yuv[:n].reshape(h, w).astype(np.float64)
    cb = yuv[n:n + n // 4].reshape(h // 2, w // 2)
    cr = yuv[n + n // 4:n + n // 2].reshape(h // 2, w // 2)
    # limited-range → full：與 CH0230 案相同的手動展開
    Yf = (Y - 16.0) * 255.0 / 219.0
    cbf = (cb - 128.0) * 255.0 / 224.0
    crf = (cr - 128.0) * 255.0 / 224.0
    cbf = np.kron(cbf, np.ones((2, 2)))[:h, :w]
    crf = np.kron(crf, np.ones((2, 2)))[:h, :w]
    # BT.709 YCbCr → RGB
    r = Yf + 1.5748 * crf
    g = Yf - 0.1873 * cbf - 0.4681 * crf
    b = Yf + 1.8556 * cbf
    return np.stack([r, g, b], axis=2).clip(0, 255)

def load_ours(path):
    from PIL import Image
    return np.asarray(Image.open(path).convert('RGB'))

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'real':
        stats(load_real(sys.argv[2], int(sys.argv[3]), int(sys.argv[4])), 'REAL')
    else:
        stats(load_ours(sys.argv[2]), 'OURS')
