import { CaseSession, route, drugsIn } from "./engine.js";
import { Voice } from "./voice.js";
import { LANGS, langOf, translate, prepare, translatorSupported, numbersMatch } from "./i18n.js";
import * as store from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";

const db = store.load();
const app = {
  wards: null, cache: {}, lang: db.prefs.lang || "en", sess: null, caseObj: null, ward: null,
  lastSaid: [], live: !!db.prefs.live, trOK: false, trChecked: {},
};

const ROLE = {
  patient: { label: "Patient · case record", cls: "patient", voice: "patient" },
  senior: { label: "Senior Resident", cls: "senior", voice: "senior" },
  hod: { label: "HOD · teaching round", cls: "hod", voice: "hod" },
  nurse: { label: "Nurse / Lab", cls: "nurse", voice: "nurse" },
  record: { label: "Ward round · case record", cls: "record", voice: "system" },
  you: { label: "You", cls: "you" },
};

// ---------------------------------------------------------------- voice
const voice = new Voice({
  onFinal: text => handleInput(text, true),
  onInterim: text => { const el = $("#interim"); if (el) el.textContent = text; },
  onState: s => {
    document.body.dataset.voice = s;
    const lab = $("#orbLabel");
    if (lab) lab.textContent = { idle: voice.canListen ? "Tap to talk" : "Voice input not supported here — type below", listening: "Listening…", speaking: "Speaking · tap to interrupt", thinking: "…" }[s];
    if (s !== "listening") { const el = $("#interim"); if (el) el.textContent = ""; }
  },
});
voice.live = app.live;

// ---------------------------------------------------------------- language
async function setLang(code, fromGesture) {
  app.lang = code; store.setPref(db, "lang", code);
  voice.setLang(langOf(code).speech);
  app.trOK = code === "en";
  if (code !== "en" && translatorSupported() && fromGesture) {
    setBanner(`Preparing ${langOf(code).name} on this device…`);
    app.trOK = await prepare(code, p => setBanner(`Downloading ${langOf(code).name} language pack… ${Math.round(p * 100)}%`));
  } else if (code !== "en" && translatorSupported()) {
    app.trOK = await prepare(code).catch(() => false);
  }
  if (code !== "en" && !app.trOK) {
    setBanner(`On-device ${langOf(code).name} translation isn't available in this browser (it needs a recent desktop Chrome or Edge). ` +
      `You can still speak in ${langOf(code).name} for recognition; replies stay in English.`, "warn");
  } else if (code !== "en" && !voice.hasVoice(langOf(code).speech)) {
    setBanner(`No ${langOf(code).name} speech voice is installed on this device, so replies are shown in ${langOf(code).name} but spoken in English. ` +
      `Android/Chrome and Windows (Settings → Time & language → Speech) can add one.`, "warn");
  } else setBanner("");
  translateUI();
}

async function translateUI() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const en = el.dataset.en || (el.dataset.en = el.textContent);
    el.textContent = app.lang === "en" || !app.trOK ? en : (await translate(en, "en", app.lang)) || en;
  }
  for (const el of document.querySelectorAll("[data-i18n-ph]")) {
    const en = el.dataset.enph || (el.dataset.enph = el.placeholder);
    el.placeholder = app.lang === "en" || !app.trOK ? en : (await translate(en, "en", app.lang)) || en;
  }
}

function setBanner(text, kind = "info") {
  const b = $("#banner"); if (!b) return;
  b.textContent = text; b.hidden = !text; b.dataset.kind = kind;
}

