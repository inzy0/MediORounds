// Teaching layer: objectives, who speaks each sentence, quiz with correction, reflection check, team questions.
// Deterministic: everything is derived from the case's own text (or other real cases); seeded by case id.
import { terms, INV } from "./engine.js";

export const TEAM = {
  senior: { label: "Senior Resident", short: "SR", color: "#3d63f5" },
  hod: { label: "HOD · Consultant", short: "HOD", color: "#7a3cff" },
  patient: { label: "Patient · case record", short: "Pat", color: "#0b84a5" },
  nurse: { label: "Ward Nurse / Lab", short: "RN", color: "#1a9b6c" },
  record: { label: "Case record", short: "Rx", color: "#9a6b00" },
  surgeon: { label: "Surgeon", short: "Sx", color: "#c2410c" },
  neurologist: { label: "Neurologist", short: "Neu", color: "#7c3aed" },
  physiotherapist: { label: "Physiotherapist", short: "PT", color: "#0d9488" },
  intensivist: { label: "Intensivist (ICU)", short: "ICU", color: "#be123c" },
  radiologist: { label: "Radiologist", short: "Rad", color: "#475569" },
  pathologist: { label: "Pathologist", short: "Path", color: "#a21caf" },
  psychiatrist: { label: "Psychiatrist", short: "Psy", color: "#4f46e5" },
  obstetrician: { label: "Obstetrician", short: "OB", color: "#db2777" },
  paediatrician: { label: "Paediatrician", short: "Ped", color: "#2563eb" },
  dietitian: { label: "Dietitian", short: "Diet", color: "#65a30d" },
  pharmacist: { label: "Clinical Pharmacist", short: "Ph", color: "#0891b2" },
  peer: { label: "Classmate", short: "You2", color: "#ea580c" },
  you: { label: "You", short: "You", color: "#3d63f5" },
};
export const SPEAKERS = ["surgeon", "neurologist", "intensivist", "physiotherapist", "obstetrician", "paediatrician",
  "psychiatrist", "dietitian", "radiologist", "pathologist"];

// Fixed teaching questions each specialist asks in the multidisciplinary review (no clinical facts in them)
export const TEAM_Q = {
  surgeon: "From the surgical side: was an operation or procedure needed here, and what would make you call the surgeon early?",
  neurologist: "Neurology view: which findings localise the problem, and what would you examine again tomorrow?",
  physiotherapist: "Rehab view: what are this patient's functional goals, and when would you start mobilising?",
  intensivist: "ICU view: what are the red flags that would make you escalate to critical care?",
  radiologist: "Imaging view: which test was most informative, and why that one first?",
  pathologist: "Pathology view: which sample clinched the diagnosis, and how should it be sent?",
  psychiatrist: "Mental health view: what psychological or risk issues need attention in this patient?",
  obstetrician: "Obstetric view: how does pregnancy change the plan for both mother and baby?",
  paediatrician: "Paediatric view: what changes because this patient is a child?",
  dietitian: "Nutrition view: how would you assess and support this patient's nutrition?",
  pharmacist: "Pharmacy view: name one adverse effect or interaction you would monitor for with these medicines.",
};

// Peer ideas (shown by the classmate when the student is quiet or stuck). Generic clinical-method prompts only.
export const PEER_IDEAS = [
  "Have you asked when it started and how it has changed since?", "What about past illnesses and operations?",
  "Did you ask which medicines the patient takes, and any allergies?", "Family history might matter here. Did you ask?",
  "Shall we check the vitals first?", "Should we examine the system that matches the complaint?",
  "Which single test would change your management most?", "What are your top three differentials?",
  "What is the one thing that could kill this patient in the next 24 hours?", "Is there any red flag we are missing?",
];

