"""Pharmacist drug cards for MediORounds, from official US drug labels (openFDA, public domain).

For every medicine named in the case bank, keep one current human prescription label and quote, verbatim and
shortened to the first sentences: pharmacologic class, mechanism of action, indications, boxed warning,
contraindications, most common adverse reactions, drug interactions, and pregnancy. Nothing is paraphrased.
Each card links to the label on DailyMed (by set id).

Step 1 (slow, streams the bulk label dump with low memory):  --labels <openfda label zip folder> --dosing <label_dosing.sqlite>
Step 2 (fast): keep only drugs that appear in site/data/cases and write site/data/drugs.json
"""
from __future__ import annotations

import argparse
import glob
import io
import json
import re
import sqlite3
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "site" / "data"
CACHE = HERE / "drug_cards_all.json"           # git-ignored intermediate

FIELDS = {
    "mech": ("mechanism_of_action", r"mechanism of action", 2),
    "ind": ("indications_and_usage", r"indications (and|&) usage", 2),
    "box": ("boxed_warning", r"(boxed warning:?\s*)?", 2),
    "ci": ("contraindications", r"contraindications", 2),
    "ae": ("adverse_reactions", r"adverse reactions", 2),
    "ddi": ("drug_interactions", r"drug interactions", 2),
    "preg": ("pregnancy", r"(8\.1 )?pregnancy( risk summary)?", 1),
}
ABBR = ["e.g.", "i.e.", "et al.", "vs.", "approx.", "No.", "Fig.", "mL.", "U.S."]


def sentences(text: str) -> list[str]:
    t = text
    for i, a in enumerate(ABBR):
        t = t.replace(a, a.replace(".", f"\u0000{i}\u0000"))
    t = re.sub(r"(\d)\.(\d)", "\\1\u0001\\2", t)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z(])", t)
    out = []
    for p in parts:
        p = re.sub(r"\u0000\d+\u0000", ".", p.replace("\u0001", ".")).strip()
        if len(p) > 12:
            out.append(p)
    return out


def clean_section(raw: str, head: str) -> str:
    t = re.sub(r"\s+", " ", raw).strip()
    t = re.sub(r"\(\s*\d+(\.\d+)*\s*(,\s*\d+(\.\d+)*\s*)*\)", "", t)                  # ( 2.1 ) cross refs
    t = re.sub(rf"^\s*(\d+(\.\d+)*\s*)?{head}\s*:?\s*", "", t, flags=re.I)
    t = re.sub(r"^\s*\d+(\.\d+)*\s+", "", t)
    t = re.sub(r"\[\s*see [^\]]*\]", "", t, flags=re.I)                               # [see Warnings (5.1)]
    t = re.sub(r"\s+([,.;:])", r"\1", re.sub(r"\s{2,}", " ", t))
    return t.strip()


def first(text: str, n: int, prefer: str | None = None) -> str:
    ss = sentences(text)
    if prefer:
        hit = [s for s in ss if re.search(prefer, s, re.I)]
        if hit:
            ss = hit
    out = " ".join(ss[:n])
    return (out[:600] + "…") if len(out) > 600 else out


def stream_results(zpath: str):
    """Yield label records from one openFDA bulk zip without loading the whole JSON."""
    dec = json.JSONDecoder()
    with zipfile.ZipFile(zpath) as z:
        with z.open(z.namelist()[0]) as fh:
            txt = io.TextIOWrapper(fh, encoding="utf-8")
            buf = ""
            while '"results"' not in buf:
                chunk = txt.read(1 << 20)
                if not chunk:
                    return
                buf += chunk
            buf = buf[buf.index("[", buf.index('"results"')) + 1:]
            eof = False
            while True:
                buf = buf.lstrip().lstrip(",").lstrip()
                if buf.startswith("]"):
                    return
                try:
                    obj, end = dec.raw_decode(buf)
                except json.JSONDecodeError:
                    if eof:
                        return
                    chunk = txt.read(1 << 22)
                    if not chunk:
                        eof = True
                    buf += chunk
                    continue
                yield obj
                buf = buf[end:]