// ---------------------------------------------------------------- data
async function loadWards() {
  if (!app.wards) app.wards = await (await fetch("data/wards.json")).json();
  return app.wards;
}
async function loadWard(id) {
  if (!app.cache[id]) app.cache[id] = await (await fetch(`data/cases/${id}.json`)).json();
  return app.cache[id];
}
function pickCase(cases, mode) {
  const done = new Set(db.sessions.map(s => s.id));
  let pool = cases.filter(c => !done.has(c.id));
  if (!pool.length) pool = cases;
  if (mode === "tricky") { const t = pool.filter(c => c.tricky); if (t.length) pool = t; }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------- routing
window.addEventListener("hashchange", render);
async function render() {
  voice.interrupt(); voice.stopListening();
  const [, view, a, b] = (location.hash || "#/").split("/");
  document.body.dataset.view = view || "home";
  if (view === "case") return renderCase(a, b);
  if (view === "progress") return renderProgress();
  if (view === "about") return renderAbout();
  return renderHome();
}

function shell(inner) {
  const opts = LANGS.map(l => `<option value="${l.code}" ${l.code === app.lang ? "selected" : ""}>${l.native}</option>`).join("");
  $("#app").innerHTML = `
  <header class="top">
    <a class="brand" href="#/"><span class="logo" aria-hidden="true"></span>MediORounds</a>
    <nav>
      <a href="#/" data-i18n>Wards</a>
      <a href="#/progress" data-i18n>My progress</a>
      <a href="#/about" data-i18n>About</a>
      <label class="lang"><span class="sr" data-i18n>Language</span><select id="lang">${opts}</select></label>
    </nav>
  </header>
  <div id="banner" hidden></div>
  ${inner}
  <footer class="foot" data-i18n>Educational simulation built from published, openly licensed case reports. Not for real patient care. Never enter real patient details.</footer>`;
  $("#lang").addEventListener("change", e => setLang(e.target.value, true));
  setLang(app.lang, false);
}

// ---------------------------------------------------------------- home
async function renderHome() {
  const w = await loadWards();
  const st = store.streak(db);
  shell(`
  <main class="home">
    <section class="hero">
      <h1 data-i18n>Live voice ward rounds on real published cases</h1>
      <p class="lede" data-i18n>Take the history by talking to the patient, examine, order tests, commit a diagnosis and plan, then follow the admission day by day with your senior. Every finding comes word for word from a published case report.</p>
      <div class="hero-stats">
        <div><b>${w.total.toLocaleString()}</b><span data-i18n>cases</span></div>
        <div><b>${w.wards.length}</b><span data-i18n>wards</span></div>
        <div><b>${LANGS.length}</b><span data-i18n>languages</span></div>
        <div><b>${st}</b><span data-i18n>day streak</span></div>
      </div>
      <div class="quick">
        <button class="btn primary" id="mixed" data-i18n>Start a mixed-ward case</button>
        <button class="btn" id="tricky" data-i18n>Tricky case</button>
      </div>
    </section>
    <h2 class="sect" data-i18n>Choose a ward</h2>
    <section class="wards">
      ${w.wards.map(x => `
        <article class="ward" data-ward="${x.id}">
          <h3>${esc(x.name)}</h3>
          <p>${x.count} <span data-i18n>cases</span></p>
          <div class="row">
            <button class="btn small primary" data-go="${x.id}" data-mode="any" data-i18n>Take a bed</button>
            <button class="btn small" data-go="${x.id}" data-mode="tricky" data-i18n>Tricky</button>
          </div>
        </article>`).join("")}
    </section>
  </main>`);
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => startWard(b.dataset.go, b.dataset.mode)));
  $("#mixed").addEventListener("click", () => startWard(w.wards[Math.floor(Math.random() * w.wards.length)].id, "any"));
  $("#tricky").addEventListener("click", () => startWard(w.wards[Math.floor(Math.random() * w.wards.length)].id, "tricky"));
}

async function startWard(id, mode) {
  const cases = await loadWard(id);
  const c = pickCase(cases, mode);
  location.hash = `#/case/${id}/${c.id}`;
}

