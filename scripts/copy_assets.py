#!/usr/bin/env python3
"""Copy needed BA Memorial Lobby assets into this project.

Sources:
  - /home/augus/BA_Extracted_Full/Assets/_MX/SpineLobbies  (skel/atlas/png/clips/timeline/pppv)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_Extracted/Media/JP_*   (voice)
  - /home/augus/Blue-Archive-Asset-Downloader/GL_RawData/Media/Audio/BGM (BGM)
  - /home/augus/BA_MemorialLobby/data (schedule + mappings, reuse)

Only the MAIN skeleton variant is copied (_1/_2/_3 LOD copies skipped).
Lobby room/scene skeletons (folders like Aru_Scene) go to assets/scene/.
"""
import os
import shutil
import sys
import re
import json
import subprocess

# ---- home 主圖集合併 scene 圖集區域（Akari 等：home 骨架內含背景/特寫網格，
#      但貼圖區域分散在拆分的 bg/scene 圖集，主圖集單獨載入會 Region not found）----


def _split_atlas(text):
    """回傳 [(page_png, [header 之後的各行]), ...]，CRLF 安全。"""
    pages = []
    cur = None
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw.endswith(".png"):
            cur = (raw.strip(), [])
            pages.append(cur)
        elif cur is not None:
            cur[1].append(raw)
    return pages


def _region_names(page_lines):
    # spine atlas 中區域名整行不含 ':'（屬性行才有 ':'）
    return [ln.strip() for ln in page_lines if ln.strip() and ":" not in ln]


def _split_page_items(page_lines):
    """單頁內容切為 (meta 行, region 區塊清單)。region 名不含 ':'。"""
    metas = []
    regions = []
    cur = None
    for ln in page_lines:
        s = ln.strip()
        if not s:
            continue
        if ":" in ln:
            if cur is None:
                metas.append(ln)
            else:
                cur.append(ln)
        else:
            if cur is not None:
                regions.append(cur)
            cur = [ln]
    if cur is not None:
        regions.append(cur)
    return metas, regions


def _referenced(skel_bytes, name):
    if name.encode("utf-8", "ignore") in skel_bytes:
        return True
    base = name.split(" ")[0]
    return bool(base) and base != name and base.encode("utf-8", "ignore") in skel_bytes