let seedState = 1;
function seeded(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } seedState = h >>> 0 || 1; }
function rnd() { seedState ^= seedState << 13; seedState ^= seedState >>> 17; seedState ^= seedState << 5; return ((seedState >>> 0) % 100000) / 100000; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

export function speakerFor(e, phase) {
  const sp = (e.sp || []).filter(s => SPEAKERS.includes(s));
  if (phase === "work") {
    if (e.s === "investigations") return sp.includes("radiologist") ? "radiologist" : sp.includes("pathologist") ? "pathologist" : "nurse";
    if (e.s === "examination") return "nurse";
    return "patient";
  }
  const clinical = sp.filter(s => s !== "radiologist" && s !== "pathologist");
  return clinical[0] || sp[0] || "record";
}

export function objectives(sess) {
  const c = sess.c, out = [];
  out.push("Take a focused history and pick out the key presenting features.");
  if (sess.examTotal) out.push("Examine the right systems and recognise the abnormal signs.");
  const cats = [...sess.invCats].slice(0, 3);
  if (cats.length) out.push(`Choose and interpret investigations (this case used: ${cats.join(", ")}).`);
  out.push("Commit to a diagnosis and defend it against the differentials.");
  out.push("Plan management, including the medicines and how you would monitor them.");
  if (c.nc) out.push(`Recognise and respond to ${c.nc > 1 ? c.nc + " changes" : "a change"} in the patient's course.`);
  const team = (c.sps || []).filter(s => SPEAKERS.includes(s) && s !== "radiologist" && s !== "pathologist");
  if (team.length >= 2) out.push(`Think as a team: ${team.slice(0, 4).map(s => TEAM[s].label.toLowerCase()).join(", ")}.`);
  return out;
}

// ---------------- quiz (multiple choice, verbatim stems, exact answers) ----------------
const TEST_TERMS = ["CT", "MRI", "ultrasound", "X-ray", "biopsy", "echocardiography", "ECG", "culture", "endoscopy",
  "angiography", "EEG", "colonoscopy", "bronchoscopy", "PET", "lumbar puncture", "Doppler"];

function maskSentence(s, term) {
  const rx = new RegExp(`(?<![A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i");
  const m = s.match(rx);
  return m ? s.replace(rx, "_____") : null;
}

export function buildQuiz(sess, drugs, otherTitles) {
  const c = sess.c; seeded(c.id);
  const qs = [], usedSrc = new Set();               // one question per source sentence, so answers don't leak
  // 1) final diagnosis, against real titles of other cases in the same ward
  const others = shuffle(otherTitles.filter(t => t && t !== c.src.title)).slice(0, 3);
  if (others.length === 3) qs.push({ kind: "dx", stem: "Which of these was the published diagnosis for this patient?", answer: c.src.title,
    options: shuffle([c.src.title, ...others]), src: c.src.title });
  // 2) medicines named in the case
  if (drugs) {
    const names = Object.keys(drugs.cards);
    const alias = drugs.aliases || {};
    const found = [];
    for (const e of sess.ev) {
      const low = e.t.toLowerCase();
      for (const nm of [...names, ...Object.keys(alias)]) {
        if (nm.length < 5) continue;
        if (new RegExp(`(?<![a-z])${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(low)) found.push({ e, nm });
      }
    }
    const seen = new Set();
    for (const { e, nm } of shuffle(found)) {
      if (seen.has(nm) || usedSrc.has(e.i) || qs.filter(q => q.kind === "drug").length >= 2) continue;
      const stem = maskSentence(e.t, nm); if (!stem) continue;
      seen.add(nm); usedSrc.add(e.i);
      const pool = shuffle(names.filter(n => n !== nm && n !== alias[nm] && !stem.toLowerCase().includes(n))).slice(0, 3);
      if (pool.length < 3) continue;
      qs.push({ kind: "drug", stem: "Fill the gap (from the case): " + stem, answer: nm, options: shuffle([nm, ...pool]), src: e.t });
    }
  }
  // 3) one investigation
  const tests = [];
  for (const e of sess.ev) { if (usedSrc.has(e.i)) continue; for (const t of TEST_TERMS) { const st = maskSentence(e.t, t); if (st) tests.push({ e, t, st }); } }
  if (tests.length) {
    const pick = shuffle(tests)[0];
    const pool = shuffle(TEST_TERMS.filter(t => t !== pick.t && !pick.st.toLowerCase().includes(t.toLowerCase()))).slice(0, 3);
    qs.push({ kind: "test", stem: "Fill the gap (from the case): " + pick.st, answer: pick.t, options: shuffle([pick.t, ...pool]), src: pick.e.t });
  }
  return qs.slice(0, 4);
}

const LETTERS = ["a", "b", "c", "d"];
export function judgeAnswer(q, said) {
  const s = said.toLowerCase().trim();
  const m = s.match(/^(?:option\s*)?\(?([abcd])\)?[.!]?$|\b(?:option|answer)\s+([abcd])\b/);
  let pick = m ? q.options[LETTERS.indexOf(m[1] || m[2])] : null;
  if (!pick) {
    const st = new Set(terms(said));
    let best = null, bs = 0;
    for (const o of q.options) { const ot = terms(o); const sc = ot.filter(t => st.has(t)).length / (ot.length || 1); if (sc > bs) { bs = sc; best = o; } }
    if (bs >= 0.5) pick = best;
  }
  return { pick, correct: !!pick && pick.toLowerCase() === q.answer.toLowerCase() };
}