// ---------------------------------------------------------------- case
async function renderCase(wardId, caseId) {
  const w = await loadWards();
  const cases = await loadWard(wardId);
  const c = cases.find(x => x.id === caseId);
  if (!c) { location.hash = "#/"; return; }
  app.caseObj = c; app.ward = w.wards.find(x => x.id === wardId);
  app.sess = new CaseSession(c);
  const bed = 1 + (parseInt(c.id.replace(/\D/g, ""), 10) % 24);
  shell(`
  <main class="round">
    <section class="stage">
      <div class="casebar">
        <div><b>${esc(app.ward.name)}</b> · <span data-i18n>Bed</span> ${bed} · ${esc(c.age || "age not stated")}${c.sex ? " · " + (c.sex === "F" ? "F" : "M") : ""}${c.tricky ? ' · <span class="tag">tricky</span>' : ""}</div>
        <div class="phases" id="phases"></div>
      </div>
      <div id="chat" class="chat" aria-live="polite"></div>
      <div class="dock">
        <div id="interim" class="interim"></div>
        <div class="orbrow">
          <button id="orb" class="orb" aria-label="Talk"><span></span></button>
          <div class="orbside">
            <div id="orbLabel" class="orblabel">Tap to talk</div>
            <label class="switch"><input type="checkbox" id="live" ${app.live ? "checked" : ""}><span data-i18n>Live conversation (hands-free)</span></label>
            <label class="switch"><input type="checkbox" id="mute" ${voice.muted ? "checked" : ""}><span data-i18n>Mute replies</span></label>
          </div>
        </div>
        <div class="chips" id="chips"></div>
        <form id="say" class="say"><input id="text" autocomplete="off" placeholder="Speak or type to the patient and team…" data-i18n-ph><button class="btn primary" data-i18n>Send</button></form>
      </div>
    </section>
    <aside class="notes" id="notes"></aside>
  </main>`);
  $("#orb").addEventListener("click", () => voice.canListen ? voice.toggle() : $("#text").focus());
  $("#live").addEventListener("change", e => { app.live = voice.live = e.target.checked; store.setPref(db, "live", app.live); if (app.live && voice.state === "idle") voice.listen(); });
  $("#mute").addEventListener("change", e => { voice.muted = e.target.checked; if (voice.muted) voice.interrupt(); });
  $("#say").addEventListener("submit", e => { e.preventDefault(); const t = $("#text").value.trim(); if (t) { $("#text").value = ""; handleInput(t, false); } });
  updateChips(); updateNotes();
  const s = app.sess;
  await say([
    { role: "senior", en: `Good morning. New admission in bed ${bed}. Take a focused history from the patient, examine, order what you need, and then tell me your diagnosis. Say "hint" if you get stuck.` },
    { role: "patient", en: s.opening.t },
  ]);
}

const CHIPS = {
  workup: [["Presenting complaint", "What brought you here and since when?"], ["Past history", "Any past medical history or previous illness?"],
    ["Drug history", "What medications are you taking?"], ["Family & social", "Any family history, smoking or alcohol?"],
    ["Vitals", "Check vitals"], ["General exam", "General examination"], ["Systemic exam", "Examine chest, heart, abdomen and CNS"],
    ["Local exam", "Local examination"], ["Bloods", "Order CBC and biochemistry"], ["Imaging", "Order X-ray, CT, MRI and ultrasound"],
    ["Biopsy", "Send biopsy and histopathology"], ["Differentials", "My differentials are "], ["Diagnosis", "My diagnosis is "], ["Hint", "hint"]],
  plan: [["Plan", "My plan is "], ["Skip to round", "next"], ["Hint", "hint"]],
  round: [["Next", "next"], ["My decision", "I would "], ["Hint", "hint"]],
  debrief: [],
};
function updateChips() {
  const el = $("#chips"); if (!el) return;
  el.innerHTML = (CHIPS[app.sess.phase] || []).map(([l, q]) => `<button class="chip" data-q="${esc(q)}" data-i18n>${esc(l)}</button>`).join("");
  el.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
    const q = b.dataset.q;
    if (q.endsWith(" ")) { const t = $("#text"); t.value = q; t.focus(); } else handleInput(q, false, true);
  }));
  const ph = ["workup", "plan", "round", "debrief"];
  const names = { workup: "Work-up", plan: "Plan", round: "Ward rounds", debrief: "Debrief" };
  $("#phases").innerHTML = ph.map(p => `<span class="ph ${p === app.sess.phase ? "on" : ph.indexOf(p) < ph.indexOf(app.sess.phase) ? "done" : ""}" data-i18n>${names[p]}</span>`).join("");
  translateUI();
}