def step1(labels: Path, dosing: Path) -> None:
    con = sqlite3.connect(dosing)
    best: dict[str, tuple[str, str]] = {}
    for set_id, eff, base, ptype, subst in con.execute(
            "select set_id, effective_time, base, product_type, substance from label"):
        if not base or ptype != "HUMAN PRESCRIPTION DRUG" or (subst and "," in subst):
            continue
        b = base.strip().lower()
        if b not in best or (eff or "") > best[b][1]:
            best[b] = (set_id, eff or "")
    want = {sid: b for b, (sid, _) in best.items()}
    print("bases", len(best), flush=True)
    cards: dict[str, dict] = {}
    for zp in sorted(glob.glob(str(labels / "drug-label-*.json.zip"))):
        n = 0
        for r in stream_results(zp):
            sid = r.get("set_id")
            b = want.get(sid)
            if not b:
                continue
            of = r.get("openfda", {})
            card = {"n": b, "sid": sid, "eff": r.get("effective_time", ""),
                    "brand": (of.get("brand_name") or [""])[0], "route": (of.get("route") or [""])[0].lower(),
                    "cls": [c.replace(" [EPC]", "") for c in of.get("pharm_class_epc", [])][:3],
                    "moa": [c.replace(" [MoA]", "") for c in of.get("pharm_class_moa", [])][:3]}
            for key, (field, head, k) in FIELDS.items():
                v = r.get(field)
                if not v:
                    continue
                txt = clean_section(" ".join(v), head)
                if txt:
                    card[key] = first(txt, k, r"most common" if key == "ae" else None)
            cards[b] = card
            n += 1
        print(Path(zp).name, "cards", n, "total", len(cards), flush=True)
    CACHE.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")


# Label "base names" that are everyday words in case text, not a medicine the student should learn as one.
NOT_A_DRUG = {"vitamin", "alcohol", "oxygen", "water", "sodium", "potassium", "calcium", "iron", "glucose", "dextrose",
              "magnesium", "zinc", "nitrogen", "air", "saline", "sugar", "oil", "talc", "honey", "sulfur", "copper",
              "carbon dioxide", "helium", "barium", "iodine", "gold", "silver", "lead", "salt", "ethanol", "urea",
              "albumin", "protein", "collagen", "hydrogen peroxide", "petrolatum", "menthol", "camphor", "lactose"}
ROUTE_WORDS = {"oral", "injection", "topical", "ophthalmic", "nasal", "rectal", "vaginal", "transdermal", "inhalation",
               "intravenous", "otic", "kit", "tablets", "capsules", "solution", "suspension", "cream", "gel"}


