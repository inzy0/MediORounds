// MediORounds case engine. Deterministic: every reply is a verbatim sentence from the published case
// report (or a fixed teaching prompt). No text is generated, so the same input gives the same output.

const STOP = new Set(("a an the and or of to in on at for with by from is are was were be been being has have had do does did " +
  "this that these those it its his her their there what which who whom how when where why any some all can could would should " +
  "will shall may might please tell me about you your patient patients mr mrs ms sir madam doctor dr any ok okay so also just " +
  "then than very much more most into out up down over under again further once here only own same too not no yes ask asking " +
  "like know want need let us we our i my").split(" "));

const stem = w => w.length > 5 ? w.slice(0, 5) : w;
export function terms(text) {
  return (text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
    .filter(w => w.length > 1 && !STOP.has(w)).map(stem));
}

// question words -> words the case text uses
const SYN = {
  pain: "pain ache painful tender discomfort", fever: "fever febrile temperature pyrexia chills rigors",
  cough: "cough sputum haemoptysis hemoptysis expectoration", breath: "breath dyspnoea dyspnea breathless shortness orthopnoea",
  vomit: "vomit vomiting nausea emesis", stool: "stool diarrhoea diarrhea constipation bowel melena",
  urine: "urine urinary micturition dysuria haematuria hematuria oliguria", weigh: "weight loss gain appetite",
  medic: "medication medications taking drug drugs treated treatment therapy tablets prescribed on",
  drug: "medication medications taking drug drugs treated therapy", famil: "family mother father sibling brother sister hereditary relative",
  smoke: "smoker smoking smoked cigarettes tobacco pack", alcoh: "alcohol drinking drinks ethanol", alcohol: "alcohol drinking ethanol",
  past: "history previous previously prior known past diagnosed", histo: "history previous prior known past", allerg: "allergy allergies allergic",
  pregn: "pregnant pregnancy gravida para gestation trimester obstetric", menst: "menstrual menses period periods menarche lmp cycle",
  sleep: "sleep insomnia", mood: "mood depressed sad anxiety anxious", occup: "occupation work worked farmer job employed",
  durat: "duration since days weeks months years onset", start: "onset began started since sudden gradual", when: "onset since days weeks months",
  trave: "travel travelled traveled trip", conta: "contact exposure exposed", vacci: "vaccination vaccinated immunization",
  surge: "surgery operation underwent operated surgical", birth: "birth born delivery neonatal gestation", devel: "developmental milestones development",
  headac: "headache", heada: "headache", seizu: "seizure seizures convulsion fits", vision: "vision visual blurred diplopia",
  hear: "hearing deafness tinnitus", rash: "rash lesion lesions itching pruritus eruption", swell: "swelling swollen oedema edema mass lump",
  bleed: "bleeding haemorrhage hemorrhage blood", compl: "complaint complaints presented presenting complained", compla: "complaint presented",
  sympt: "symptoms complained presented complaint",
};
const SYN_T = Object.fromEntries(Object.entries(SYN).map(([k, v]) => [k, terms(v)]));

function expand(qterms) {
  const out = new Set(qterms);
  for (const t of qterms) for (const [k, v] of Object.entries(SYN_T)) if (t.startsWith(k) || k.startsWith(t)) v.forEach(x => out.add(x));
  return [...out];
}

