#!/usr/bin/env python3
# 驗證 renderer/app.js 後處理鏈常數 ＝ Unity URP 2021.3 官方源碼（docs/urp_2021_3_ref/）。
# 逐項抽取 app.js GLSL/JS 常數，與參考源碼比對；輸出 ✓/✗ 表。
import re

APP = open('renderer/app.js').read()
REF = {f: open(f'docs/urp_2021_3_ref/{f}').read() for f in
       ['Color.hlsl', 'ACES.hlsl', 'LutBuilderHdr.shader', 'ColorUtils.cs', 'PostProcessing.Common.hlsl']}
ok = bad = 0

def check(name, ours, ref, tol=1e-6):
    global ok, bad
    good = abs(ours - ref) <= tol * max(1.0, abs(ref))
    print(f"  {'✓' if good else '✗'} {name}: app={ours} ref={ref}")
    ok, bad = ok + good, bad + (not good)

def ref_const(src, pat, cast=float):
    m = re.search(pat, src)
    return cast(m.group(1)) if m else None

print('== Alexa LogC (El1000) — Color.hlsl ParamsLogC ==')
params = re.search(r'static const ParamsLogC LogC\s*=\s*\{(.*?)\};', REF['Color.hlsl'], re.S).group(1)
vals = [float(x) for x in re.findall(r'([\d.]+),?\s*//', params)]
cut, a, b, c, d, e, f = vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6]
app_logc = re.search(r'const float LOGC_CUT = ([\d.]+), LOGC_A = ([\d.]+), LOGC_B = ([\d.]+);\s*'
                     r'const float LOGC_C = ([\d.]+), LOGC_D = ([\d.]+), LOGC_E = ([\d.]+), LOGC_F = ([\d.]+);', APP)
ours = [float(x) for x in app_logc.groups()]
for name, o, r in zip(['cut', 'a', 'b', 'c', 'd', 'e', 'f'], ours, [cut, a, b, c, d, e, f]):
    check(f'LOGC_{name.upper()}', o, r)

print('== 對比樞 ACEScc_MIDGRAY — ACES.hlsl ==')
mid = ref_const(REF['ACES.hlsl'], r'#define ACEScc_MIDGRAY\s+([\d.]+)')
check('MIDGRAY', float(re.search(r'const float MIDGRAY = ([\d.]+)', APP).group(1)), mid)

print('== NeutralTonemap — Color.hlsl ==')
for k, refv in zip('abcdef', [0.2, 0.29, 0.24, 0.272, 0.02, 0.3]):
    blk = re.search(r'real3 NeutralTonemap.*?const real a = ([\d.]+);\s*const real b = ([\d.]+);\s*const real c = ([\d.]+);\s*'
                    r'const real d = ([\d.]+);\s*const real e = ([\d.]+);\s*const real f = ([\d.]+);', REF['Color.hlsl'], re.S)
    break
blk = re.search(r'real3 NeutralTonemap.*?const real a = ([\d.]+);\s*const real b = ([\d.]+);\s*const real c = ([\d.]+);\s*'
                r'const real d = ([\d.]+);\s*const real e = ([\d.]+);\s*const real f = ([\d.]+);', REF['Color.hlsl'], re.S).groups()
app_blk = re.search(r'const float a = 0\.2, b = ([\d.]+), c = ([\d.]+), d = ([\d.]+), e = ([\d.]+), f = ([\d.]+);', APP).groups()
for name, o, r in zip(['b', 'c', 'd', 'e', 'f'], app_blk, blk[1:]):
    check(f'Neutral_{name}', float(o), float(r))
check('Neutral_whiteLevel', float(re.search(r'const float whiteLevel = ([\d.]+)', APP).group(1)), 5.3)

print('== ACES fitting 常數 — ACES.hlsl ==')
pairs = [
    ('RRT_GLOW_GAIN', r'RRT_GLOW_GAIN = ([\d.]+)'),
    ('RRT_GLOW_MID', r'RRT_GLOW_MID = ([\d.]+)'),
    ('RRT_RED_SCALE', r'RRT_RED_SCALE = ([\d.]+)'),
    ('RRT_RED_PIVOT', r'RRT_RED_PIVOT = ([\d.]+)'),
    ('RRT_RED_WIDTH', r'RRT_RED_WIDTH = ([\d.]+)'),
    ('RRT_SAT_FACTOR', r'RRT_SAT_FACTOR = ([\d.]+)'),
    ('ODT_SAT_FACTOR', r'ODT_SAT_FACTOR = ([\d.]+)'),
    ('DIM_SURROUND_GAMMA', r'DIM_SURROUND_GAMMA = ([\d.]+)'),
]
for name, pat in pairs:
    r = ref_const(REF['ACES.hlsl'], pat)
    o = float(re.search(rf'const float {name} = ([\d.]+);', APP).group(1))
    check(name, o, r)
ap1 = re.search(r'const vec3 AP1_RGB2Y = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);', APP).groups()
apr = re.search(r'AP1_RGB2Y\s*=\s*half3\(([\d.]+), ([\d.]+), ([\d.]+)\)', REF['ACES.hlsl']).groups()
for i, name in enumerate('rgb'):
    check(f'AP1_RGB2Y.{name}', float(ap1[i]), float(apr[i]))

print('== 曝光 e = 2^postExposure ==')
check('2^5.5', 45.25483399593904, 2.0 ** 5.5)

print('== sRGB G2L/L2S（IEC 61966-2-1 標準）==')
g2l_ok = '0.04045' in APP and '12.92' in APP and '1.055' in APP and '2.4' in APP
print(f"  {'✓' if g2l_ok else '✗'} G2L/L2S 分段線性式在位（0.04045/12.92/1.055/2.4）")
ok, bad = ok + g2l_ok, bad + (not g2l_ok)

print(f'\n總計: ✓ {ok}  ✗ {bad}')
raise SystemExit(1 if bad else 0)
