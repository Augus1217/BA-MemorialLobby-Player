#!/usr/bin/env python3
"""make_tar_fixtures.py — 產生 tar 封裝測試樣本（給 tests/tar_stream_test.mjs 用）。

用法：python3 tests/make_tar_fixtures.py <OUTDIR>
產出 ustar.tar.gz / pax.tar.gz / gnu.tar.gz，內容固定（三種格式同一組檔案）：
  assets/data/lobby_index.json
  assets/spine/CH0001_home/skeleton.skel        （>10KB，測跨視窗讀取）
  assets/spine/CH0001_home/xxxx…(120).png       （長檔名；ustar 版會被截短）
  assets/spine/CH0001_home/日本語.png            （非 ASCII；ustar 版為 raw bytes）
"""
import io
import os
import sys
import tarfile

BASE_FILES = {
    "assets/data/lobby_index.json": b'{"Hanako_home": 1}',
    "assets/spine/CH0001_home/skeleton.skel": b"SKEL" + bytes(range(256)) * 40,
}
# ustar 放不下 >100 bytes 的單一檔名元件（tarfile 會直接 raise）——這正是 Assets
# 端改 USTAR 前必須先檢查長度的原因；長檔名/非 ASCII 只有 PAX/GNU 測得到。
EXTRA_FILES = {
    "assets/spine/CH0001_home/" + "x" * 120 + ".png": b"LONGNAME",
    "assets/spine/CH0001_home/\u65e5\u672c\u8a9e.png": b"NONASCII",
}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for fmt, name in ((tarfile.USTAR_FORMAT, "ustar"), (tarfile.PAX_FORMAT, "pax"),
                      (tarfile.GNU_FORMAT, "gnu")):
        files = dict(BASE_FILES)
        if fmt != tarfile.USTAR_FORMAT:
            files.update(EXTRA_FILES)
        path = os.path.join(out, name + ".tar.gz")
        with tarfile.open(path, "w:gz", format=fmt) as t:
            for rel, data in sorted(files.items()):
                info = tarfile.TarInfo(rel)
                info.size = len(data)
                info.mtime = 0
                t.addfile(info, io.BytesIO(data))
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
