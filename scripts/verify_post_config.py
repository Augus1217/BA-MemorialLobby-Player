#!/usr/bin/env python3
# 逐廳驗證 lobby_post_config.json 對回遊戲原始資料 ppp_extracted.json（PPV Volume profiles）。
# 驗證項：
#   e  == 2^ColorAdjustments.postExposure
#   ch == k × ChromaticAberration.intensity（k 應全庫一致＝實作尺度常數）
#   g  == PrepareLiftGammaGain(gain)（URP 2021.3 core ColorUtils.cs 鐵譜公式）
#   gm == PrepareLiftGammaGain(gamma)
#   p  == [PaniniProjection.distance, cropToFit]
#   lift 覆寫偵測（config 無 l 欄位——若原始資料有 lift 覆寫＝抽取缺口）
# 輸出：逐項統計 + 不吻合清單
import json, math

G2L = lambda c: c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
LUM = lambda c: c[0]*0.2126729 + c[1]*0.7151522 + c[2]*0.072175

def prepare_lgg(raw):
    # raw: {'x','y','z','w'}；回傳 (lift, gamma, gain) 各 (x,y,z)
    def prep(channel, kind, w):
        t = G2L(channel) * (0.15 if kind == 'lift' else 0.8)
        return t
    lift = [prep(raw['lift'][k], 'lift', raw['lift']['w']) for k in 'xyz']
    lum = LUM(lift); lw = raw['lift']['w']
    lift = [v - lum + lw for v in lift]
    gam = [prep(raw['gamma'][k], 'gamma', 0) for k in 'xyz']
    lum = LUM(gam); gw = raw['gamma']['w'] + 1
    gamma = [1/max(v - lum + gw, 1e-3) for v in gam]
    gain = [prep(raw['gain'][k], 'gamma', 0) for k in 'xyz']
    lum = LUM(gain); gw = raw['gain']['w'] + 1
    gain = [v - lum + gw for v in gain]
    return lift, gamma, gain

