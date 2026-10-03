#!/usr/bin/env python3
# 光能分數：接合 skel 普查 × atlas 貼圖亮度 × 材質欄位 × post config
# 輸出 /tmp/bq/light_census.csv（逐 lobby 排序）＋ JSON 明細
import json, os, math
from PIL import Image
import numpy as np

ROOT = '/home/augus/BA-MemorialLobby-Player/assets/spine'
VIEWPORT = 2800 * 1575  # 16:9 可見區（spine 單位²）

census = json.load(open('/tmp/bq/light_census_skel.json'))
postcfg = json.load(open('/home/augus/BA-MemorialLobby-Player/assets/data/lobby_post_config.json'))

# atlas 解析快取：lobby → {regionPath: (pageFile, x, y, w, h, rot)}
atlas_cache = {}
def parse_atlas(lobby):
    if lobby in atlas_cache: return atlas_cache[lobby]
    d = os.path.join(ROOT, lobby)
    regions = {}
    cur_page = None; name = None
    af = os.path.join(d, os.path.basename(d) + '.atlas')
    if not os.path.exists(af):
        # 主 skel 名可能與 lobby 目錄名不同（如 Airi0_home/Airi_home.atlas）
        for f in os.listdir(d):
            if f.endswith('.atlas'): af = os.path.join(d, f); break
    if os.path.exists(af):
        for raw in open(af, encoding='utf-8', errors='replace'):
            line = raw.rstrip('\n')
            if not line.strip(): continue
            if not line.startswith((' ', '\t')):
                if line.strip().endswith('.png'): cur_page = line.strip()
                else: name = line.strip(); regions[name] = {'page': cur_page}
            elif name:
                k, _, v = line.strip().partition(':')
                regions[name][k.strip()] = v.strip()
        regions = {k: v for k, v in regions.items() if 'xy' in v}
    atlas_cache[lobby] = regions
    return regions

from collections import OrderedDict
_img_lru = OrderedDict()   # (lobby,page) -> PIL Image（uint8 解碼一次，~16MB/頁）
def page_img(lobby, page):
    key = (lobby, page)
    if key in _img_lru:
        _img_lru.move_to_end(key)
        return _img_lru[key]
    p = os.path.join(ROOT, lobby, page)
    if not os.path.exists(p): return None
    im = Image.open(p).convert('RGBA')
    _img_lru[key] = im
    while len(_img_lru) > 6:   # 16GiB 機器：最多快取 6 頁 ~100MB
        _img_lru.popitem(last=False)
    return im

def region_stats(lobby, path_):
    regions = parse_atlas(lobby)
    r = regions.get(path_)
    if not r: return None
    try:
        x, y = map(int, r['xy'].split(','))
        w, h = map(int, r['size'].split(','))
    except Exception:
        return None
    if w*h < 16: return None
    im = page_img(lobby, r['page'])
    if im is None: return None
    W, H = im.size
    x0, y0 = max(0, min(x, W-2)), max(0, min(y, H-2))
    block = np.asarray(im.crop((x0, y0, min(x0+w, W), min(y0+h, H))).convert('RGBA'), dtype=np.uint8)
    if block.size == 0: return None
    m = block[..., 3] > 64
    if not m.any(): return {'lum': 0.0, 'alpha': 0.0}
    rgb = block[..., :3][m] / 255.0
    # sRGB→線性平均（近似：對均值轉換即可，排序用）
    lum = float((0.2126*rgb[:,0] + 0.7152*rgb[:,1] + 0.0722*rgb[:,2]).mean())
    alpha = float(block[..., 3][m].mean() / 255.0)
    return {'lum': round(lum, 4), 'alpha': round(alpha, 4)}

rows = []
by_lobby = {}
for e in census:
    if e.get('err'): continue
    by_lobby.setdefault(e['lobby'], []).append(e)

for lobby, skels in sorted(by_lobby.items()):
    tot_energy = 0.0; tot_area = 0.0; n_add = 0; n_slots = 0
    top = []
    for e in skels:
        n_slots += e['slots']
        for a in e['additive']:
            n_add += 1
            st = region_stats(lobby, a['path'])
            lum = st['lum'] if st else 0.5
            alpha = st['alpha'] if st else 0.3
            effA = a['slotA'] * a['attA']
            areaFrac = min(a['area'] / VIEWPORT, 1.0)
            energy = areaFrac * lum * alpha * effA
            tot_energy += energy
            tot_area += areaFrac
            top.append((round(energy, 4), a['slot'], a['area'], a['attA']))
    top.sort(reverse=True)
    # 材質語義
    straight = None; has_blend = False
    sd = os.path.join(ROOT, lobby, f'{lobby}_SkeletonData.json')
    if os.path.exists(sd):
        sdata = json.load(open(sd))
        bmm = sdata.get('blendModeMaterials', {})
        has_blend = bool(bmm.get('applyAdditiveMaterial')) or bool(bmm.get('requiresBlendModeMaterials'))
    pc = postcfg.get(lobby) or postcfg.get(lobby.lower())
    rows.append({
        'lobby': lobby, 'skeletons': len(skels), 'additive_slots': n_add, 'slots': n_slots,
        'energy': round(tot_energy, 4), 'area_frac': round(tot_area, 4),
        'top': top[:3], 'straight_kw': straight, 'blendModeMats': has_blend,
        'post': pc,
    })

rows.sort(key=lambda r: -r['energy'])
json.dump(rows, open('/tmp/bq/light_census.json', 'w'), ensure_ascii=False, indent=1)

# CSV
with open('/tmp/bq/light_census.csv', 'w') as f:
    f.write('lobby,additive_slots,energy,area_frac,blendModeMats,top1_slot,top1_energy\n')
    for r in rows:
        t1 = r['top'][0] if r['top'] else ('-', 0, 0, 0)
        f.write(f"{r['lobby']},{r['additive_slots']},{r['energy']},{r['area_frac']},{r['blendModeMats']},{t1[1]},{t1[0]}\n")
print('lobbies:', len(rows))
print('\n=== TOP 25（光能分數）===')
for r in rows[:25]:
    t1 = r['top'][0] if r['top'] else ('-',)
    print(f"{r['lobby']:22s} energy={r['energy']:8.4f} area={r['area_frac']:6.2f} addSlots={r['additive_slots']:3d} top={t1[1]}")
print('\n=== 錨點 ===')
for name in ['Hanako_home', 'CH0070_home', 'CH0230_home']:
    for r in rows:
        if r['lobby'] == name:
            t1 = r['top'][0] if r['top'] else ('-',)
            print(f"{r['lobby']:22s} energy={r['energy']:8.4f} area={r['area_frac']:6.2f} addSlots={r['additive_slots']:3d} top={t1[1]} rank={rows.index(r)+1}")
print('\n=== BOTTOM 15（無光槽/極低）===')
for r in rows[-15:]:
    print(f"{r['lobby']:22s} energy={r['energy']:8.4f} area={r['area_frac']:6.2f} addSlots={r['additive_slots']:3d}")
