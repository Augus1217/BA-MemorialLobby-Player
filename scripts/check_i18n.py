#!/usr/bin/env python3
"""check_i18n.py — ui_i18n.json 一致性＋引用完整性檢查（CI 用）。

1. 五語 key 集合必須完全一致（缺/多即 fail）。
2. renderer 的 t('...') 靜態引用＋index.html 的 data-i18n[*] 必須在表內（懸空即 fail）。
   例外：t('err.' + code) 動態前綴（以點結尾的片段不計；另查第 4 項）。
3. app.js 的 LOCAL_I18N 不得與 json 重複（json 優先，重复即死碼，fail）。
4. main.js 回傳的 { error: 'code' } 必須有對應 err.<code>（fail）。
5. 表內無人引用的 key 只警告（孤兒），不擋版。

用法：python3 scripts/check_i18n.py [--quiet]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / "assets" / "ui" / "ui_i18n.json"


def main() -> int:
    quiet = "--quiet" in sys.argv
    data = json.loads(I18N.read_text(encoding="utf-8"))
    langs = list(data.keys())
    keysets = {l: set(t.keys()) for l, t in data.items()}
    base = keysets[langs[0]]
    failed = False
    for l in langs[1:]:
        missing = sorted(base - keysets[l])
        extra = sorted(keysets[l] - base)
        if missing:
            print(f"::error::i18n {l} 缺 key：{', '.join(missing)}")
            failed = True
        if extra:
            print(f"::error::i18n {l} 多出 key（他語無）：{', '.join(extra)}")
            failed = True
    if not quiet:
        print("[i18n] 5 langs key 一致" if all(keysets[l] == base for l in langs)
              else "[i18n] key 集合不一致")

    app_src = (ROOT / "renderer" / "app.js").read_text(encoding="utf-8")
    web_src = (ROOT / "renderer" / "ba-web.js").read_text(encoding="utf-8")
    html_src = (ROOT / "index.html").read_text(encoding="utf-8")

    # t('k') 靜態引用（結尾是點的為動態前綴片段，跳過）
    refs = set()
    for src in (app_src, web_src):
        for m in re.findall(r"""\bt\(\s*['"]([A-Za-z0-9_.]+)['"]""", src):
            if not m.endswith("."):
                refs.add(m)
    for m in re.findall(r'data-i18n(?:-[a-z]+)?="([A-Za-z0-9_.]+)"', html_src):
        refs.add(m)
    dangling = sorted(r for r in refs if r not in base)
    if dangling:
        print(f"::error::i18n 懸空引用（表內無此 key）：{', '.join(dangling)}")
        failed = True
    elif not quiet:
        print(f"[i18n] {len(refs)} 個引用全在表內")

    # LOCAL_I18N 與 json 重複即死碼（t() 永遠先取 json）
    m = re.search(r"const LOCAL_I18N = \{(.*?)\n\};", app_src, re.S)
    if m:
        local_keys = {k for k in re.findall(r"'([a-z][a-zA-Z0-9_.]+)'\s*:", m.group(1))}
        dup = sorted(k for k in local_keys if k in base)
        if dup:
            print(f"::error::LOCAL_I18N 與 ui_i18n.json 重複（死碼，刪掉）：{', '.join(dup)}")
            failed = True
        elif not quiet:
            print("[i18n] LOCAL_I18N 無重複")

    # main.js 錯誤碼必須有對應 err.* key（renderer 以 tMainErr 翻譯，未知碼原樣顯示）
    main_src = (ROOT / "main.js").read_text(encoding="utf-8")
    codes = set(re.findall(r"""\{\s*key\s*,?\s*error\s*:\s*'([a-z0-9_]+)'""", main_src))
    codes.update(re.findall(r"""return\s*\{\s*error\s*:\s*'([a-z0-9_]+)'""", main_src))
    missing_codes = sorted(c for c in codes if f"err.{c}" not in base)
    if missing_codes:
        print(f"::error::main.js 錯誤碼缺 i18n：{', '.join('err.' + c for c in missing_codes)}")
        failed = True
    elif not quiet:
        print(f"[i18n] {len(codes)} 個主進程錯誤碼全有對應 key" if codes else "[i18n] 主進程無錯誤碼")

    # 孤兒 key：全 repo 無字面出現（僅提醒；err.* 由動態前綴覆蓋，不計入）
    if not quiet:
        blob = app_src + web_src + html_src + main_src
        orphans = sorted(k for k in base
                         if not k.startswith("err.")
                         and f"'{k}'" not in blob and f'"{k}"' not in blob)
        if orphans:
            print(f"[i18n] 孤兒 key（僅提醒，不擋版）：{', '.join(orphans)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