// ---------------- examination systems ----------------
export const EXAM = {
  vitals: /\b(blood pressure|bp\b|pulse|heart rate|temperature|respiratory rate|saturation|spo2|vital|febrile|afebrile|bmi|weigh|height|tachycard|bradycard|hypotens|hypertens|tachypn)/i,
  general: /\b(general|conscious|alert|oriented|pallor|pale|icter|jaundic|cyanos|clubbing|lymphadenopath|oedema|edema|dehydrat|cachex|built|appear|distress|gcs|glasgow|ill-looking|toxic)/i,
  cvs: /\b(heart sound|cardiac|murmur|s1|s2|s3|jvp|jugular|peripheral pulses|gallop|precordi|apex beat|thrill)/i,
  rs: /\b(chest|lung|breath sound|crackle|crepitation|wheez|air entry|respirat|percussion|auscultat|rhonchi|stridor)/i,
  abdomen: /\b(abdom|liver|spleen|hepatomegal|splenomegal|bowel sound|guarding|rebound|hernia|rectal|organomegal|ascites|murphy)/i,
  cns: /\b(neurolog|power|reflex|tone|sensation|sensory|cranial nerve|gait|plantar|pupil|cerebell|neck stiffness|meninge|hemipares|paralys|weakness|ataxi|aphasi|dysarthri)/i,
  local: /\b(lesion|swelling|mass|rash|ulcer|wound|skin|erythema|nodule|papule|plaque|vesicle|macule|joint|range of motion|deformit|tenderness|eye|visual|fundus|conjunctiv|cornea|ear|tympanic|nasal|throat|tonsil|breast|thyroid|neck|limb|spine|scalp)/i,
  obstetric: /\b(uterus|uterine|fundal|cervix|cervical os|vagina|per vaginum|fetal|foetal|adnexa|speculum|fetal heart|cephalic|breech)/i,
  mse: /\b(mood|affect|thought|hallucinat|delusion|insight|judgement|judgment|psychomotor|suicid|mental status|orientation|cognition)/i,
};
const EXAM_ASK = {
  vitals: /\b(vital|bp|blood pressure|pulse|temperature|temp|saturation|spo2|respiratory rate|heart rate)/i,
  general: /\b(general|pallor|icterus|jaundice|cyanosis|clubbing|lymph|oedema|edema|built)/i,
  cvs: /\b(cvs|cardio|heart|precordi|murmur|jvp)/i,
  rs: /\b(rs\b|respiratory system|chest|lung|auscultat|breath sounds)/i,
  abdomen: /\b(abdom|per abdomen|p\/a|liver|spleen|belly|stomach)/i,
  cns: /\b(cns|neuro|nervous|reflex|power|tone|cranial|gait|pupil)/i,
  local: /\b(local|skin|lesion|swelling|wound|eye|ear|nose|throat|joint|limb|spine|breast|thyroid|neck|ent)/i,
  obstetric: /\b(obstetric|p\/v|per vaginal|pv\b|vaginal|uterus|fundal|speculum|fetal|foetal)/i,
  mse: /\b(mse|mental status|mood|affect|thought|psych)/i,
};