def main():
    ppv = json.load(open('assets/data/ppp_extracted.json'))
    cfg = json.load(open('assets/data/lobby_post_config.json'))
    stats = {'e_ok': 0, 'e_bad': [], 'ch_ok': 0, 'ch_ratios': {}, 'lgg_ok': 0, 'lgg_bad': [],
             'p_ok': 0, 'p_bad': [], 'lift_override': [], 'no_ppv': [], 'no_cfg': []}
    lobbies = sorted(set(ppv) | set(cfg))
    for lobby in lobbies:
        profiles = list((ppv.get(lobby) or {}).values())
        comps = [c for prof in profiles for c in prof] if profiles else None
        c = cfg.get(lobby)
        if comps is None: stats['no_ppv'].append(lobby); continue
        if c is None: stats['no_cfg'].append(lobby); continue
        by_type = {}
        for comp in comps:
            if comp.get('active'):
                by_type[comp['type']] = comp.get('parameters', {})
        # e（ColorAdjustments.postExposure）
        ca = by_type.get('ColorAdjustments', {})
        pe = ca.get('postExposure')
        if c.get('e') is not None:
            if pe and pe.get('override'):
                e_exp = 2.0 ** pe['value']
                if abs(e_exp - c['e']) < 1e-6 * max(1, e_exp): stats['e_ok'] += 1
                else: stats['e_bad'].append((lobby, c['e'], e_exp, pe['value']))
            else:
                stats['e_bad'].append((lobby, c['e'], 'PPV 無 postExposure override', None))
        elif pe and pe.get('override') and pe['value'] != 0:
            stats['e_bad'].append((lobby, 'config 無 e', 2.0 ** pe['value'], pe['value']))
        # ch（ChromaticAberration.intensity）
        cha = by_type.get('ChromaticAberration', {}).get('intensity')
        if c.get('ch') is not None:
            if cha and cha.get('override') and cha['value'] > 0:
                k = c['ch'] / cha['value']
                stats['ch_ratios'][lobby] = k
            elif cha is None or not cha.get('override') or cha['value'] == 0:
                stats['ch_ratios'][lobby] = None  # config 有但 PPV 無 → 記 None
        elif cha and cha.get('override') and cha['value'] > 0:
            stats['ch_ratios'][lobby] = 'config 無 ch'
        # LGG（lift/gamma/gain）
        lgg = by_type.get('LiftGammaGain', {})
        if lgg:
            raw = {k: lgg[k]['value'] for k in ('lift', 'gamma', 'gain') if k in lgg}
            if raw.get('lift', {}).get('override'):
                lift_p, gamma_p, gain_p = prepare_lgg(raw)
                l_cfg = c.get('l')
                if any(abs(v) > 1e-4 for v in lift_p):
                    if l_cfg is None or any(abs(a-b) > 1e-3 for a, b in zip(l_cfg, lift_p)):
                        stats['lift_override'].append((lobby, l_cfg, [round(v, 5) for v in lift_p]))
                elif l_cfg is not None:
                    stats['lift_override'].append((lobby, l_cfg, 'PPV lift 恆等但 config 有 l'))
            if raw.get('gain') and raw.get('gamma'):
                lift, gamma, gain = prepare_lgg(raw)
                g_cfg, gm_cfg = c.get('g'), c.get('gm')
                def is_identity(v): return v is None or all(abs(x - 1) < 1e-4 for x in (v if isinstance(v, list) else [v]*3))
                def is_zero(v): return v is None or all(abs(x) < 1e-4 for x in (v if isinstance(v, list) else [v]*3))
                gain_ov = lgg['gain'].get('override'); gamma_ov = lgg['gamma'].get('override')
                ok = True
                if gain_ov and not is_identity(gain):
                    if g_cfg is None or any(abs(a-b) > 1e-3 for a, b in zip(g_cfg, gain)): ok = False
                if gamma_ov and not is_identity(gamma):
                    if gm_cfg is None or any(abs(a-b) > 1e-3 for a, b in zip(gm_cfg, gamma)): ok = False
                if ok: stats['lgg_ok'] += 1
                else: stats['lgg_bad'].append((lobby, g_cfg, [round(v, 5) for v in gain], gm_cfg, [round(v, 5) for v in gamma]))
        # p（PaniniProjection）
        pan = by_type.get('PaniniProjection', {})
        dist = pan.get('distance'); crop = pan.get('cropToFit')
        if c.get('p') is not None:
            d_exp = dist['value'] if dist and dist.get('override') else 0
            cr_exp = crop['value'] if crop and crop.get('override') else 0
            if abs(c['p'][0] - d_exp) < 1e-4 and abs(c['p'][1] - cr_exp) < 1e-4: stats['p_ok'] += 1
            else: stats['p_bad'].append((lobby, c['p'], [d_exp, cr_exp]))
    # 報告
    ks = sorted(stats['ch_ratios'])
    vals = [v for v in stats['ch_ratios'].values() if isinstance(v, float)]
    print(f"== e（曝光 2^postExposure）==  OK: {stats['e_ok']}  不吻合: {len(stats['e_bad'])}")
    for row in stats['e_bad'][:8]: print('   ', row)
    print(f"== ch（色差 intensity×k）==  有值: {len(vals)}")
    if vals:
        k0 = min(vals); k1 = max(vals)
        print(f'    比值 k 範圍: [{k0:.6f}, {k1:.6f}]  離散度: {(k1-k0)/((k0+k1)/2)*100:.2f}%')
        bad = [l for l, v in stats['ch_ratios'].items() if not isinstance(v, float)]
        if bad: print('    config/PPV 不對稱:', bad[:10])
    print(f"== LGG（Prepare 公式）==  OK: {stats['lgg_ok']}  不吻合: {len(stats['lgg_bad'])}")
    for row in stats['lgg_bad'][:8]: print('   ', row)
    print(f"== p（panini）==  OK: {stats['p_ok']}  不吻合: {len(stats['p_bad'])}")
    for row in stats['p_bad'][:8]: print('   ', row)
    print(f"== lift（config l 對照 Prepare）==  缺口/不吻合: {len(stats['lift_override'])}")
    for row in stats['lift_override'][:8]: print('   ', row)
    print(f"== 覆蓋 ==  PPV 無此廳: {len(stats['no_ppv'])} {stats['no_ppv'][:8]}")
    print(f"            config 無此廳: {len(stats['no_cfg'])} {stats['no_cfg'][:8]}")

if __name__ == '__main__':
    main()
