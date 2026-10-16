#!/usr/bin/env python3
# 逐廳驗證比對器：實機影片幀 vs 我們的捕捉（新背景下）。
# 用法：verify_lobby_frame.py <real.yuv> <w> <h> <ours.png>
# 輸出 CSV 行：lobby,meanR,meanG,meanB,diffMean,darkP5差,darkP25差,blowout差,verdict
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from zone_stats import load_real

def central(im, frac=0.7):
    h, w = im.shape[:2]
    hh, ww = int(h*frac/2), int(w*frac/2)
    cy, cx = h//2, w//2
    return im[cy-hh:cy+hh, cx-ww:cx+ww]

def main():
    yuv, w, h, ours_png = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    real = central(load_real(yuv, w, h))
    ours = central(np.asarray(Image.open(ours_png).convert('RGB'), dtype=np.float64))
    lr = real.mean(axis=2).reshape(-1); lo = ours.mean(axis=2).reshape(-1)
    rf = real.reshape(-1,3); of = ours.reshape(-1,3)
    mr, mo = rf.mean(axis=0), of.mean(axis=0)
    dm = mo - mr
    p5r, p25r = np.percentile(lr,5), np.percentile(lr,25)
    p5o, p25o = np.percentile(lo,5), np.percentile(lo,25)
    blr, blo = (lr>245).mean()*100, (lo>245).mean()*100
    # verdict：全幅差與暗端差都在容內＝PASS
    dmag = np.abs(dm).max()
    dark_gap = abs(p5o-p5r) + abs(p25o-p25r)
    verdict = 'PASS' if (dmag <= 12 and dark_gap <= 40) else ('NEAR' if dmag <= 25 else 'DIVERT')
    print(f"{dm[0]:.1f},{dm[1]:.1f},{dm[2]:.1f},{dmag:.1f},{p5o-p5r:.1f},{p25o-p25r:.1f},{blo-blr:.1f},{verdict}")

if __name__ == '__main__':
    main()