// ---------------- investigation categories ----------------
export const INV = {
  "blood count": /\b(blood count|haemoglobin|hemoglobin|hb\b|white blood|wbc|leukocyt|leucocyt|platelet|neutrophil|lymphocyt|eosinophil|esr|haematocrit|hematocrit|cbc|full blood)/i,
  "biochemistry": /\b(serum|creatinine|urea|sodium|potassium|electrolyte|glucose|sugar|hba1c|bilirubin|transaminase|alt\b|ast\b|alkaline phosph|albumin|liver function|renal function|kidney function|lipid|calcium|magnesium|phosph|amylase|lipase|troponin|crp|c-reactive|procalcitonin|lactate|ferritin|tsh|thyroid|hormone|vitamin|cortisol|creatine kinase|ldh|d-dimer|inr|prothrombin|coagulation|aptt|fibrinogen|hcg|β-hcg|tumou?r marker|cea\b|ca-125|psa\b|ammonia|iron)/i,
  "microbiology & serology": /\b(culture|pcr|serolog|antibod|antigen|smear|gram|sensitivity|hiv|hepatitis|viral|bacteri|fung|tubercul|mycobact|igm|igg|titer|titre|quantiferon|covid|sars|malaria|dengue|widal|ana\b|anca|rheumatoid factor|complement)/i,
  "urine": /\b(urine|urinalysis|proteinuria|haematuria|hematuria|urinary)/i,
  "blood gas": /\b(arterial blood gas|abg|ph of|pco2|po2|bicarbonate|base excess|venous blood gas)/i,
  "ECG": /\b(ecg|ekg|electrocardiogra|holter|sinus rhythm|st elevation|st-segment|qt)/i,
  "X-ray": /\b(x-ray|xray|radiograph|chest film|cxr)/i,
  "CT": /\b(ct\b|ct scan|computed tomograph|cect|hrct|ct angiogra)/i,
  "MRI": /\b(mri|magnetic resonance|mra\b|mrcp)/i,
  "ultrasound": /\b(ultraso|sonograph|usg|doppler|duplex)/i,
  "echo": /\b(echocardiogra|echo\b(?!-)|tte\b|tee\b|transthoracic|transoesophageal|transesophageal)/i,
  "endoscopy": /\b(endoscop|colonoscop|bronchoscop|cystoscop|laryngoscop|nasendoscop|gastroscop|egd\b|ercp)/i,
  "biopsy & histopathology": /\b(biops|histolog|histopatholog|cytolog|fnac|fine.needle|aspirat|immunohisto|patholog|frozen section)/i,
  "CSF": /\b(lumbar puncture|csf|cerebrospinal)/i,
  "EEG / EMG / NCS": /\b(eeg|electroencephalo|emg|electromyog|nerve conduction)/i,
  "eye tests": /\b(visual acuity|slit.lamp|fundus|fundoscop|intraocular pressure|optical coherence|oct\b|tonometr|fluorescein|perimetr)/i,
  "hearing tests": /\b(audiometr|tympanometr|otoscop|pure tone|hearing test)/i,
  "genetics": /\b(genetic|karyotyp|sequenc|mutation|exome|chromosom|microarray|variant)/i,
  "skin tests": /\b(dermoscop|patch test|koh\b|wood.s lamp|tzanck)/i,
  "rating scales": /\b(scale|questionnaire|mmse|moca|phq|hamilton|gad-7|ymrs|panss|score of)/i,
};
const INV_ASK = {
  "blood count": /\b(cbc|blood count|hb\b|haemoglobin|hemoglobin|wbc|platelet|esr|hemogram|haemogram|bloods?\b|blood tests?|routine)/i,
  "biochemistry": /\b(lft|kft|rft|liver function|kidney function|renal function|electrolyte|sugar|glucose|creatinine|urea|biochem|troponin|crp|thyroid|tsh|lipid|bloods?\b|blood tests?|routine|coag|inr|pt\b|hormone|marker|serum)/i,
  "microbiology & serology": /\b(culture|pcr|serolog|antibod|viral|hiv|hepatitis|micro|swab|smear|tb\b|malaria|dengue|widal|ana\b|infection screen)/i,
  "urine": /\b(urine|urinalysis|ume|routine)/i,
  "blood gas": /\b(abg|blood gas|vbg)/i,
  "ECG": /\b(ecg|ekg|electrocardiogra)/i,
  "X-ray": /\b(x.?ray|xray|radiograph|cxr)/i,
  "CT": /\b(ct\b|cat scan|computed|cect|hrct)/i,
  "MRI": /\b(mri|magnetic|mrcp)/i,
  "ultrasound": /\b(ultraso|usg|sonograph|doppler|scan of the abdomen)/i,
  "echo": /\b(echo|2d echo)/i,
  "endoscopy": /\b(scopy|endoscop|ogd|egd|ercp)/i,
  "biopsy & histopathology": /\b(biops|histo|fnac|cytolog|patholog)/i,
  "CSF": /\b(csf|lumbar puncture|lp\b|spinal tap)/i,
  "EEG / EMG / NCS": /\b(eeg|emg|ncs|nerve conduction)/i,
  "eye tests": /\b(visual acuity|slit|fundus|fundoscop|iop|tonometr|oct\b|eye test)/i,
  "hearing tests": /\b(audiometr|pta\b|tympanometr|hearing test|otoscop)/i,
  "genetics": /\b(genetic|karyotyp|gene|exome|chromosom)/i,
  "skin tests": /\b(dermoscop|patch test|koh|tzanck|wood)/i,
  "rating scales": /\b(scale|mmse|moca|phq|hamilton|score)/i,
};
const IMAGING_ALL = /\b(imaging|radiolog|scan)\b/i;