def _merge_scene_into_home(home_atlas_path, scene_dir, scene_atlases):
    """把 scene 圖集的區域（去重）附加為新頁進 home 主圖集，回傳新增的頁面 png 清單。"""
    with open(home_atlas_path, encoding="utf-8", errors="ignore") as fh:
        home_text = fh.read()
    existing = set()
    for _png, lines in _split_atlas(home_text):
        existing.update(_region_names(lines))
    out = home_text.rstrip("\n") + "\n"
    added_pages = []
    for sa in scene_atlases:
        sp = os.path.join(scene_dir, sa)
        if not os.path.exists(sp):
            continue
        with open(sp, encoding="utf-8", errors="ignore") as fh:
            txt = fh.read()
        for png, lines in _split_atlas(txt):
            metas, regions = _split_page_items(lines)
            kept = []
            for seg in regions:
                nm = seg[0].strip()
                if nm in existing:
                    continue
                existing.add(nm)
                kept.append(seg)
            if kept:
                out += png + "\n"
                for m in metas:
                    out += m + "\n"
                for seg in kept:
                    for l in seg:
                        out += l + "\n"
                added_pages.append(png.strip())
    if added_pages:
        out = out.replace("\r\n", "\n").replace("\r", "\n")
        with open(home_atlas_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(out)
    return added_pages


def _compute_core(key):
    """對應 renderer/app.js lobbyGroupInfo 的 core 計算（去掉 _home/_gl/_teen/_multi
    與泳裝/新年等服裝後綴；側欄以此作為 icon_index 的查詢鍵）。"""
    rest = key.lower()
    while True:
        ch = False
        for suf in ("_home_gl", "_home", "_gl", "_multi", "_teen"):
            if rest.endswith(suf):
                rest = rest[: -len(suf)]
                ch = True
        if not ch:
            break
    if rest.startswith("lobby"):
        rest = rest[5:]
    for suf in ("_swimsuit", "_newyear", "_ridingsuit", "_casual"):
        if rest.endswith(suf):
            rest = rest[: -len(suf)]
    return rest


def extract_portraits():
    """從 BA 的 Student_Portrait_<characterId>.png 擷取學生大頭貼為 webp，並補齊
    icon_index.json 中缺失的 core 條目（以 characterId 為檔名，與 BA 命名一致）。
    採「增量合併」：保留既有 icon_index 與手動 webp，只補缺。
    覆蓋範圍：lobby_index 列出的所有 lobby（含 voice_schedule 沒列的），用 core
    去查圖；characterId 優先取 voice_schedule，否則由 core 推導（CH####→大寫，
    其餘→首字大寫）。BA 檔名大小寫不一，故對每個 candidate 嘗試多種大小寫。"""
    sched = os.path.join(SRC_DATA, "lobby_voice_schedule.json")
    sched_lobbies = {}
    if os.path.exists(sched):
        try:
            with open(sched, encoding="utf-8", errors="ignore") as fh:
                sd = json.load(fh)
            sched_lobbies = sd.get("lobbies", sd)
        except Exception as e:
            print(f"lobby_voice_schedule.json 讀取失敗: {e}", file=sys.stderr)
    # 收集所有需要處理的 core → 偏好的 characterId
    cores = {}
    li_path = os.path.join(DST_DATA, "lobby_index.json")
    if os.path.exists(li_path):
        try:
            with open(li_path, encoding="utf-8", errors="ignore") as fh:
                li = json.load(fh)
            for k in li:
                cores.setdefault(_compute_core(k), None)
        except Exception:
            pass
    for k, v in sched_lobbies.items():
        cid = (v.get("characterId") or "").strip()
        if cid:
            cores.setdefault(_compute_core(k), cid)
    dst = os.path.join(ROOT, "assets", "students")
    os.makedirs(dst, exist_ok=True)
    icon_path = os.path.join(dst, "icon_index.json")
    icon = {}
    if os.path.exists(icon_path):
        try:
            with open(icon_path, encoding="utf-8", errors="ignore") as fh:
                icon = json.load(fh)
        except Exception:
            icon = {}
    if not cores:
        print("無可處理的 lobby，跳過大頭貼擷取", file=sys.stderr)
        return

    def ba_candidates(cid):
        cands = set()
        for c in (cid, cid.upper(), cid.capitalize(), cid.title()):
            if c:
                cands.add(c)
        res = []
        for c in sorted(cands):
            res.append(f"Student_Portrait_{c}.png")
            res.append(f"Student_Portrait_{c}_Small.png")
        return res

    n_new = 0
    n_missing = 0
    n_skip = 0
    for core, pref_cid in sorted(cores.items()):
        if core in icon and os.path.exists(os.path.join(dst, icon[core])):
            n_skip += 1
            continue
        if pref_cid:
            cids = [pref_cid]
        elif core.startswith("ch"):
            cids = [core.upper()]
        else:
            cids = [core.capitalize()]
        src = None
        resolved = None
        for cid in cids:
            for cand in ba_candidates(cid):
                p = os.path.join(SRC_PORTRAIT, cand)
                if os.path.exists(p):
                    src = p
                    resolved = cid
                    break
            if src:
                break
        if not src and re.fullmatch(r"CH\d+", cid, re.I):
            # NPC lobby：BA 用 NPC_Portrait_NP####.png 而非 Student_Portrait
            npc = "NP" + re.search(r"\d+", cid).group()
            for cand in (f"NPC_Portrait_{npc}.png", f"NPC_Portrait_{npc}_Small.png"):
                p = os.path.join(SRC_PORTRAIT, cand)
                if os.path.exists(p):
                    src = p
                    resolved = cid
                    break
        if not src:
            n_missing += 1
            print(f"大頭貼在 BA 中缺失: core={core} cid={cids}", file=sys.stderr)
            continue
        webp = f"{resolved}.webp"
        dst_webp = os.path.join(dst, webp)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", src,
                 "-vf", "scale=120:120:force_original_aspect_ratio=decrease,pad=120:120:(ow-iw)/2:(oh-ih)/2",
                 "-color_primaries", "bt709", dst_webp],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            print(f"ffmpeg 轉檔失敗 {resolved}: {e}", file=sys.stderr)
            continue
        icon[core] = webp
        n_new += 1
    if n_new or n_missing:
        with open(icon_path, "w", encoding="utf-8") as fh:
            json.dump(icon, fh, ensure_ascii=False, indent=1)
        print(f"大頭貼: 新增 {n_new} 張 webp，BA 缺失 {n_missing} 張，已存在跳過 {n_skip}")
    else:
        print(f"大頭貼: 全部已涵蓋（跳過 {n_skip}）")


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_SPINE = os.environ.get("BA_SRC_SPINE", "/home/augus/JP_Extracted_Full/Assets/_MX/SpineLobbies")
SRC_MEDIA = os.environ.get("BA_SRC_MEDIA", "/home/augus/JP_Voice_Extracted")
SRC_BGM = os.environ.get("BA_SRC_BGM", "/home/augus/Blue-Archive-Asset-Downloader/JP_Android_RawData/Media/GameData/Audio/BGM")
SRC_DATA = os.environ.get("BA_SRC_DATA", "/home/augus/BA_MemorialLobby/data")
SRC_PORTRAIT = os.environ.get(
    "BA_SRC_PORTRAIT",
    "/home/augus/JP_Extracted_Full/Assets/_MX/AddressableAsset/UIs/01_Common/01_Character",
)