function updateNotes() {
  const s = app.sess, c = app.caseObj, el = $("#notes"); if (!el) return;
  const groups = [["presentation", "Presentation"], ["history", "History"], ["examination", "Examination"], ["investigations", "Investigations"],
    ["diagnosis", "Diagnosis"], ["management", "Management"], ["course", "Course"], ["outcome", "Outcome"]];
  const shown = s.ev.filter(e => s.shown.has(e.i));
  let html = `<h3 data-i18n>Case notes</h3><p class="muted small" data-i18n>Everything you uncover, verbatim from the case record.</p>`;
  for (const [k, name] of groups) {
    const items = shown.filter(e => e.s === k);
    if (items.length) html += `<h4 data-i18n>${name}</h4><ul>${items.map(e => `<li${e.c ? ' class="event"' : ""}>${esc(e.t)}</li>`).join("")}</ul>`;
  }
  if (s.tablesShown) html += c.tables.map(tableHTML).join("");
  if (s.ddx.length) html += `<h4 data-i18n>Your differentials</h4><ul>${s.ddx.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`;
  if (s.dx) html += `<h4 data-i18n>Your diagnosis</h4><p>${esc(s.dx)}</p>`;
  if (s.phase === "round" || s.phase === "debrief") {
    const drugs = drugsIn(s.course.filter(e => s.shown.has(e.i)).map(e => e.t).join(" "));
    if (drugs.length) html += `<h4 data-i18n>Medicines in this case</h4><p class="muted small" data-i18n>Doses in a case report are what that team gave that patient. Check the official label and your local formulary.</p>
      <ul class="drugs">${drugs.map(d => `<li><a target="_blank" rel="noopener" href="https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(d)}">${esc(d)} ↗ <span class="muted small">official label (DailyMed)</span></a></li>`).join("")}</ul>`;
  }
  el.innerHTML = html;
  translateUI();
}