// ---------------- drugs (names only; links go to the official label) ----------------
const DRUG_RX = /\b([a-z]+(?:mab|nib|cillin|mycin|micin|floxacin|azole|pril|sartan|olol|dipine|statin|prazole|tidine|sone|solone|olone|parin|xaban|gatran|vir|cycline|cef[a-z]+|penem|afil|triptan|azepam|zolam|pine|done|glutide|gliflozin|gliptin|formin|amide|thiazide|setron|tropin|caine|profen|fenac|oxacin|zumab|ximab|ciclib|lukast|terol|dronate|parib)|aspirin|paracetamol|acetaminophen|insulin|heparin|warfarin|morphine|fentanyl|ketamine|propofol|ibuprofen|prednisolone|prednisone|dexamethasone|hydrocortisone|methylprednisolone|methotrexate|metformin|furosemide|amiodarone|adrenaline|epinephrine|noradrenaline|norepinephrine|atropine|tranexamic acid|oxytocin|misoprostol|magnesium sulfate|magnesium sulphate|labetalol|nifedipine|haloperidol|lithium|valproate|phenytoin|levetiracetam|vancomycin|metronidazole|doxycycline|azithromycin|amoxicillin|ceftriaxone|meropenem|colistin|acyclovir|ganciclovir|amphotericin|fluconazole|isoniazid|rifampicin|rifampin|ethambutol|pyrazinamide|albendazole|ivermectin|chloroquine|hydroxychloroquine|artesunate|quinine|digoxin|dopamine|dobutamine|vasopressin|mannitol|salbutamol|albuterol|ipratropium|montelukast|omeprazole|pantoprazole|ondansetron|metoclopramide|clopidogrel|ticagrelor|alteplase|tenecteplase|streptokinase|enoxaparin|rituximab|cyclophosphamide|azathioprine|mycophenolate|tacrolimus|cyclosporine|ciclosporin|colchicine|allopurinol|levothyroxine|carbimazole|propylthiouracil|spironolactone|bisoprolol|carvedilol|amlodipine|losartan|ramipril|enalapril|atorvastatin|rosuvastatin|sertraline|fluoxetine|escitalopram|olanzapine|risperidone|quetiapine|clozapine|aripiprazole|lorazepam|diazepam|midazolam|clonazepam|naloxone|flumazenil|n-acetylcysteine|acetylcysteine|calcium gluconate|sodium bicarbonate|potassium chloride|iron sucrose|vitamin k|immunoglobulin|ivig|interferon|imatinib)\b/gi;
export function drugsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(DRUG_RX)) {
    const d = m[0].toLowerCase();
    if (d.length >= 5 && !/^(amide|done|pine|sone|caine|olone)$/.test(d)) out.add(d);
  }
  return [...out];
}

const DX_GENERIC = new Set(terms("case report rare unusual young woman man boy girl old year years presenting presentation associated " +
  "literature review patient treated treatment management successful novel new first report diagnosis diagnosed challenge " +
  "challenging atypical unusual mimicking mimic secondary following after due cause caused induced lesson learned approach " +
  "child children adult elderly female male infant neonate month months day days review rare manifestation"));

