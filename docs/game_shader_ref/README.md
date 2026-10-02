# 遊戲 Spine 著色器參考（spine-unity 4.2 branch 原始碼）

遊戲 bundle 材質與此對應：Spine/Skeleton（無 keyword、無 _Color），
Blend One OneMinusSrcAlpha；加法變體 Spine/Blend Modes/Skeleton PMA Additive
（Blend One One，_Color tint）。

## 逐像素公式（線性空間）

頂點色：v = PMAGammaToTargetSpace(PMA(sk×sl×att))
  = GammaToLinear(skRGB×slRGB×attRGB) × (skA×slA×attA)   [a>0 時 /a×a 相消]

frag.rgb = tex.rgb × [tex.a 若 _STRAIGHT_ALPHA_INPUT] × v.rgb
frag.a   = tex.a × v.a
out.rgb  = frag.rgb + dst.rgb × (1 − frag.a)   [normal]
out.rgb  = frag.rgb + dst.rgb                  [additive: Blend One One]

## Hanako toplight 帶入（sk=1, sl=1, att=(1,1,1,0.302)）
v.rgb = 0.302（線性）、v.a = 0.302
tex.rgb 恆定 lum≈141（sRGB→線性 0.267）、形狀全在 alpha、零 alpha texel 洋紅

normal 合成：out = 0.267×0.302 + dst×(1−0.87×0.302)  → 拉向灰紫（暗化亮 dst）
additive 合成：out = dst + 0.267×0.302                → 均勻提亮（台座爆白）
