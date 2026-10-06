#!/usr/bin/env python3
# 從 ppp_extracted.json（遊戲 PPV 原始資料）修補 lobby_post_config.json 的抽取缺口：
#   - 補 l（lift，經 URP PrepareLiftGammaGain）
#   - 補 cf（colorFilter，非恆等時）
#   - 補 c（contrast → shader 值 1+contrast/100）
#   - 修 hanako_home ch 的 12× 抽取錯誤（0.0005 → 0.12×k，k=全庫一致的 0.05）
# 本腳本可重入（冪等）。輸出 diff 摘要。
import json

G2L = lambda c: c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
LUM = lambda c: c[0]*0.2126729 + c[1]*0.7151522 + c[2]*0.072175
K_CA = 0.05   # 全庫一致的 CA 抽取尺度（259/260 廳驗證）

def prepare_lgg(raw):
    lift = [G2L(raw['lift'][k]) * 0.15 for k in 'xyz']
    lum = LUM(lift); lw = raw['lift']['w']
    lift = [v - lum + lw for v in lift]
    gam = [G2L(raw['gamma'][k]) * 0.8 for k in 'xyz']
    lum = LUM(gam); gw = raw['gamma']['w'] + 1
    gamma = [1/max(v - lum + gw, 1e-3) for v in gam]
    gain = [G2L(raw['gain'][k]) * 0.8 for k in 'xyz']
    lum = LUM(gain); gw = raw['gain']['w'] + 1
    gain = [v - lum + gw for v in gain]
    return lift, gamma, gain

def main():
    ppv = json.load(open('assets/data/ppp_extracted.json'))
    path = 'assets/data/lobby_post_config.json'
    cfg = json.load(open(path))
    changes = []
    for lobby, profiles in ppv.items():
        comps = [c for prof in profiles.values() for c in prof]
        by = {}
        for comp in comps:
            if comp.get('active'): by[comp['type']] = comp.get('parameters', {})
        if lobby in cfg:
            c = cfg[lobby]
        else:
            # variant 廳（_teen/_gl 等不在 config）：以本體 config 起底（保留 fallback 語義）
            base = lobby
            for suf in ('_teen', '_gl', '_home', '_multi'):
                if base.endswith(suf) and len(base) > len(suf):
                    cand = base[: -len(suf)]
                    if cand in cfg: c = dict(cfg[cand]); break
                    base = cand
            else:
                c = {}
            if not c:
                # 再退一層試（如 xxx_swimsuit_home_teen → xxx_swimsuit_home → ...）
                b2 = lobby
                while '_' in b2 and not c:
                    b2 = b2.rsplit('_', 1)[0]
                    if b2 in cfg: c = dict(cfg[b2]); break
            cfg[lobby] = c
        # ch 修正（k=0.05 慣例）
        cha = by.get('ChromaticAberration', {}).get('intensity', {})
        if cha.get('override') and cha['value'] > 0:
            ch_exp = round(cha['value'] * K_CA, 6)
            if c.get('ch') is None:
                c['ch'] = ch_exp; changes.append(f'{lobby}: ch 新增 {ch_exp}')
            elif abs(c['ch'] - ch_exp) > 1e-9:
                changes.append(f'{lobby}: ch {c["ch"]} → {ch_exp}（抽取錯誤修正）')
                c['ch'] = ch_exp
        elif c.get('ch') is not None and not cha:
            pass   # config 有 ch 但 PPV 無 CA —— 保守保留（14 廳 PPV 缺口外之情形另記錄）
        ca = by.get('ColorAdjustments', {})
        # l（lift）
        lgg = by.get('LiftGammaGain', {})
        if lgg.get('lift', {}).get('override'):
            raw = {k: lgg[k]['value'] for k in ('lift', 'gamma', 'gain')}
            lift, gamma, gain = prepare_lgg(raw)
            if any(abs(v) > 1e-4 for v in lift):
                l_new = [round(v, 6) for v in lift]
                if c.get('l') != l_new:
                    changes.append(f'{lobby}: l 新增/更新 {l_new}')
                    c['l'] = l_new
        # cf（colorFilter）
        cfv = ca.get('colorFilter', {})
        if cfv.get('override'):
            v = cfv['value']
            if any(abs(v[k] - 1) > 1e-4 for k in 'rgb'):
                cf_new = [round(v['r'], 6), round(v['g'], 6), round(v['b'], 6)]
                if c.get('cf') != cf_new:
                    changes.append(f'{lobby}: cf 新增/更新 {cf_new}')
                    c['cf'] = cf_new
        # c（contrast → 1+contrast/100）
        con = ca.get('contrast', {})
        if con.get('override') and abs(con['value']) > 1e-6:
            c_exp = round(1 + con['value'] / 100.0, 6)
            if c.get('c') != c_exp:
                changes.append(f'{lobby}: c 新增/更新 {c_exp}（PPV contrast={con["value"]}）')
                c['c'] = c_exp
    json.dump(cfg, open(path, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
    print(f'變更 {len(changes)} 筆：')
    for ch in changes: print('  ', ch)

if __name__ == '__main__':
    main()