// ---------------- case session ----------------
export class CaseSession {
  constructor(c) {
    this.c = c;
    this.ev = c.events.map((e, i) => ({ ...e, i, tt: new Set(terms(e.t)) }));
    this.work = this.ev.slice(0, c.split);
    this.course = this.ev.slice(c.split);
    this.shown = new Set();
    this.phase = "workup";          // workup -> plan -> round -> debrief
    this.examAsked = new Set(); this.invAsked = new Set(); this.invHit = new Set(); this.invMiss = new Set();
    this.ddx = []; this.dx = ""; this.dxSelf = null; this.plan = ""; this.planSelf = null; this.decisions = [];
    this.cursor = 0; this.started = Date.now(); this.hints = 0; this.tablesShown = false;
    // idf within the case
    const df = new Map();
    for (const e of this.ev) for (const t of e.tt) df.set(t, (df.get(t) || 0) + 1);
    this.idf = t => Math.log(1 + this.ev.length / (df.get(t) || 0.5));
    const pool = s => this.work.filter(e => s.includes(e.s));
    this.histPool = [...pool(["presentation", "history", "course"]),
      ...this.ev.filter(e => e.s === "history" && e.i >= c.split)];
    this.examPool = this.work.filter(e => e.s === "examination" || Object.values(EXAM).some(r => r.test(e.t)) && e.s !== "investigations" && e.s !== "diagnosis");
    this.invPool = this.work.filter(e => e.s === "investigations" || e.s === "diagnosis");
    this.histTotal = this.work.filter(e => ["history", "presentation"].includes(e.s)).length || 1;
    this.examTotal = this.work.filter(e => e.s === "examination").length;
    this.invCats = new Set();
    for (const e of this.invPool) for (const [k, r] of Object.entries(INV)) if (r.test(e.t)) this.invCats.add(k);
    this.mgmtDrugs = drugsIn(this.course.filter(e => e.s === "management").map(e => e.t).join(" "));
    this.shown.add(0);
  }

  get opening() { return this.ev[0]; }

  reveal(list) { const fresh = list.filter(e => !this.shown.has(e.i)); fresh.forEach(e => this.shown.add(e.i)); return fresh; }

  // ---- history: best-matching sentences, verbatim ----
  askHistory(q) {
    const qt = expand(terms(q));
    if (!qt.length) return { kind: "nodoc" };
    const scored = this.histPool.map(e => {
      let s = 0; for (const t of qt) if (e.tt.has(t)) s += this.idf(t);
      for (const t of e.tt) for (const x of qt) if (x.length >= 4 && t !== x && t.startsWith(x)) { s += 0.5 * this.idf(t); break; }
      return { e, s: s - (this.shown.has(e.i) ? 0.8 : 0) };
    }).filter(x => x.s >= 1.2).sort((a, b) => b.s - a.s);
    if (!scored.length) return { kind: "nodoc" };
    const top = scored.slice(0, 2).filter((x, k) => k === 0 || x.s >= scored[0].s * 0.7).map(x => x.e);
    top.sort((a, b) => a.i - b.i);
    const fresh = this.reveal(top);
    return { kind: "hist", items: top, fresh: fresh.length };
  }

  examine(q) {
    let systems = Object.keys(EXAM_ASK).filter(k => EXAM_ASK[k].test(q));
    if (!systems.length) systems = ["vitals", "general"];
    systems.forEach(s => this.examAsked.add(s));
    const items = this.examPool.filter(e => systems.some(s => EXAM[s].test(e.t)));
    const fresh = this.reveal(items);
    const available = Object.keys(EXAM).filter(k => !this.examAsked.has(k) && this.examPool.some(e => EXAM[k].test(e.t) && !this.shown.has(e.i)));
    return { kind: "exam", systems, items, fresh: fresh.length, available };
  }