def step2(aliases: Path | None) -> None:
    cards = json.loads(CACHE.read_text(encoding="utf-8"))
    alias = {}
    if aliases and aliases.exists():
        alias = json.loads(aliases.read_text(encoding="utf-8")).get("aliases", {})
    # common international names used in Indian/UK case reports
    alias.update({"paracetamol": "acetaminophen", "salbutamol": "albuterol", "adrenaline": "epinephrine",
                  "noradrenaline": "norepinephrine", "frusemide": "furosemide", "glibenclamide": "glyburide",
                  "rifampicin": "rifampin", "lignocaine": "lidocaine", "pethidine": "meperidine",
                  "co-trimoxazole": "sulfamethoxazole", "cotrimoxazole": "sulfamethoxazole", "ciclosporin": "cyclosporine",
                  "aciclovir": "acyclovir", "amoxycillin": "amoxicillin", "cephalexin": "cephalexin",
                  "thyroxine": "levothyroxine", "levetiracetam": "levetiracetam", "mesalazine": "mesalamine",
                  "bendroflumethiazide": "bendroflumethiazide", "sodium valproate": "valproic acid", "valproate": "valproic acid"})
    alias = {k: v for k, v in alias.items() if v in cards and k != v}
    grams = set()                                    # every 1-4 word sequence in the case bank
    for f in glob.glob(str(SITE / "cases" / "*" / "[0-9]*.json")):
        for c in json.loads(Path(f).read_text(encoding="utf-8")):
            for e in c["events"]:
                w = re.findall(r"[a-z][a-z0-9-]*", e["t"].lower())
                for n in range(1, 5):
                    for i in range(len(w) - n + 1):
                        grams.add(" ".join(w[i:i + n]))
    names = sorted(set(cards) | set(alias), key=len, reverse=True)
    keep, used_alias = {}, {}
    for nm in names:
        if len(nm) < 4 or not re.search(r"[a-z]", nm):
            continue
        target = alias.get(nm, nm)
        if nm in NOT_A_DRUG or target in NOT_A_DRUG or nm.split()[-1] in ROUTE_WORDS or target.split()[-1] in ROUTE_WORDS:
            continue
        if " ".join(re.findall(r"[a-z][a-z0-9-]*", nm)) in grams:
            if target in cards:
                keep[target] = cards[target]
                if nm != target:
                    used_alias[nm] = target
    out = {"source": "openFDA drug label bulk data (US FDA, public domain); text quoted verbatim, first sentences only",
           "aliases": used_alias, "cards": keep}
    (SITE / "drugs.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("drug cards kept", len(keep), "aliases", len(used_alias))


# ---------------- dose check data (from the label's DOSAGE AND ADMINISTRATION section) ----------------
DOSE_RX = re.compile(r"(\d+(?:\.\d+)?)(?:\s*(?:to|-|–|or)\s*(\d+(?:\.\d+)?))?\s*"
                     r"(mg|g|gram|grams|milligrams?|mcg|µg|micrograms?|units?|IU|mL|mEq|mmol)\b"
                     r"(?:\s*/\s*(kg|m2|m\^2|m²))?", re.I)


def dose_key(unit: str, per: str | None):
    u = unit.lower()
    factor, base = 1.0, u
    if u in ("g", "gram", "grams"):
        factor, base = 1000.0, "mg"
    elif u in ("mg", "milligram", "milligrams"):
        base = "mg"
    elif u in ("mcg", "µg", "microgram", "micrograms"):
        factor, base = 0.001, "mg"
    elif u in ("unit", "units", "iu"):
        base = "units"
    elif u == "ml":
        base = "mL"
    elif u == "meq":
        base = "mEq"
    if per:
        p = per.lower().replace("^", "").replace("²", "2")
        base += "/" + ("kg" if p == "kg" else "m2")
    return factor, base


def label_doses(da: str) -> list:
    out = set()
    for m in DOSE_RX.finditer(da):
        f, key = dose_key(m.group(3), m.group(4))
        lo = float(m.group(1)) * f
        hi = float(m.group(2)) * f if m.group(2) else lo
        if hi < lo:
            lo, hi = hi, lo
        out.add((round(lo, 4), round(hi, 4), key))
    return sorted(out)[:80]


def step_dose(dosing: Path) -> None:
    path = SITE / "drugs.json"
    d = json.loads(path.read_text(encoding="utf-8"))
    con = sqlite3.connect(dosing)
    n = 0
    for name, card in d["cards"].items():
        row = con.execute("select da from label where set_id=?", (card["sid"],)).fetchone()
        if not row or not row[0]:
            row = con.execute("select da from label where base=? and product_type='HUMAN PRESCRIPTION DRUG' and da<>'' "
                              "order by effective_time desc limit 1", (name,)).fetchone()
        if not row or not row[0]:
            continue
        da = clean_section(row[0], r"dosage (and|&) administration")
        doses = label_doses(da)
        if not doses:
            continue
        # verbatim excerpt: first sentences that state an amount, preferring adult / usual dosing
        ss = [s for s in sentences(da) if DOSE_RX.search(s)]
        pref = [s for s in ss if re.search(r"\b(adult|usual|recommended)\b", s, re.I)] or ss
        card["dose"] = (" ".join(pref[:2]))[:500]
        card["dn"] = [[lo, hi, k] for lo, hi, k in doses]
        n += 1
    path.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("cards with dose data", n, "of", len(d["cards"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", type=Path)
    ap.add_argument("--dosing", type=Path)
    ap.add_argument("--aliases", type=Path)
    ap.add_argument("--step", choices=["1", "2", "both", "dose"], default="both")
    a = ap.parse_args()
    if a.step in ("1", "both"):
        step1(a.labels, a.dosing)
    if a.step in ("2", "both"):
        step2(a.aliases)
    if a.step in ("2", "both", "dose"):
        step_dose(a.dosing or Path(r"label_dosing.sqlite"))