function tableHTML(rows) {
  const [h, ...b] = rows;
  return `<div class="tbl"><table><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${b.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- dialogue
async function say(parts, extraHTML = "") {
  const lang = langOf(app.lang);
  const out = [];
  for (const p of parts) {
    let shown = p.en, warn = false, tr = null;
    if (app.lang !== "en" && app.trOK) {
      tr = await translate(p.en, "en", app.lang);
      if (tr) { shown = tr; warn = !numbersMatch(p.en, tr); }
    }
    out.push({ ...p, shown, tr, warn });
  }
  const chat = $("#chat"); if (!chat) return;
  out.forEach((p, k) => {
    const r = ROLE[p.role];
    const div = document.createElement("div");
    div.className = "msg " + r.cls;
    div.innerHTML = `<div class="who" data-i18n>${r.label}</div>
      <div class="body">${p.html ? p.html : esc(p.shown)}</div>
      ${p.tr ? `<details class="orig"><summary data-i18n>Original English</summary>${esc(p.en)}</details>` : ""}
      ${p.warn ? `<div class="numwarn" data-i18n>Numbers in this translation differ from the English. Use the English values.</div>` : ""}
      ${k === out.length - 1 ? extraHTML : ""}`;
    chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;
  app.lastSaid = out;
  wireInline();
  const speechLang = app.lang !== "en" && app.trOK && voice.hasVoice(lang.speech) ? lang.speech : "en-IN";
  await voice.speak(out.filter(p => !p.silent).map(p => ({ text: speechLang === "en-IN" ? p.en : p.shown, lang: speechLang, role: ROLE[p.role].voice })));
}

function youSaid(text, en) {
  const chat = $("#chat"); if (!chat) return;
  const div = document.createElement("div");
  div.className = "msg you";
  div.innerHTML = `<div class="who" data-i18n>You</div><div class="body">${esc(text)}</div>${en && en !== text ? `<div class="gloss">→ ${esc(en)}</div>` : ""}`;
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
}

function wireInline() {
  document.querySelectorAll("[data-self]").forEach(b => b.onclick = () => {
    const [what, val] = b.dataset.self.split(":");
    if (what === "dx") app.sess.dxSelf = val; else app.sess.planSelf = val;
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });
  const fin = $("#finish"); if (fin) fin.onclick = finishCase;
}

const join = arr => arr.map(e => e.t).join(" ");

async function handleInput(raw, spoken, fromChip) {
  const s = app.sess; if (!s) return;
  let en = raw;
  if (app.lang !== "en" && app.trOK && !fromChip) en = (await translate(raw, app.lang, "en")) || raw;
  youSaid(raw, en);
  const intent = route(en, s.phase);
  const P = [];
  switch (intent) {
    case "phi":
      P.push({ role: "senior", en: "This is a simulator. Please don't enter real patient details here." }); break;
    case "repeat":
      if (app.lastSaid.length) { await voice.speak(app.lastSaid.map(p => ({ text: p.en, lang: "en-IN", role: ROLE[p.role].voice }))); }
      return;
    case "hint": {
      const h = s.hint();
      if (h.phase === "workup") {
        const tips = [];
        if (h.leftHist > 2) tips.push("there is more in the history: ask about the presenting complaint's timeline, past illnesses, medicines, family and social history");
        if (h.leftExam.length) tips.push("examination findings are recorded for: " + h.leftExam.join(", "));
        if (h.leftInv.length) tips.push("this patient had results for: " + h.leftInv.join(", "));
        P.push({ role: "senior", en: tips.length ? "Think systematically. " + tips.map(t => t[0].toUpperCase() + t.slice(1)).join(". ") + ". When you're ready, say \"my diagnosis is …\"." : "You've covered the work-up. Commit to a diagnosis: say \"my diagnosis is …\"." });
      } else if (h.phase === "plan") P.push({ role: "senior", en: "Think about immediate stabilisation, definitive treatment, monitoring and who else you would involve. Then say \"my plan is …\"." });
      else P.push({ role: "senior", en: "Say what you would do next, or say \"next\" to see what the team did." });
      break;
    }
    case "history": {
      const r = s.askHistory(en);
      if (r.kind === "nodoc") P.push({ role: "patient", en: "That isn't documented in this patient's case record." });
      else P.push({ role: "patient", en: join(r.items) });
      break;
    }
    case "exam": {
      const r = s.examine(en);
      if (r.items.length) P.push({ role: "nurse", en: join(r.items) });
      else P.push({ role: "nurse", en: `No ${r.systems.join(" or ")} findings were recorded for this patient.` });
      if (r.available.length && !r.items.length) P.push({ role: "senior", en: "Findings are recorded for: " + r.available.join(", ") + ".", silent: false });
      break;
    }
    case "order": {
      const r = s.order(en);
      if (r.kind === "inv-unknown") { P.push({ role: "nurse", en: "Which test would you like? For example: CBC, LFT, kidney function, chest X-ray, CT, MRI, ultrasound, ECG, echo, culture or biopsy." }); break; }
      for (const x of r.results) {
        if (x.items.length) P.push({ role: "nurse", en: `${x.cat}: ` + join(x.items) });
        else P.push({ role: "nurse", en: `${x.cat}: not reported for this patient.` });
      }
      if (r.tables) P.push({ role: "nurse", en: "Here is the lab table from the case.", html: "Here is the lab table from the case." + r.tables.map(tableHTML).join(""), silent: true });
      break;
    }
    case "ddx": {
      const d = en.replace(/^.*?(differentials?( diagnos[ie]s)?( are| is|:)?|ddx( is| are|:)?|could be|rule out|possibilities( are|:)?)/i, "").trim() || en;
      s.addDdx(d);
      P.push({ role: "senior", en: `Noted your differentials: ${d}. What finding or test would separate them?` });
      break;
    }
    case "earlyplan":
      P.push({ role: "senior", en: "Hold the plan for a moment. First commit to a diagnosis: say \"my diagnosis is …\"." }); break;
    case "dx": {
      const d = en.replace(/^.*?(final diagnosis( is)?|my diagnosis( is)?|provisional diagnosis( is)?|diagnosis is|i (think|believe|feel) (it|this) (is|was)|i (think|believe) the patient has|(it'?s|this is) (a )?case of|patient (has|is suffering from)|diagnos(e|ing) (it|this) as)\s*:?/i, "").trim() || en;
      const r = s.commitDx(d);
      const v = { close: "Your answer shares the key terms of the published diagnosis.", partial: "Your answer overlaps partly with the published diagnosis.", different: "Your answer doesn't share key terms with the published diagnosis." }[r.verdict];
      P.push({ role: "senior", en: `Your diagnosis: ${d}. The published case is: ${r.title}. ${v} This term match is automatic and rough, so judge it yourself below.` });
      if (r.items.length) P.push({ role: "record", en: join(r.items) });
      if (app.caseObj.ddx && app.caseObj.ddx.length) P.push({ role: "record", en: "The authors' differential diagnosis: " + app.caseObj.ddx.join(" ") });
      P.push({ role: "senior", en: "Now your management plan. Say \"my plan is …\"." });
      s.phase = "plan";
      await say(P, selfRate("dx"));
      updateChips(); updateNotes(); return;
    }
    case "plan":
    case "planskip": {
      if (intent === "plan") {
        const pl = en.replace(/^.*?(my plan is|management plan( is)?|plan is|plan:)\s*/i, "").trim() || en;
        const r = s.commitPlan(pl);
        P.push({ role: "senior", en: `Noted your plan. ${r.drugs.length ? "Medicines you named that the team also used: " + r.drugs.join(", ") + ". " : ""}Let's round on the patient and see what the treating team actually did.` });
      } else { s.commitPlan(""); P.push({ role: "senior", en: "Let's round on the patient and see what the treating team did." }); }
      const rr = s.nextRound();
      P.push(...roundParts(rr));
      await say(P, intent === "plan" ? selfRate("plan") : "");
      updateChips(); updateNotes(); return;
    }
    case "next":
    case "decision": {
      if (intent === "decision") P.push({ role: "senior", en: "Noted. Here is what happened." });
      const rr = s.nextRound(intent === "decision" ? en : null);
      if (rr.kind === "end") { await finishCase(); return; }
      P.push(...roundParts(rr));
      break;
    }
    case "debrief":
      await finishCase(); return;
  }
  await say(P);
  updateChips(); updateNotes();
  if (s.phase === "debrief") showFinish();
}