  order(q) {
    let cats = Object.keys(INV_ASK).filter(k => INV_ASK[k].test(q));
    if (!cats.length && IMAGING_ALL.test(q)) cats = ["X-ray", "CT", "MRI", "ultrasound"];
    if (!cats.length) return { kind: "inv-unknown" };
    const out = [];
    for (const k of cats) {
      this.invAsked.add(k);
      const items = this.invPool.filter(e => INV[k].test(e.t));
      if (items.length) this.invHit.add(k); else this.invMiss.add(k);
      out.push({ cat: k, items, fresh: this.reveal(items).length });
    }
    let tables = null;
    if (!this.tablesShown && this.c.tables.length && cats.some(k => ["blood count", "biochemistry"].includes(k))) {
      tables = this.c.tables; this.tablesShown = true;
    }
    return { kind: "inv", results: out, tables };
  }

  addDdx(text) { this.ddx.push(text); }

  commitDx(text) {
    this.dx = text; this.phase = "plan";
    const truth = [this.c.src.title, ...this.ev.filter(e => e.s === "diagnosis").map(e => e.t)].join(" ");
    const tt = new Set(terms(truth).filter(t => !DX_GENERIC.has(t)));
    const titleT = new Set(terms(this.c.src.title).filter(t => !DX_GENERIC.has(t)));
    const st = [...new Set(terms(text).filter(t => !DX_GENERIC.has(t)))];
    const hit = st.filter(t => tt.has(t));
    const titleHit = st.filter(t => titleT.has(t) && t.length >= 4);
    const verdict = titleHit.length >= 2 || (titleHit.length >= 1 && hit.length >= 2) ? "close" : hit.length ? "partial" : "different";
    this.dxAuto = verdict;
    const dxEv = this.ev.filter(e => e.s === "diagnosis");
    this.reveal(dxEv);
    return { kind: "dx", verdict, hit, title: this.c.src.title, items: dxEv };
  }

  commitPlan(text) {
    this.plan = text; this.phase = "round";
    const mg = this.course.filter(e => e.s === "management");
    const mt = new Set(mg.flatMap(e => [...e.tt]));
    const st = [...new Set(terms(text))];
    this.planHit = st.filter(t => mt.has(t) && !DX_GENERIC.has(t));
    const studentDrugs = drugsIn(text);
    this.drugOverlap = studentDrugs.filter(d => this.mgmtDrugs.includes(d));
    return { kind: "plan", hit: this.planHit, drugs: this.drugOverlap, studentDrugs };
  }

  // ---- ward round: next chunk of the course, stopping before each complication event ----
  nextRound(decision) {
    if (decision) this.decisions.push({ at: this.cursor, text: decision });
    if (this.cursor >= this.course.length) { this.phase = "debrief"; return { kind: "end" }; }
    const chunk = [];
    let event = null;
    while (this.cursor < this.course.length) {
      const e = this.course[this.cursor];
      if (e.c && chunk.length) { break; }
      chunk.push(e); this.cursor++;
      if (e.c) { event = e; break; }
      if (chunk.length >= 3) break;
    }
    this.reveal(chunk);
    const day = Math.max(1, Math.round(this.cursor / 3));
    const done = this.cursor >= this.course.length;
    if (done) this.phase = "debrief";
    return { kind: "round", day, items: chunk, event, done };
  }

  hint() {
    this.hints++;
    const leftHist = this.histPool.filter(e => !this.shown.has(e.i)).length;
    const leftExam = Object.keys(EXAM).filter(k => !this.examAsked.has(k) && this.examPool.some(e => EXAM[k].test(e.t) && !this.shown.has(e.i)));
    const leftInv = [...this.invCats].filter(k => !this.invAsked.has(k));
    return { kind: "hint", leftHist, leftExam, leftInv, phase: this.phase };
  }

