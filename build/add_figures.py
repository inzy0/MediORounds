"""Fill in published figures for cases in site/data/cases (PMC Open Access cloud bucket, public, no key).

Re-runnable: only cases without figures are queried. Captions are re-read from the local article copy and
paired with images only when the counts match. Updates each shard and its index in place.
Usage: python add_figures.py --library <PMC OA library>
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import build_casebank as B

IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def list_figures(pmcid: str):
    url = f"{B.S3}/?list-type=2&prefix={pmcid}.&max-keys=300"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                xml = r.read().decode("utf-8", "replace")
            keys = re.findall(r"<Key>([^<]+)</Key>", xml)
            if not keys:
                return ("none", [])
            ver = sorted({k.split("/")[0] for k in keys}, key=B.natkey)[-1]
            imgs = sorted([k.split("/", 1)[1] for k in keys if k.startswith(ver + "/") and k.lower().endswith(IMG_EXT)
                           and not re.search(r"(thumb|icon|logo)", k, re.I)], key=B.natkey)
            # prefer one format per figure (a .gif thumbnail often sits next to the .jpg)
            stems = {}
            for f in imgs:
                st = f.rsplit(".", 1)[0]
                if st not in stems or f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    stems[st] = f
            return (ver, sorted(stems.values(), key=B.natkey))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def main(library: Path) -> None:
    con = sqlite3.connect(library / "index.sqlite3")
    root = B.OUT / "cases"
    shards = sorted(p for p in root.glob("*/[0-9]*.json"))
    data = {p: json.loads(p.read_text(encoding="utf-8")) for p in shards}
    todo = {c["id"] for cs in data.values() for c in cs if not c.get("figs")}
    print("cases without figures:", len(todo), flush=True)
    results, failed = {}, 0
    with ThreadPoolExecutor(10) as ex:
        for pid, res in zip(sorted(todo), ex.map(list_figures, sorted(todo))):
            if res is None:
                failed += 1
            elif res[1]:
                results[pid] = res
    print("found figures for", len(results), "| listing failures", failed, flush=True)
    caps_cache = {}
    zc = {}
    def caps(pid):
        if pid in caps_cache:
            return caps_cache[pid]
        row = con.execute("select path from articles where pmcid=?", (pid,)).fetchone()
        out = []
        if row:
            zp, inner = row[0].split(".zip/")
            z = zc.get(zp) or zc.setdefault(zp, zipfile.ZipFile(library / (zp + ".zip")))
            try:
                out = B.figure_captions(z.read(inner).decode("utf-8"))
            except KeyError:
                pass
        caps_cache[pid] = out
        return out
    for p, cs in data.items():
        changed = False
        for c in cs:
            if c.get("figs") or c["id"] not in results:
                continue
            ver, imgs = results[c["id"]]
            imgs = imgs[:12]
            cp = caps(c["id"])
            c["figs"] = {"v": ver, "i": imgs, "c": [x for _, x in cp][:12] if len(cp) == len(imgs) else []}
            changed = True
        if changed:
            p.write_text(json.dumps(cs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for wdir in root.iterdir():
        if not wdir.is_dir():
            continue
        idx = json.loads((wdir / "index.json").read_text(encoding="utf-8"))
        figs = {}
        for p in wdir.glob("[0-9]*.json"):
            for c in data[p]:
                figs[c["id"]] = len(c.get("figs", {}).get("i", []))
        for r in idx:
            r["f"] = figs.get(r["id"], 0)
        (wdir / "index.json").write_text(json.dumps(idx, separators=(",", ":")), encoding="utf-8")
    total = sum(1 for cs in data.values() for c in cs if c.get("figs"))
    print("cases with figures now:", total, flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path)
    main(ap.parse_args().library)