function roundParts(rr) {
  const P = [{ role: "record", en: `Day ${rr.day}. ` + join(rr.items) }];
  if (rr.event) P.push({ role: "senior", en: "That's a change in the patient's course. What would you do now?" });
  else if (rr.done) P.push({ role: "senior", en: "That's the end of this admission. Say \"next\" for the HOD's teaching round." });
  else P.push({ role: "senior", en: "Tell me what you'd do, or say \"next\"." });
  return P;
}

function selfRate(what) {
  return `<div class="selfrate"><span data-i18n>How close were you?</span>
    <button class="btn small" data-self="${what}:right" data-i18n>Right</button>
    <button class="btn small" data-self="${what}:part" data-i18n>Partly</button>
    <button class="btn small" data-self="${what}:wrong" data-i18n>Missed</button></div>`;
}

function showFinish() {
  const chat = $("#chat");
  if (!chat || $("#finish")) return;
  const d = document.createElement("div"); d.className = "msg system";
  d.innerHTML = `<button class="btn primary" id="finish" data-i18n>Go to the HOD teaching round</button>`;
  chat.appendChild(d); chat.scrollTop = chat.scrollHeight; wireInline();
}

async function finishCase() {
  const s = app.sess, c = app.caseObj;
  if (s.finished) return; s.finished = true; s.phase = "debrief";
  const sc = s.scores();
  store.addSession(db, { id: c.id, ward: c.ward, title: c.src.title, date: new Date().toISOString(), scores: sc, dx: s.dx });
  const src = c.src;
  const cite = `${src.authors}. ${src.title}. ${src.citation}. Licence ${src.license}. https://pmc.ncbi.nlm.nih.gov/articles/${c.id}/`;
  const P = [{ role: "hod", en: "Teaching round. Points from this case's own discussion section:" }];
  if (c.pearls.length) c.pearls.forEach(p => P.push({ role: "hod", en: p }));
  else P.push({ role: "hod", en: "This report's discussion has no stated teaching points; read the full article linked below." });
  const card = `<div class="scorecard">
    <div><span data-i18n>History uncovered</span><b>${pct(sc.hist)}</b></div>
    <div><span data-i18n>Examination uncovered</span><b>${pct(sc.exam)}</b></div>
    <div><span data-i18n>Relevant tests ordered</span><b>${pct(sc.inv)}</b></div>
    <div><span data-i18n>Tests not in this case</span><b>${sc.invExtra}</b></div>
    <div><span data-i18n>Diagnosis</span><b>${pct(sc.dx)}</b></div>
    <div><span data-i18n>Plan (your rating)</span><b>${pct(sc.plan)}</b></div>
    <div><span data-i18n>Hints</span><b>${sc.hints}</b></div>
    <div><span data-i18n>Time</span><b>${Math.floor(sc.secs / 60)}m ${sc.secs % 60}s</b></div>
  </div>
  <p class="muted small" data-i18n>Scores are automatic coverage counts and your own ratings. They are a practice guide, not a validated assessment.</p>
  <p class="cite"><b data-i18n>Source</b> ${esc(src.authors)}. <a target="_blank" rel="noopener" href="https://pmc.ncbi.nlm.nih.gov/articles/${c.id}/">${esc(src.title)}</a>. ${esc(src.journal)} ${esc(src.year)}. ${src.doi ? `<a target="_blank" rel="noopener" href="https://doi.org/${esc(src.doi)}">doi:${esc(src.doi)}</a>` : ""} · ${esc(src.license)}. <span data-i18n>Case text reproduced verbatim and split into ward-round stages.</span></p>
  <div class="row"><button class="btn primary" id="again" data-i18n>Next patient, same ward</button><a class="btn" href="#/progress" data-i18n>My progress</a></div>`;
  updateChips(); updateNotes();
  await say(P, card);
  const again = $("#again"); if (again) again.onclick = () => startWard(c.ward, "any");
  void cite;
}