  scores() {
    const shownOf = arr => arr.filter(e => this.shown.has(e.i)).length;
    const hist = shownOf(this.work.filter(e => ["history", "presentation"].includes(e.s))) / this.histTotal;
    const exam = this.examTotal ? shownOf(this.work.filter(e => e.s === "examination")) / this.examTotal : null;
    const inv = this.invCats.size ? this.invHit.size / this.invCats.size : null;
    const dxMap = { close: 1, partial: 0.5, different: 0, right: 1, part: 0.5, wrong: 0 };
    const dx = this.dxSelf ? dxMap[this.dxSelf] : this.dxAuto ? dxMap[this.dxAuto] : null;
    const planMap = { right: 1, part: 0.5, wrong: 0 };
    const plan = this.planSelf ? planMap[this.planSelf] : null;
    return { hist, exam, inv, invExtra: this.invMiss.size, dx, plan, hints: this.hints,
      secs: Math.round((Date.now() - this.started) / 1000) };
  }
}

// ---------------- intent routing (English text) ----------------
const RX = {
  next: /^(next|continue|go on|proceed|carry on|move on|next day|next round|ok next|okay next|go ahead|what happened next|then what)\b|\b(next (day|round|step)|move on|carry on)\b/i,
  hint: /\b(hint|help me|i'?m stuck|what should i (do|ask)|guide me|clue)\b/i,
  repeat: /\b(repeat|say (that|it) again|again please|pardon)\b/i,
  dx: /\b(final diagnosis|my diagnosis|diagnosis is|provisional diagnosis|i (think|believe|feel) (it|this) (is|was)|i (think|believe) the patient has|(it'?s|this is) (a )?case of|patient (has|is suffering from)|diagnos(e|ing) (it|this) as)\b/i,
  ddx: /\b(differentials?|ddx|differential diagnos[ie]s|could be|rule out|possibilit(y|ies)|my differentials)\b/i,
  plan: /\b(my plan|management plan|plan is|i would (start|give|treat|prescribe|manage|admit|operate|refer)|i('?d| will) (start|give|treat|prescribe|manage|admit|operate|refer)|start (him|her|the patient) on|treat (with|him|her)|manage (with|by)|prescribe|plan:)\b/i,
  exam: /\b(examin\w*|exam\b|look at|auscultat\w*|palpat\w*|percuss\w*|inspect\w*|vitals?\b|check (the |his |her )?(bp|pulse|chest|abdomen|heart|lungs?|reflexes|eyes?|ears?|throat|skin)\b|general survey|systemic|on examination|o\/e|p\/a\b|p\/v\b|mse\b|mental status)/i,
  order: /\b(order\w*|send\b|request\w*|get (a|an|the|me)\b|do (a|an)\b|investigat\w*|tests?\b|scans?\b|reports?\b|results?\b|labs?\b|bloods?\b|imaging|x.?rays?\b|ct\b|mri\b|ultraso\w*|usg\b|ecg\b|ekg\b|echo\b|biops\w*|cultures?\b|cbc\b|lft\b|kft\b|rft\b|abg\b|urine\b|endoscop\w*|histopath\w*|histolog\w*)/i,
};
export function route(text, phase) {
  const t = text.trim();
  if (/\b\d{10}\b|\b\d{4}\s?\d{4}\s?\d{4}\b|\b(uhid|mrn|aadhaar|aadhar|my (real )?patient|real patient)\b/i.test(t)) return "phi";
  if (RX.hint.test(t)) return "hint";
  if (RX.repeat.test(t)) return "repeat";
  if (phase === "round") return RX.next.test(t) && t.split(/\s+/).length <= 5 ? "next" : "decision";
  if (phase === "plan") return RX.next.test(t) && t.split(/\s+/).length <= 3 ? "planskip" : "plan";
  if (phase === "debrief") return "debrief";
  if (RX.dx.test(t)) return "dx";
  if (RX.ddx.test(t)) return "ddx";
  if (RX.plan.test(t)) return "earlyplan";
  if (RX.exam.test(t) && !/\b(x.?ray|ct\b|mri|ultraso|scan|biops|culture|cbc|blood test)/i.test(t)) return "exam";
  if (RX.order.test(t)) return "order";
  return "history";
}
