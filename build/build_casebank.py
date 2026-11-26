"""Build the WardRound case bank from real, CC BY / CC0 PMC Open Access case reports.

Nothing here is generated or paraphrased. Each case is the published article's own "Case presentation"
text, split into sentences and sorted into ward-round stages (presentation, history, examination,
investigations, diagnosis, management, course, outcome) by fixed keyword rules. The same input always
gives the same output. Teaching pearls are the article's own Discussion sentences, verbatim.

Source: PMC Open Access Subset (NIH/NLM). Licence is read per article from PMC metadata; only CC BY and
CC0 are kept (NC excluded so the site may be used freely; SA/ND excluded because staging the text is a
rearrangement). Every case carries its citation, DOI, PMC link and licence.

Usage:  python build_casebank.py --library <path to PMC OA library> --per-ward 300
Output: ../site/data/wards.json and ../site/data/cases/<ward>/{index,0,1,...}.json
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import zipfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "site" / "data"

# ---- wards (MBBS clinical postings + units) -> library domains / title rules ----------------------
ENT_RX = re.compile(r"\b(otitis|tonsil\w*|laryn\w*|pharyn\w*|sinus(itis)?|nasal|nose|epistaxis|cholesteatoma|"
                    r"parotid|ear|hearing|vertigo|mastoid\w*|adenoid\w*|vocal cord|thyroglossal|sinonasal)\b", re.I)
ICU_RX = re.compile(r"\b(intensive care|icu|critical(ly)? (care|ill)|septic shock|sepsis|ards|acute respiratory distress|"
                    r"mechanical ventilation|ventilator|ecmo|extracorporeal|cardiac arrest|multi-?organ (failure|dysfunction)|"
                    r"refractory shock|cardiogenic shock|status epilepticus|resuscitat\w+)\b", re.I)
REHAB_RX = re.compile(r"\b(rehabilitat\w+|physiotherap\w+|physical therap\w+|exercise therap\w+|occupational therap\w+|"
                      r"gait|mobili[sz]ation|functional recovery|sports injur\w+|athlete)\b", re.I)
PHARM_RX = re.compile(r"\b(toxicity|poisoning|overdose|intoxication|adverse (drug )?(reaction|event)|drug[- ]induced|"
                      r"induced by|-induced|drug reaction|dress syndrome|serotonin syndrome|neuroleptic malignant|"
                      r"anaphyla\w+|drug interaction|envenomation|snake ?bite)\b", re.I)
UNIQUE_RX = re.compile(r"\b(rare|first (reported )?(case|report)|unusual|unique|novel|extremely|exceptional|"
                       r"never (been )?reported|unprecedented|atypical|uncommon)\b", re.I)
WARDS = [
    {"id": "medicine", "name": "General Medicine", "domains": ["general_medicine", "cardiology", "respiratory",
     "gastroenterology_hepatology", "nephrology_urology", "endocrinology_metabolism", "infectious_disease",
     "hematology", "immunology_rheumatology"], "blurb": "Cardio, chest, GI, renal, endocrine, infection, blood"},
    {"id": "icu", "name": "ICU & Critical Care", "domains": None, "title_rx": ICU_RX, "blurb": "Shock, sepsis, ventilation, arrest"},
    {"id": "emergency", "name": "Emergency & Casualty", "domains": ["emergency_critical_care"], "blurb": "Triage, trauma, acute presentations"},
    {"id": "surgery", "name": "General Surgery", "domains": ["surgery_anesthesia", "oncology"], "blurb": "Acute abdomen, tumours, post-op care"},
    {"id": "neurology", "name": "Neurology & Neurosurgery", "domains": ["neurology"], "blurb": "Stroke, seizures, spine, nerve, brain"},
    {"id": "obg", "name": "Obstetrics & Gynaecology", "domains": ["obstetrics_gynecology"], "blurb": "Pregnancy, labour, gynae emergencies"},
    {"id": "paeds", "name": "Paediatrics & Neonatology", "domains": ["pediatrics_neonatal"], "blurb": "Newborns to adolescents"},
    {"id": "ortho", "name": "Orthopaedics", "domains": ["musculoskeletal_orthopedics"], "blurb": "Fractures, joints, bone infection"},
    {"id": "rehab", "name": "Physiotherapy & Rehab Centre", "domains": None, "title_rx": REHAB_RX,
     "extra_domains": ["rehabilitation_sports_exercise"], "blurb": "Recovery, function, sports injury, rehab goals"},
    {"id": "pharmacology", "name": "Clinical Pharmacology & Toxicology", "domains": None, "title_rx": PHARM_RX,
     "extra_domains": ["pharmacology"], "blurb": "Adverse reactions, poisoning, interactions"},
    {"id": "psychiatry", "name": "Psychiatry", "domains": ["mental_health"], "blurb": "Mood, psychosis, substance use, risk"},
    {"id": "ent", "name": "ENT", "domains": None, "title_rx": ENT_RX, "blurb": "Ear, nose, throat, head and neck"},
    {"id": "ophthalmology", "name": "Ophthalmology", "domains": ["ophthalmology"], "blurb": "Red eye, vision loss, retina"},
    {"id": "dermatology", "name": "Dermatology", "domains": ["dermatology"], "blurb": "Rashes, lesions, skin signs of disease"},
    {"id": "unique", "name": "Unique & Rare Cases", "domains": None, "title_rx": UNIQUE_RX, "blurb": "First reports and zebras"},
]
MDT_WARD = {"id": "mdt", "name": "Multidisciplinary Ward",
            "blurb": "One patient, many specialists: physician, surgeon, neuro, physio, ICU and more"}

# ---- specialist voices: which team member speaks to which sentence ---------------------------------
SPECIALTIES = {
    "surgeon": r"surg\w+|operat\w+|resect\w+|excis\w+|laparotom\w+|laparoscop\w+|incision|anastomos\w+|debrid\w+|amputat\w+|graft\w*|fixation|arthroplast\w+|craniotom\w+|appendectom\w+|cholecystectom\w+|stoma|drainage",
    "neurologist": r"neurolog\w+|seizure\w*|stroke|hemipares\w+|paralys\w+|numbness|paresthes\w+|aphasi\w+|dysarthri\w+|ataxi\w+|reflex\w*|cranial nerve|gcs|glasgow|consciousness|encephal\w+|mening\w+|neuropath\w+|myelopath\w+|eeg|nerve conduction|spinal cord|cognitive",
    "physiotherapist": r"physiotherap\w+|physical therap\w+|rehabilitat\w+|mobili[sz]\w+|exercise\w*|gait|ambulat\w+|range of motion|strengthening|occupational therap\w+|walking|brace|orthos[ie]s|splint\w*|muscle strength|activities of daily living|wheelchair|functional",
    "intensivist": r"intensive care|icu|ventilat\w+|intubat\w+|vasopressor\w*|noradrenaline|norepinephrine|shock|sepsis|septic|ecmo|dialysis|haemofiltration|hemofiltration|resuscitat\w+|cardiac arrest|cpr|sofa",
    "radiologist": r"x-ray|radiograph\w*|ct|computed tomograph\w*|mri|magnetic resonance|ultraso\w+|sonograph\w*|angiogra\w+|pet|doppler",
    "pathologist": r"biops\w+|histolog\w+|histopatholog\w+|cytolog\w+|immunohisto\w+|patholog\w+|smear|stain\w*|culture\w*",
    "psychiatrist": r"psychiatr\w+|depress\w+|anxiety|psychos[ie]s|psychotic|hallucinat\w+|delusion\w*|suicid\w+|bipolar|schizophren\w+|self-harm",
    "obstetrician": r"pregnan\w+|gestation\w*|trimester|labou?r|caesarean|cesarean|obstetric\w*|fetal|foetal|postpartum|antenatal|uterus|uterine",
    "paediatrician": r"infant\w*|neonat\w+|newborn|toddler|paediatric|pediatric|milestone\w*|preterm",
    "dietitian": r"nutrition\w*|diet\w*|feeding|enteral|parenteral|malnutrition|weight loss|tube feed\w*",
}
SPEC_RX = {k: re.compile(r"\b(" + v + r")\b", re.I) for k, v in SPECIALTIES.items()}
MDT_CORE = {"surgeon", "neurologist", "physiotherapist", "intensivist", "psychiatrist", "obstetrician", "paediatrician", "dietitian"}

# ---- filters --------------------------------------------------------------------------------------
ANIMAL_RX = re.compile(r"\b(calf|calves|cattle|bovine|canine|dog|dogs|cat|cats|feline|horse|equine|mice|mouse|"
                       r"rat|rats|veterinary|cow|cows|pig|pigs|swine|sheep|goat|goats|ovine|porcine|bird|"
                       r"poultry|chicken|monkey|macaque|rabbit|zoo)\b", re.I)
SERIES_RX = re.compile(r"\b(case series|series of|cases|patients|cohort|review of (the )?literature and \d)\b", re.I)
AGE_RX = re.compile(r"\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)[- ](year|month|week|day)s?[- ]old\b", re.I)
CASE_HEAD_RX = re.compile(r"^##+\s*(case (presentation|report|description|history|summary|details)|"
                          r"clinical (case|presentation|history)|presentation of (the )?case|case\s*\d*|"
                          r"patient (presentation|information|description))\s*$", re.I)
DISC_HEAD_RX = re.compile(r"^##\s*(discussion|discussion and conclusions?|conclusions?)\s*$", re.I)

# ---- stage rules (first match wins, in this order) ------------------------------------------------
STAGES = [
    ("outcome", r"\b(discharged|follow[- ]?up|months? later|years? later|weeks? later|at \d+ (months|weeks|years)|"
                r"remain(s|ed)? (asymptomatic|well|free)|recurrence|died|death|passed away|expired|uneventful recovery|"
                r"full recovery|recovered)\b"),
    ("diagnosis", r"\b(diagnosis (of|was)|was diagnosed|were diagnosed|diagnosed (as|with)|final diagnosis|"
                  r"consistent with (a |an )?(diagnosis)?|confirmed (the|a) diagnosis|confirming|histopatholog\w+ "
                  r"(examination )?(revealed|showed|confirmed)|pathology (revealed|showed|confirmed))\b"),
    ("management", r"\b(treated|treatment|was started|were started|initiated|administered|prescribed|"
                   r"underwent|was performed|were performed|surgery|surgical|resection|excision|operation|"
                   r"therapy|mg\b|mg/kg|intravenous|orally|dose|transfusion|antibiotic\w*|ventilat\w+|"
                   r"intubat\w+|embolization|drainage|catheter\w*|laparotomy|laparoscop\w+)\b"),
    ("investigations", r"\b(laborator\w+|blood test|haemoglobin|hemoglobin|white (blood )?cell|platelet|"
                       r"serum|plasma|creatinine|urea|sodium|potassium|glucose|hba1c|crp|c-reactive|esr|"
                       r"culture|pcr|biopsy|x-ray|radiograph\w*|ct\b|computed tomograph\w*|mri\b|magnetic resonance|"
                       r"ultraso\w+|sonograph\w*|echocardiogra\w+|electrocardiogra\w+|ecg|ekg|eeg|endoscop\w+|"
                       r"colonoscop\w+|angiogra\w+|scan|imaging|g/dl|mmol|/μl|/ul|iu/l|u/l|titer|titre|"
                       r"antibod\w+|smear|cytolog\w+|histolog\w+|urinalysis|spirometr\w+|fundus|slit[- ]lamp|"
                       r"visual acuity|audiometr\w+)\b"),
    ("examination", r"\b(examination|on exam\w*|auscultation|palpat\w+|tender\w*|blood pressure|pulse|"
                    r"heart rate|respiratory rate|temperature|febrile|afebrile|saturation|spo2|conscious|"
                    r"gcs|glasgow|oriented|pallor|icterus|jaundice[d]?|cyanosis|clubbing|oedema|edema|"
                    r"lymphadenopathy|murmur|crackles|wheez\w+|bowel sounds|reflex\w*|power|gait|"
                    r"swelling|mass|lesion|rash|erythema|vital signs|bmi|weight of|height of|mental status)\b"),
    ("history", r"\b(history|previous\w*|prior|past|smok\w+|alcohol|medication|taking|family|denied|"
                r"reported|complain\w*|presented|admitted|referred|onset|for (the )?(past|last)|since|"
                r"duration|allerg\w+|occupation|married|gravida|para\b|menstrua\w+|pregnan\w+|"
                r"vaccinat\w+|developmental|birth)\b"),
]
STAGE_RX = [(k, re.compile(v, re.I)) for k, v in STAGES]
COMPLICATION_RX = re.compile(r"\b(develop(ed|s)|deteriorat\w+|worsen\w*|complicat\w+|sudden\w*|unexpected\w*|"
                             r"shock|arrest|sepsis|septic|bleeding|haemorrhage|hemorrhage|failure|"
                             r"respiratory distress|seizure|transferred to (the )?(icu|intensive)|"
                             r"readmitted|relapse\w*|recurr\w+)\b", re.I)
PEARL_RX = re.compile(r"\b(should|must|important|consider\w*|recommend\w*|crucial|essential|key|"
                      r"awareness|aware|pitfall|mimic\w*|differential|lesson|caution|early recognition|"
                      r"prompt)\b", re.I)

ABBR = ["e.g.", "i.e.", "et al.", "Fig.", "Figs.", "Dr.", "vs.", "approx.", "No.", "Mr.", "Mrs.", "Ms.",
        "St.", "Jr.", "ca.", "cf.", "resp.", "min.", "max.", "Ref.", "Tab."]


def clean(text: str) -> str:
    text = re.sub(r"\[\[[^\]]*\]\]", "", text)                       # [[1,2]] citations
    text = re.sub(r"\[(\d+(?:[,–-]\d+)*)\]", "", text)               # [6,7] citations
    text = re.sub(r"\((?:see )?(?:Figs?\.|Figure|Table|Supplementary)[^)]*\)", "", text, flags=re.I)
    text = re.sub(r"\*\*|__", "", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def sentences(par: str) -> list[str]:
    protected = par
    for i, a in enumerate(ABBR):
        protected = protected.replace(a, a.replace(".", f"\u0000{i}\u0000"))
    protected = re.sub(r"(\d)\.(\d)", "\\1\u0001\\2", protected)
    protected = re.sub(r"\b([A-Z])\.(?=\s*[A-Z]\.|\s+[A-Z][a-z])", "\\1\u0001", protected)  # initials: U.S., J. Smith
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])", protected)
    out = []
    for p in parts:
        p = p.replace("\u0001", ".")
        p = re.sub(r"\u0000\d+\u0000", ".", p)
        p = p.strip()
        if len(p) >= 15:
            out.append(p)
    return out


HISTORY_FIRST_RX = re.compile(r"\b(known case of|history of|(home )?medications? (included|were|was)|previously (diagnosed|treated)|"
                              r"had (been )?(diagnosed|treated|managed|given|on)\b|past medical|had not taken|prior to (her|his|the) (referral|admission|presentation)|"
                              r"no (significant|relevant|other) (past|medical|family|known)|was on (long[- ]term )?\w+ for|had no history)\b", re.I)
RESULT_RX = re.compile(r"\b(revealed|showed|demonstrated|found to be|levels?|count|positive|negative|"
                       r"normal range|within normal|elevated|raised|decreased|low|high)\b", re.I)

# Section headings inside the case tell us the stage directly (more reliable than keywords).
HEAD_STAGE = [
    ("ddx", re.compile(r"differential", re.I)),
    ("examination", re.compile(r"(physical|clinical) (exam|finding)|examination|on admission findings|clinical findings", re.I)),
    ("investigations", re.compile(r"investigation|laborator|imaging|radiolog|work-?up|diagnostic (assess|test|evaluat|stud|find)|"
                                  r"patholog|histolog|test results|findings", re.I)),
    ("diagnosis", re.compile(r"diagnos", re.I)),
    ("management", re.compile(r"treatment|management|therap|intervention|surg|operati|procedure|hospital course|clinical course", re.I)),
    ("outcome", re.compile(r"outcome|follow|progress|prognos|discharge", re.I)),
]
STOP_HEAD_RX = re.compile(r"^##\s*(discussion|conclusion|references|acknowledg|declaration|funding|consent|author|abbreviation|"
                          r"competing|conflict|ethic|availability|supplementary|data availability|patient.?s perspective|"
                          r"literature review|review of (the )?literature|background|introduction|summary|footnotes|notes)", re.I)
PEARL_HEAD_RX = re.compile(r"^##+\s*(learning points?|key (messages?|points?|learning)|take[- ]home|lessons?( learned)?|"
                           r"what (this|we) (case|learned)|teaching points?|clinical (pearls?|relevance|message))", re.I)


LAB_TABLE_RX = re.compile(r"laborator|blood|biochem|haematolog|hematolog|serum|investigation|chemistry|lab |values|"
                          r"urinalysis|csf|parameters|test results|arterial gas", re.I)


def head_stage(heading: str) -> str | None:
    h = heading.lstrip("#").strip()
    for k, rx in HEAD_STAGE:
        if rx.search(h):
            return k
    return None


def classify(s: str, idx: int, n: int, hstage: str | None) -> str:
    if idx == 0:
        return "presentation"
    if hstage in ("examination", "investigations", "diagnosis", "management"):
        return hstage
    if idx < n * 0.5 and hstage is None and HISTORY_FIRST_RX.search(s):
        return "history"
    for k, rx in STAGE_RX:
        if rx.search(s):
            if hstage == "outcome" and k in ("history", "examination"):
                return "outcome"
            return k
    if hstage == "outcome":
        return "outcome"
    if RESULT_RX.search(s):
        return "investigations"
    return "history" if idx < 4 else "course"


def parse_article(md: str) -> dict | None:
    lines = md.splitlines()
    case_pars: list[tuple[str | None, str]] = []
    disc_pars, pearl_pars, tables = [], [], []
    mode = None
    hstage = None
    seen_case = False
    lab_title = False
    cur_table: list[str] = []
    for ln in lines:
        if ln.startswith("## ") or ln.startswith("### ") or ln.startswith("#### "):
            if cur_table:
                tables.append(cur_table); cur_table = []
            top = ln.startswith("## ")
            if PEARL_HEAD_RX.match(ln):
                mode = "pearl"; continue
            if top and CASE_HEAD_RX.match(ln) and not seen_case:
                mode = "case"; seen_case = True; hstage = None; continue
            if top and DISC_HEAD_RX.match(ln):
                mode = "disc"; continue
            if top and re.match(r"^##\s*tables\s*$", ln, re.I):
                mode = "tables"; continue
            if mode == "tables" and not top:
                lab_title = bool(LAB_TABLE_RX.search(ln)); continue
            if mode == "case":
                if top and STOP_HEAD_RX.match(ln):
                    mode = None; continue
                hs = head_stage(ln)
                hstage = hs if hs else (None if top else hstage)
                continue
            if top:
                mode = None
            continue
        if mode is None:
            continue
        if ln.startswith("*[") or ln.startswith("!["):               # figure captions / images
            continue
        if ln.startswith("|"):
            if mode == "case" or (mode == "tables" and lab_title):
                cur_table.append(ln)
            continue
        if mode == "tables":
            continue
        if cur_table:
            tables.append(cur_table); cur_table = []
        t = ln.strip().lstrip("-*• ").strip()
        if not t:
            continue
        if mode == "case":
            case_pars.append((hstage, clean(t)))
        elif mode == "disc":
            disc_pars.append(clean(t))
        else:
            pearl_pars.append(clean(t))
    if cur_table:
        tables.append(cur_table)
    sents = [(h, x) for h, p in case_pars for x in sentences(p)]
    ddx = [x for h, x in sents if h == "ddx"][:12]
    sents = [(h, x) for h, x in sents if h != "ddx"]
    if not (8 <= len(sents) <= 120):
        return None
    if not AGE_RX.search(" ".join(x for _, x in sents[:3])):
        return None
    staged = []
    for i, (h, x) in enumerate(sents):
        st = classify(x, i, len(sents), h)
        ev = {"t": x, "s": st}
        if h:
            ev["h"] = 1                                              # stage came from a section heading
        if st in ("course", "management", "outcome") and COMPLICATION_RX.search(x) and i > 2:
            ev["c"] = 1                                              # complication event
        staged.append(ev)
    stages = {e["s"] for e in staged}
    if not {"investigations", "management"} <= stages:
        return None
    # Work-up / ward-round split. Prefer a treatment-section heading; else the first diagnosis or treatment
    # sentence after investigations begin. Before it = what the student uncovers; from it on = the admission course.
    fi = next(i for i, e in enumerate(staged) if e["s"] == "investigations")
    split = next((i for i, e in enumerate(staged) if e.get("h") and e["s"] in ("management", "diagnosis") and i > 2), None)
    if split is None:
        split = next((i for i, e in enumerate(staged) if i > max(fi, 2) and e["s"] in ("management", "diagnosis")), None)
    if split is None or split < 3 or len(staged) - split < 2:
        return None
    pearls = [x for p in pearl_pars for x in sentences(p) if 25 <= len(x) <= 400][:6]
    if len(pearls) < 3:
        for p in disc_pars:
            for x in sentences(p):
                if PEARL_RX.search(x) and 40 <= len(x) <= 400 and x not in pearls:
                    pearls.append(x)
                if len(pearls) >= 5:
                    break
            if len(pearls) >= 5:
                break
    lab_tables = []
    for tb in tables[:2]:
        rows = [[c.strip() for c in r.strip("|").split("|")] for r in tb if not re.match(r"^\|\s*:?-{2,}", r)]
        if 2 <= len(rows) <= 40:
            lab_tables.append(rows)
    return {"events": staged, "split": split, "ddx": ddx, "pearls": pearls, "tables": lab_tables}


def meta_from(md: str) -> dict:
    m = {}
    for key in ("pmcid", "pmid", "doi", "title", "journal", "year", "license"):
        r = re.search(rf"^{key}: (.*)$", md, re.M)
        if r:
            m[key] = r.group(1).strip().strip("'\"")
    r = re.search(r"\| Citation \| (.*?) \|", md)
    m["citation"] = r.group(1).strip() if r else ""
    r = re.search(r"^\*\*Authors:\*\* (.*)$", md, re.M)
    authors = [a.strip() for a in r.group(1).split(",")] if r else []
    m["authors"] = (", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")) if authors else ""
    return m


def demographics(first: str) -> dict:
    age = AGE_RX.search(first)
    sex = None
    if re.search(r"\b(woman|female|girl|lady|mother|she)\b", first, re.I):
        sex = "F"
    elif re.search(r"\b(man|male|boy|gentleman|he)\b", first, re.I):
        sex = "M"
    return {"age": age.group(0) if age else "", "sex": sex}


FIG_CAP_RX = re.compile(r"^- \*\*(Fig(?:ure)?\.?\s*\d+[A-Za-z]?)[:.]?\*\*:?\s*(.*)$", re.I | re.M)
IMG_EXT = (".jpg", ".jpeg", ".png")
S3 = "https://pmc-oa-opendata.s3.amazonaws.com"


def figure_captions(md: str) -> list[tuple[str, str]]:
    sect = md.split("## Figure captions", 1)
    if len(sect) < 2:
        return []
    body = re.split(r"\n## ", sect[1], 1)[0]
    return [(m.group(1), clean(m.group(2))[:400]) for m in FIG_CAP_RX.finditer(body)]


def natkey(k: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", k.lower())]


def list_figures(pmcid: str):
    """Image files for one article in the PMC Open Access cloud bucket (public, no key)."""
    import urllib.request
    url = f"{S3}/?list-type=2&prefix={pmcid}.&max-keys=200"
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                xml = r.read().decode("utf-8", "replace")
            keys = re.findall(r"<Key>([^<]+)</Key>", xml)
            if not keys:
                return None
            ver = sorted({k.split("/")[0] for k in keys}, key=natkey)[-1]      # latest version folder
            imgs = sorted([k.split("/", 1)[1] for k in keys if k.startswith(ver + "/") and k.lower().endswith(IMG_EXT)
                           and not re.search(r"(thumb|icon|logo)", k, re.I)], key=natkey)
            return ver, imgs
        except Exception:
            continue
    return None


def tag_specialties(case: dict) -> None:
    sps = defaultdict(int)
    for e in case["events"]:
        hits = [k for k, rx in SPEC_RX.items() if rx.search(e["t"])]
        if hits:
            e["sp"] = hits
            for h in hits:
                sps[h] += 1
    case["sps"] = sorted(sps, key=lambda k: -sps[k])


def write_ward(wid: str, cases: list, shard: int) -> list:
    d = OUT / "cases" / wid
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob("*.json"):
        old.unlink()
    index = []
    for k in range(0, len(cases), shard):
        chunk = cases[k:k + shard]
        (d / f"{k // shard}.json").write_text(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        for c in chunk:
            index.append({"id": c["id"], "k": k // shard, "age": c["age"], "sex": c["sex"], "t": int(c["tricky"]),
                          "sp": c["sps"][:6], "f": len(c.get("figs", {}).get("i", [])), "sub": c["sub"]})
    (d / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    return index


def build(library: Path, per_ward: int, min_year: str, shard: int, figures: bool) -> None:
    from concurrent.futures import ThreadPoolExecutor
    con = sqlite3.connect(library / "index.sqlite3")
    base = ("select pmcid, title, path, domain from articles where article_type='case-report' "
            "and license_code in ('CC BY','CC0') and g6='pass' and year >= ? ")
    (OUT / "cases").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "cases").glob("*.json"):
        old.unlink()                                                     # v0.1 single-file wards
    every = con.execute(base + "order by substr(xml_sha256,1,12)", [min_year]).fetchall()
    used = set()
    ward_index, all_cases = [], []
    total = 0
    for w in WARDS:
        if w["domains"]:
            doms = set(w["domains"])
            rows = [r for r in every if r[3] in doms]
        else:
            extra = set(w.get("extra_domains", []))
            rows = [r for r in every if r[3] in extra or w["title_rx"].search(r[1] or "")]
        rows = [r for r in rows if r[0] not in used and not ANIMAL_RX.search(r[1] or "")
                and not SERIES_RX.search(r[1] or "")]
        by_dom = defaultdict(list)                                       # round-robin across subspecialties
        for r in rows:
            by_dom[r[3]].append(r)
        order = []
        while any(by_dom.values()):
            for d in list(by_dom):
                if by_dom[d]:
                    order.append(by_dom[d].pop(0))
        cases, tried = [], 0
        zcache = {}
        for pmcid, title, path, domain in order:
            if len(cases) >= per_ward:
                break
            tried += 1
            zpath, inner = path.split(".zip/")
            zf = zcache.get(zpath)
            if zf is None:
                if len(zcache) > 40:
                    for z in zcache.values():
                        z.close()
                    zcache.clear()
                zf = zcache[zpath] = zipfile.ZipFile(library / (zpath + ".zip"))
            try:
                md = zf.read(inner).decode("utf-8")
            except KeyError:
                continue
            if ANIMAL_RX.search(md[:6000].split("## Case", 1)[-1][:1500]):
                continue
            parsed = parse_article(md)
            if not parsed:
                continue
            meta = meta_from(md)
            if meta.get("license") not in ("CC BY", "CC0"):
                continue
            first = parsed["events"][0]["t"]
            n_c = sum(1 for e in parsed["events"] if e.get("c"))
            tricky = bool(UNIQUE_RX.search(title or "") or re.search(r"\b(mimick\w*|masquerad\w+|misdiagnos\w+|"
                          r"unexpected|challeng\w+|pitfall)\b", title or "", re.I)) or n_c >= 2
            c = {"id": pmcid, "ward": w["id"], "sub": domain, **demographics(" ".join(e["t"] for e in parsed["events"][:3])),
                 "tricky": tricky, "nc": n_c, "complaint": first, **parsed, "src": meta, "_caps": figure_captions(md)}
            tag_specialties(c)
            cases.append(c)
            used.add(pmcid)
        for z in zcache.values():
            z.close()
        all_cases.extend(cases)
        print(f"{w['id']:14s} kept {len(cases):5d} of {tried:6d} read ({len(rows)} candidates)", flush=True)

    if figures:
        print("listing figures in the PMC OA cloud bucket ...", flush=True)
        with ThreadPoolExecutor(24) as ex:
            for c, res in zip(all_cases, ex.map(lambda c: list_figures(c["id"]), all_cases)):
                caps = c.pop("_caps")
                if not res or not res[1]:
                    continue
                ver, imgs = res
                imgs = imgs[:12]
                paired = len(caps) == len(imgs)
                c["figs"] = {"v": ver, "i": imgs, "c": [cp for _, cp in caps][:12] if paired else []}
        print("cases with figures:", sum(1 for c in all_cases if c.get("figs")), flush=True)
    for c in all_cases:
        c.pop("_caps", None)

    by_ward = defaultdict(list)
    for c in all_cases:
        by_ward[c["ward"]].append(c)
    for w in WARDS:
        cs = by_ward[w["id"]]
        write_ward(w["id"], cs, shard)
        ward_index.append({"id": w["id"], "name": w["name"], "blurb": w["blurb"], "count": len(cs),
                           "shards": (len(cs) + shard - 1) // shard, "subs": sorted({c["sub"] for c in cs})})
        total += len(cs)
    # multidisciplinary collection: cases where 3+ core specialties have something to say
    mdt = [dict(c, home=c["ward"], ward="mdt") for c in all_cases if len(MDT_CORE & set(c["sps"])) >= 3]
    rr = defaultdict(list)
    for c in mdt:
        rr[c["home"]].append(c)
    mdt_sorted = []
    while any(rr.values()) and len(mdt_sorted) < per_ward:
        for k in list(rr):
            if rr[k] and len(mdt_sorted) < per_ward:
                mdt_sorted.append(rr[k].pop(0))
    write_ward("mdt", mdt_sorted, shard)
    ward_index.insert(0, {"id": "mdt", "name": MDT_WARD["name"], "blurb": MDT_WARD["blurb"], "count": len(mdt_sorted),
                          "shards": (len(mdt_sorted) + shard - 1) // shard, "collection": True,
                          "subs": sorted({c["home"] for c in mdt_sorted})})
    (OUT / "wards.json").write_text(json.dumps({"wards": ward_index, "total": total, "shard": shard,
        "source": "PMC Open Access Subset (NIH/NLM), CC BY / CC0 case reports, verbatim",
        "figures": "PMC Open Access cloud bucket (pmc-oa-opendata, AWS Open Data)",
        "min_year": min_year}, indent=1), encoding="utf-8")
    print("total", total, "| multidisciplinary", len(mdt_sorted))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path, help="folder holding index.sqlite3 and the <domain>/<design>/<year>.zip files")
    ap.add_argument("--per-ward", type=int, default=1000)
    ap.add_argument("--min-year", default="2012")
    ap.add_argument("--shard", type=int, default=100)
    ap.add_argument("--no-figures", action="store_true")
    a = ap.parse_args()
    build(a.library, a.per_ward, a.min_year, a.shard, not a.no_figures)