// ---------------------------------------------------------------- progress
async function renderProgress() {
  const w = await loadWards();
  const sm = store.summary(db);
  const names = { hist: "History", exam: "Examination", inv: "Investigations", dx: "Diagnosis", plan: "Plan" };
  const weakest = Object.entries(sm.skill).filter(([, v]) => v.avg != null).sort((a, b) => a[1].avg - b[1].avg)[0];
  shell(`
  <main class="progress">
    <h1 data-i18n>My progress</h1>
    <p class="muted" data-i18n>Stored only in this browser. Export the CSV to share with your faculty.</p>
    <div class="hero-stats">
      <div><b>${db.sessions.length}</b><span data-i18n>cases done</span></div>
      <div><b>${store.streak(db)}</b><span data-i18n>day streak</span></div>
      <div><b>${weakest ? names[weakest[0]] : "—"}</b><span data-i18n>skill to work on</span></div>
    </div>
    <h2 class="sect" data-i18n>Skills</h2>
    <div class="bars">${Object.entries(sm.skill).map(([k, v]) => `
      <div class="bar"><span data-i18n>${names[k]}</span><div class="track"><i style="width:${v.avg == null ? 0 : Math.round(v.avg * 100)}%"></i></div><b>${pct(v.avg)}</b><em>n=${v.n}</em></div>`).join("")}</div>
    <h2 class="sect" data-i18n>By ward</h2>
    <div class="bars">${w.wards.map(x => { const n = (sm.byWard[x.id] || []).length; return `
      <div class="bar"><span>${esc(x.name)}</span><div class="track"><i style="width:${Math.min(100, n * 10)}%"></i></div><b>${n}</b><em>/ ${x.count}</em></div>`; }).join("")}</div>
    <h2 class="sect" data-i18n>Recent cases</h2>
    <ul class="recent">${db.sessions.slice(-15).reverse().map(s => `<li><span class="muted small">${s.date.slice(0, 10)}</span> ${esc(s.title)} <span class="muted small">· dx ${pct(s.scores.dx)}</span></li>`).join("") || "<li class='muted' data-i18n>No cases yet.</li>"}</ul>
    <div class="row"><button class="btn" id="csv" data-i18n>Export CSV</button><button class="btn danger" id="reset" data-i18n>Reset progress</button></div>
  </main>`);
  $("#csv").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([store.toCSV(db)], { type: "text/csv" }));
    a.download = "mediorounds_progress.csv"; a.click();
  };
  $("#reset").onclick = () => { if (confirm("Delete all progress stored in this browser?")) { db.sessions = []; store.save(db); renderProgress(); } };
}