// ---------------- reflection ("what did you learn?") ----------------
export function reflect(text, sess) {
  const st = new Set(terms(text).filter(t => t.length >= 4));
  const points = [...sess.c.pearls];
  const hit = [], miss = [];
  for (const p of points) {
    const pt = [...new Set(terms(p).filter(t => t.length >= 4))];
    const ov = pt.filter(t => st.has(t)).length;
    (ov >= 2 || (pt.length && ov / pt.length >= 0.3) ? hit : miss).push(p);
  }
  const titleHit = terms(sess.c.src.title).filter(t => t.length >= 4 && st.has(t)).length > 0;
  return { hit, miss, titleHit, words: text.trim().split(/\s+/).length };
}

// ---------------- figures ----------------
const FIG_CAT = {
  "X-ray": /x-?ray|radiograph/i, "CT": /\bct\b|computed tomograph/i, "MRI": /\bmri\b|magnetic resonance|t1|t2|flair/i,
  "ultrasound": /ultraso|sonograph|doppler/i, "echo": /echocardiogra/i, "ECG": /\becg\b|electrocardiogra/i,
  "biopsy & histopathology": /histolog|histopatholog|h&e|haematoxylin|hematoxylin|biops|immunohisto|stain|magnification|×\s?\d+/i,
  "endoscopy": /endoscop|colonoscop|bronchoscop/i, "eye tests": /fundus|slit|oct\b|fluorescein/i,
};
export function figureURL(c, i) { return `https://pmc-oa-opendata.s3.amazonaws.com/${c.figs.v}/${encodeURIComponent(c.figs.i[i])}`; }
export function figuresFor(c, cats) {
  if (!c.figs || !c.figs.c.length) return [];
  const out = [];
  c.figs.c.forEach((cap, i) => { if (cats.some(k => FIG_CAT[k] && FIG_CAT[k].test(cap))) out.push(i); });
  return out;
}

// ---------------- resources (links only; all free, official or open) ----------------
export function resources(c) {
  const q = encodeURIComponent(c.src.title.replace(/[:;].*$/, "").replace(/\b(a|an|the|case|report|rare|unusual)\b/gi, " ").replace(/\s+/g, " ").trim());
  const R = [
    ["Full article (PMC)", `https://pmc.ncbi.nlm.nih.gov/articles/${c.id}/`],
    ["Similar cases on PubMed", `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed&from_uid=${c.src.pmid || ""}`],
    ["Patient-level summary (MedlinePlus)", `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=${q}`],
    ["Textbook chapters (NCBI Bookshelf)", `https://www.ncbi.nlm.nih.gov/books/?term=${q}`],
    ["Open medical images (Open-i, NLM)", `https://openi.nlm.nih.gov/gridquery?q=${q}`],
    ["Open images & videos (Wikimedia Commons)", `https://commons.wikimedia.org/w/index.php?search=${q}&title=Special:MediaSearch&type=video`],
    ["Clinical trials (ClinicalTrials.gov)", `https://clinicaltrials.gov/search?term=${q}`],
  ];
  if (c.figs) R.splice(1, 0, ["Article PDF (PMC open data)", `https://pmc-oa-opendata.s3.amazonaws.com/${c.figs.v}/${c.figs.v}.pdf`]);
  return R;
}