DST_SPINE = os.path.join(ROOT, "assets", "spine")
DST_SCENE = os.path.join(ROOT, "assets", "scene")
DST_VOICE = os.path.join(ROOT, "assets", "voice")
DST_BGM = os.path.join(ROOT, "assets", "bgm")
DST_DATA = os.path.join(ROOT, "assets", "data")


def main():
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    os.makedirs(DST_SPINE, exist_ok=True)
    os.makedirs(DST_SCENE, exist_ok=True)
    os.makedirs(DST_VOICE, exist_ok=True)
    os.makedirs(DST_BGM, exist_ok=True)
    os.makedirs(DST_DATA, exist_ok=True)
    n_lobby = 0
    if not os.path.exists(SRC_SPINE):
        print(f"SRC_SPINE not found: {SRC_SPINE}, skipping spine copy", file=sys.stderr)
    for name in (sorted(os.listdir(SRC_SPINE)) if os.path.exists(SRC_SPINE) else []):
        if only and name not in only:
            continue
        src = os.path.join(SRC_SPINE, name)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(DST_SPINE, name)
        os.makedirs(dst, exist_ok=True)
        copied = 0
        main_atlas_refs = set()
        for f in os.listdir(src):
            if not f.endswith(".atlas") or re.search(r"_(1|2|3)\.atlas$", f):
                continue
            with open(os.path.join(src, f), encoding="utf-8", errors="ignore") as atlas:
                main_atlas_refs.update(
                    line.strip() for line in atlas
                    if line.strip().endswith(".png")
                )
        for dirpath, _dirs, files in os.walk(src):
            rel = os.path.relpath(dirpath, src)
            if rel != "." and rel.startswith(("_",)):
                continue
            for f in files:
                if re.search(r"_(1|2|3)\.(skel|atlas)$", f):
                    continue
                if f.endswith(".png") and re.search(r"_(1|2|3)\.png$", f) and f not in main_atlas_refs:
                    continue
                if "_scene" in f or "_bg" in f or "_background" in f:
                    continue
                if f.endswith((".skel", ".atlas", ".png", ".json")):
                    sub = os.path.join(dst, rel) if rel != "." else dst
                    os.makedirs(sub, exist_ok=True)
                    shutil.copy2(os.path.join(dirpath, f), os.path.join(sub, f))
                    copied += 1
        if copied:
            n_lobby += 1
            print(f"lobby {name}: {copied} files")
    print(f"lobbies copied: {n_lobby}")

    # Room/scene overlay skeletons (few lobbies ship one, e.g. Aru_Scene).
    n_scene = 0
    if not os.path.exists(SRC_SPINE):
        print(f"SRC_SPINE not found for scene, skipping", file=sys.stderr)
    for name in (sorted(os.listdir(SRC_SPINE)) if os.path.exists(SRC_SPINE) else []):
        if only and name not in only:
            continue
        src_lobby = os.path.join(SRC_SPINE, name)
        if not os.path.isdir(src_lobby):
            continue
        for sub in os.listdir(src_lobby):
            low = sub.lower()
            if "scene" not in low and "_bg" not in low and "_background" not in low:
                continue
            src = os.path.join(src_lobby, sub)
            if not os.path.isdir(src):
                continue
            dst = os.path.join(DST_SCENE, name)
            os.makedirs(dst, exist_ok=True)
            existing = {e.lower() for e in os.listdir(dst)}
            copied = 0
            for f in os.listdir(src):
                if re.search(r"_(1|2|3)\.(skel|atlas|png)$", f):
                    continue
                if f.endswith((".skel", ".atlas", ".png")) and f.lower() not in existing:
                    shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
                    copied += 1
            if copied:
                n_scene += 1
                print(f"scene {name}: {copied} files")
    print(f"scenes copied: {n_scene}")

    # 合併 scene 目錄的 bg/scene 圖集區域進 home 主圖集（Akari 等：home 骨架內含
    # 背景/特寫網格，但區域分散在拆分的 bg/scene 圖集）。僅對「home 骨架確實參照了
    # scene 區域」的 lobby 執行，避免無謂擴張其他 lobby 圖集。
    n_merged = 0
    for name in sorted(os.listdir(DST_SPINE)):
        if only and name not in only:
            continue
        home_dir = os.path.join(DST_SPINE, name, name)
        scene_dir = os.path.join(DST_SCENE, name)
        if not os.path.isdir(home_dir) or not os.path.isdir(scene_dir):
            continue
        home_atlas = None
        for f in sorted(os.listdir(home_dir)):
            if f.endswith(".atlas") and not re.search(r"_(1|2|3)\.atlas$", f) \
               and "_scene" not in f and "_bg" not in f:
                home_atlas = f
                break
        if not home_atlas:
            continue
        home_atlas_path = os.path.join(home_dir, home_atlas)
        scene_atlases = [f for f in sorted(os.listdir(scene_dir))
                         if f.endswith(".atlas") and not re.search(r"_(1|2|3)\.atlas$", f)]
        if not scene_atlases:
            continue
        home_skel = None
        for f in sorted(os.listdir(home_dir)):
            if f.endswith(".skel") and not re.search(r"_(1|2|3)\.skel$", f) \
               and "_scene" not in f and "_bg" not in f:
                with open(os.path.join(home_dir, f), "rb") as fh:
                    home_skel = fh.read()
                break
        if not home_skel:
            continue
        scene_region_names = set()
        for sa in scene_atlases:
            try:
                t = open(os.path.join(scene_dir, sa), encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            for _p, lines in _split_atlas(t):
                scene_region_names.update(_region_names(lines))
        if not scene_region_names:
            continue
        if not any(_referenced(home_skel, nm) for nm in scene_region_names):
            continue
        added = _merge_scene_into_home(home_atlas_path, scene_dir, scene_atlases)
        if added:
            for png in added:
                sp = os.path.join(scene_dir, png)
                if os.path.exists(sp):
                    shutil.copy2(sp, os.path.join(home_dir, png))
            n_merged += 1
            print(f"merged scene regions into {name} home atlas ({len(added)} page(s): {added})")
    print(f"home atlases merged with scene: {n_merged}")

    n_voice = 0
    if not os.path.exists(SRC_MEDIA):
        print(f"SRC_MEDIA not found: {SRC_MEDIA}, skipping voice copy", file=sys.stderr)
    for d in (sorted(os.listdir(SRC_MEDIA)) if os.path.exists(SRC_MEDIA) else []):
        if not d.startswith("JP_"):
            continue
        src = os.path.join(SRC_MEDIA, d)
        # baax extract media 可能解出雙層嵌套（JP_X/JP_X/），
        # 偵測到時自動用內層目錄作為來源。
        inner = os.path.join(src, d)
        if os.path.isdir(inner):
            src = inner
        shutil.copytree(src, os.path.join(DST_VOICE, d), dirs_exist_ok=True)
        n_voice += 1
    print(f"voice folders copied: {n_voice}")

    n_bgm = 0
    if not os.path.exists(SRC_BGM):
        print(f"SRC_BGM not found: {SRC_BGM}, skipping bgm copy", file=sys.stderr)
    # Theme_* 全拷之外，lobby_bgm_mapping.csv 引用的非 Theme 檔
    # （如 BlueNewWorld_Lobby.ogg）也要拷，否則對應 lobby 靜音。
    extra_bgm = set()
    mapping_csv = os.path.join(SRC_DATA, "lobby_bgm_mapping.csv")
    if os.path.exists(mapping_csv):
        try:
            import csv as _csv
            with open(mapping_csv, newline="", encoding="utf-8", errors="ignore") as fh:
                for row in _csv.DictReader(fh):
                    fn = (row.get("bgm_filename") or "").strip()
                    if fn:
                        extra_bgm.add(fn)
        except Exception as e:
            print(f"lobby_bgm_mapping.csv 讀取失敗({e})，僅拷 Theme_*", file=sys.stderr)
    for f in (sorted(os.listdir(SRC_BGM)) if os.path.exists(SRC_BGM) else []):
        if f.startswith("Theme_") or f in extra_bgm:
            shutil.copy2(os.path.join(SRC_BGM, f), os.path.join(DST_BGM, f))
            n_bgm += 1
    print(f"bgm copied: {n_bgm}" + (f" (mapping 引用 {len(extra_bgm)} 檔)" if extra_bgm else ""))

    os.makedirs(DST_DATA, exist_ok=True)
    if not os.path.exists(SRC_DATA):
        print(f"SRC_DATA not found: {SRC_DATA}, skipping data copy", file=sys.stderr)
    else:
        # 全量拷貝 data/ 下所有 json/csv（flash_curves.json、lobby_chat_anchors.json、
        # icon_index.json 等手動維護檔都一併帶上，避免漏包）
        n_data = 0
        for f in sorted(os.listdir(SRC_DATA)):
            if f.endswith((".json", ".csv")):
                shutil.copy2(os.path.join(SRC_DATA, f), os.path.join(DST_DATA, f))
                n_data += 1
        print(f"data copied: {n_data} files")

    # 手動素材（intro 影片/音訊、ui 氣泡/游標、students 頭像）從 repo manual/ 拷入
    MANUAL_ROOT = os.environ.get("BA_SRC_MANUAL", os.path.join(ROOT, "manual"))
    for sub in ("intro", "ui", "students"):
        src = os.path.join(MANUAL_ROOT, sub)
        dst = os.path.join(ROOT, "assets", sub)
        if not os.path.isdir(src):
            print(f"manual/{sub} not found, skipping", file=sys.stderr)
            continue
        os.makedirs(dst, exist_ok=True)
        n = 0
        for f in sorted(os.listdir(src)):
            p = os.path.join(src, f)
            if os.path.isfile(p):
                shutil.copy2(p, os.path.join(dst, f))
                n += 1
        print(f"manual/{sub} copied: {n} files")

    # 學生大頭貼：從 BA 擷取 Student_Portrait_<characterId>.png → webp，補齊 icon_index
    extract_portraits()


def gen_manifest():
    """Per-lobby resolved main assets (handle Airi0/Airi, CH9996/CH0996, juri/Juri quirks)."""
    import json as _json
    idx = {}
    for name in sorted(os.listdir(DST_SPINE)):
        d = os.path.join(DST_SPINE, name)
        if not os.path.isdir(d):
            continue
        files = []
        for dirpath, _dirs, fnames in os.walk(d):
            for f in fnames:
                files.append(os.path.join(os.path.relpath(dirpath, d), f))
        # main skel: prefer merged .json (may contain merged skeletons),
        # fallback to .skel. Skip _N LOD copies and _scene/_bg.
        jsons = sorted(f for f in files
                       if f.endswith(".json") and not re.search(r"_[1-3]\.json$", f)
                       and "_scene" not in f and "_bg" not in f
                       and not f.endswith(("_Atlas.json", "_Material.json", "_SkeletonData.json",
                                          "Atlas_1.json", "Material_1.json", "SkeletonData_1.json")))
        skels = sorted(f for f in files
                       if f.endswith(".skel") and not re.search(r"_[1-3]\.skel$", f)
                       and "_scene" not in f and "_bg" not in f)
        atlases = sorted(f for f in files
                         if f.endswith(".atlas") and not re.search(r"_[1-3]\.atlas$", f)
                         and "_scene" not in f and "_bg" not in f)
        if not atlases:
            continue
        # 主要圖集優先選「檔名主幹 == 目錄名」且層級最淺的：CH0060_home 的主檔在
        # lobby 目錄頂層，巢狀副本（CH0060_home/…）與背景子目錄（CH0060BG_home/…）
        # 都不該被選成主要骨架路徑。
        dir_low = name.lower()
        def _atlas_rank(a):
            stem = os.path.splitext(os.path.basename(a))[0].lower()
            return (0 if stem == dir_low else 1, a.count(os.sep), a)
        atlases = sorted(atlases, key=_atlas_rank)
        atlas = atlases[0]
        atlas_base = os.path.splitext(os.path.basename(atlas))[0].lower()
        # Prefer merged .json matching atlas name, then .skel, then first candidate
        skel = None
        for pool in (jsons, skels):
            for s in pool:
                if os.path.splitext(os.path.basename(s))[0].lower() == atlas_base:
                    skel = s
                    break
            if skel:
                break
        if not skel:
            skel = (jsons or skels)[0]
        # png pages referenced by the atlas (best-effort: pages listed in the atlas text)
        pages = []
        atxt = os.path.join(d, atlas.replace("\\", os.sep))
        if os.path.exists(atxt):
            with open(atxt) as fh:
                pages = [l.strip() for l in fh.read().splitlines() if l.strip().endswith(".png")]
        idx[name] = {
            "skel": skel,
            "atlas": atlas,
            "png": pages,
        }
    # scene overlays (assets/scene/<name>)
    for name in sorted(os.listdir(DST_SCENE)):
        d = os.path.join(DST_SCENE, name)
        if not os.path.isdir(d):
            continue
        skels = sorted(f for f in os.listdir(d)
                       if f.endswith(".skel") and not re.search(r"_[1-3]\.skel$", f))
        atlases = sorted(f for f in os.listdir(d)
                         if f.endswith(".atlas") and not re.search(r"_[1-3]\.atlas$", f))
        if not skels or not atlases:
            continue
        # 場景疊加層（assets/scene/<name>）分兩組「各自獨立播出」：
        #   - 含 _bg／_background：「背景」，持續繪製於本體之後 → "bg" 鍵；
        #   - 其餘（_scene 特寫或一般疊加）→ "scene" 鍵（開場閃白時移除）。
        # 兩組可並存（如 Akari：akari_bg 背景 + akari_scene 特寫），分別對應
        # BA 的獨立 GameObject，以人物同一變換分開繪製。
        def is_bg(f):
            low = f.lower()
            return "_bg" in low or "_background" in low or bool(re.search(r"\dbg_", low))
        def emit_overlay(key, skel_list, atlas_list):
            if not skel_list or not atlas_list:
                return
            atlas = atlas_list[0]
            atlas_base = os.path.splitext(atlas)[0].lower()
            skel = next((s for s in skel_list
                         if os.path.splitext(s)[0].lower() == atlas_base), skel_list[0])
            pages = []
            atxt = os.path.join(d, atlas)
            if os.path.exists(atxt):
                with open(atxt) as fh:
                    pages = [l.strip() for l in fh.read().splitlines() if l.strip().endswith(".png")]
            idx.setdefault(name, {})[key] = {"skel": skel, "atlas": atlas, "png": pages}
        emit_overlay("bg", [f for f in skels if is_bg(f)], [f for f in atlases if is_bg(f)])
        emit_overlay("scene", [f for f in skels if not is_bg(f)], [f for f in atlases if not is_bg(f)])
    # manifest 同時寫到 assets/ 根目錄（開發模式）與 assets/data/
    # （打包模式：lobby_index.json 必須進 data 包，否則純下載的
    # Player fetch assets/lobby_index.json 會 404 起不來）
    out_paths = [
        os.path.join(ROOT, "assets", "lobby_index.json"),
        os.path.join(DST_DATA, "lobby_index.json"),
    ]
    for p in out_paths:
        with open(p, "w") as fh:
            _json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(f"manifest: {len(idx)} lobbies -> {out_paths}")


if __name__ == "__main__":
    main()
    gen_manifest()
    # 從 Unity dump 抽每 lobby 的 Transform（renderer 判定 bg「同人物變換/獨立填滿」用）
    try:
        import extract_lobby_transforms
        extract_lobby_transforms.main()
    except Exception as e:
        print(f"lobby_transforms 抽取失敗（bg 將退回內容置中推測）: {e}", file=sys.stderr)