// ---------------------------------------------------------------- about
async function renderAbout() {
  const w = await loadWards();
  shell(`
  <main class="about">
    <h1 data-i18n>About MediORounds</h1>
    <h2 class="sect" data-i18n>Where the cases come from</h2>
    <p data-i18n>Every patient is a real, published case report from the PubMed Central Open Access Subset (US National Library of Medicine), licensed CC BY or CC0. The case text is reproduced word for word. It is only split into ward-round stages (history, examination, investigations, diagnosis, management, course, outcome) by fixed rules. Nothing about the patient is invented or rewritten, and every case links to its original article and authors.</p>
    <p class="muted small">${w.total.toLocaleString()} cases · ${esc(w.source)} · published ${esc(w.min_year)} onwards.</p>
    <h2 class="sect" data-i18n>How the conversation works</h2>
    <p data-i18n>When you ask a question, the site finds the sentence in the case record that answers it and reads it out. If the record does not cover it, you are told so instead of being given a made-up answer. So the same question on the same case always gets the same answer. Senior and HOD lines are fixed teaching prompts, and the HOD's teaching points are quoted from the article's own discussion.</p>
    <h2 class="sect" data-i18n>Voice and languages</h2>
    <p data-i18n>Speech recognition and speech output use your browser's built-in Web Speech features. Translation into Hindi, Marathi, Tamil, Telugu, Kannada and Malayalam uses the browser's on-device translator, where available (recent desktop Chrome or Edge). The original English is always one tap away, and any translation whose numbers differ from the English is flagged. Voice input works best in Chrome or Edge.</p>
    <h2 class="sect" data-i18n>What this is not</h2>
    <p data-i18n>This is a learning simulator, not clinical guidance. Doses in a case report are what one team gave one patient. Never enter real patient details.</p>
  </main>`);
}

render();