// ---------------- dose check: case dose vs the official label's dosing text ----------------
// Honest by design: "appears in the label's dosing text" is NOT "correct for this patient"; labels state many
// amounts (by indication, age, weight, renal function) and are US labels.
const DOSE_RX = /(\d+(?:\.\d+)?)(?:\s*(?:to|-|–|or)\s*(\d+(?:\.\d+)?))?\s*(mg|g|grams?|milligrams?|mcg|µg|micrograms?|units?|IU|mL|mEq|mmol)\b(?:\s*\/\s*(kg|m2|m\^2|m²))?/gi;
function doseKey(unit, per) {
  const u = unit.toLowerCase(); let f = 1, b = u;
  if (["g", "gram", "grams"].includes(u)) { f = 1000; b = "mg"; }
  else if (["mg", "milligram", "milligrams"].includes(u)) b = "mg";
  else if (["mcg", "µg", "microgram", "micrograms"].includes(u)) { f = 0.001; b = "mg"; }
  else if (["unit", "units", "iu"].includes(u)) b = "units";
  else if (u === "ml") b = "mL"; else if (u === "meq") b = "mEq";
  if (per) b += "/" + (per.toLowerCase() === "kg" ? "kg" : "m2");
  return [f, b];
}
export function doseChecks(text, drugs, findDrugs) {
  if (!drugs) return [];
  const out = [];
  const low = text.toLowerCase();
  for (const name of findDrugs(text)) {
    const card = drugs.cards[name]; if (!card) continue;
    const alias = Object.entries(drugs.aliases || {}).filter(([, v]) => v === name).map(([k]) => k);
    let at = -1;
    for (const n of [name, ...alias]) { const i = low.indexOf(n); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) continue;
    const win = text.slice(at, at + 90).split(/[.;](\s|$)/)[0];
    for (const m of win.matchAll(DOSE_RX)) {
      const [f, key] = doseKey(m[3], m[4]);
      const v = +m[1] * f, v2 = m[2] ? +m[2] * f : v;
      let status = "nolabel";
      if (card.dn && card.dn.length) {
        const same = card.dn.filter(d => d[2] === key);
        if (same.some(d => v >= d[0] - 1e-9 && v2 <= d[1] + 1e-9 || Math.abs(d[0] - v) < 1e-9)) status = "in";
        else if (!same.length && card.dn.some(d => d[2].startsWith(key.split("/")[0] + "/"))) status = "weight";
        else status = "out";
      }
      out.push({ drug: name, said: m[0], status, label: card.dose || "", sid: card.sid });
    }
  }
  return out;
}
export const DOSE_STATUS = {
  in: ["✓", "This amount appears in the US label's dosing text."],
  out: ["⚠", "This amount does not appear in the US label's dosing text. It may be weight-based, for a different indication or country, or off-label. Check the label and your formulary."],
  weight: ["≈", "The label doses this medicine by body weight or surface area, so a fixed amount can't be compared directly."],
  nolabel: ["–", "No dosing text was available from the label to compare."],
};

// ---------------- image questions (published figures with exactly paired captions) ----------------
const MODALITY = { "X-ray": /x-?ray|radiograph/i, "CT": /\bct\b|computed tomograph/i, "MRI": /\bmri\b|magnetic resonance/i,
  "Ultrasound": /ultraso|sonograph|doppler/i, "Histology": /histolog|histopatholog|h&e|haematoxylin|hematoxylin|immunohisto|magnification/i,
  "Endoscopy": /endoscop|colonoscop|bronchoscop|gastroscop/i, "Clinical photograph": /photograph|clinical (image|picture|appearance)/i,
  "Fundus / eye imaging": /fundus|slit[- ]lamp|optical coherence|\boct\b/i, "ECG": /\becg\b|electrocardiogra/i,
  "Angiography": /angiogra/i, "Echocardiography": /echocardiogra/i };
function modalityOf(cap) {
  const hits = Object.keys(MODALITY).filter(k => MODALITY[k].test(cap));
  return hits.length === 1 ? hits[0] : null;                   // only unambiguous captions
}
export function imageQuestions(c, otherCases, exclude = new Set()) {
  if (!c.figs || !c.figs.c.length) return [];
  seeded(c.id + "img");
  const qs = [];
  let cand = c.figs.c.map((cap, i) => ({ i, cap, mod: modalityOf(cap) })).filter(x => x.mod && x.cap.length > 30);
  if (!cand.length) return [];
  const unseen = cand.filter(x => !exclude.has(x.i));
  if (unseen.length) cand = unseen;                            // prefer a figure the student hasn't seen captioned
  const pick = shuffle(cand)[0];
  // 1) what kind of image is this?
  const mods = shuffle(Object.keys(MODALITY).filter(k => k !== pick.mod)).slice(0, 3);
  qs.push({ kind: "img-mod", img: pick.i, stem: "Image question: what kind of image is this?", answer: pick.mod,
    options: shuffle([pick.mod, ...mods]), src: pick.cap });
  // 2) which description matches this image? (real captions of the same kind from other cases)
  const pool = [];
  for (const o of otherCases) {
    if (o.id === c.id || !o.figs || !o.figs.c.length) continue;
    for (const cap of o.figs.c) if (modalityOf(cap) === pick.mod && cap.length > 30) pool.push(cap);
  }
  const short = s => s.length > 170 ? s.slice(0, 167) + "…" : s;
  const distract = shuffle([...new Set(pool.map(short))]).filter(s => s !== short(pick.cap)).slice(0, 3);
  if (distract.length === 3) qs.push({ kind: "img-read", img: pick.i, stem: "Image interpretation: which description matches this image?",
    answer: short(pick.cap), options: shuffle([short(pick.cap), ...distract]), src: pick.cap });
  return qs;
}
