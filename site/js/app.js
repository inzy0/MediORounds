import { CaseSession, route, terms } from "./engine.js";
import { Voice } from "./voice.js";
import { LANGS, langOf, translate, prepare, translatorSupported, numbersMatch } from "./i18n.js";
import { TEAM, SPEAKERS, TEAM_Q, PEER_IDEAS, speakerFor, objectives, buildQuiz, judgeAnswer, reflect,
  figureURL, figuresFor, resources } from "./teach.js";
import * as store from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
const LETTER = ["A", "B", "C", "D"];

const db = store.load();
const P0 = db.prefs;
const app = {
  wards: null, idx: {}, shards: {}, drugs: null, drugRx: null, lang: P0.lang || "en", sess: null, caseObj: null, ward: null,
  lastSaid: [], trOK: false, mode: null, teamQ: [], quiz: [], qi: 0, quizRight: 0, xpCase: 0, pharmSeen: new Set(),
  figShown: new Set(), lastActivity: Date.now(), lastNudge: 0, peerI: 0,
  set: Object.assign({ live: false, barge: false, mute: false, away: "pause", rate: 1, pharm: true, peer: true, nudge: 25, cam: false }, P0.set || {}),
};
const saveSet = () => store.setPref(db, "set", app.set);

// ---------------------------------------------------------------- voice
const voice = new Voice({
  onFinal: text => handleInput(text, true),
  onInterim: text => { const el = $("#interim"); if (el) el.textContent = text; app.lastActivity = Date.now(); },
  onState: s => {
    document.body.dataset.voice = s;
    const lab = $("#orbLabel");
    if (lab) lab.textContent = { idle: voice.canListen ? "Tap to talk" : "Voice input isn't supported in this browser. Type below.", listening: "Listening…", speaking: "Speaking · tap or talk to interrupt", thinking: "…" }[s];
    if (s !== "listening") { const el = $("#interim"); if (el) el.textContent = ""; }
    if (s === "idle") app.idleSince = Date.now();
  },
  onAway: away => {
    document.body.dataset.away = away ? "1" : "0";
    const o = $("#awayNote");
    if (o) o.textContent = away ? (app.set.away === "pause" ? "Paused while you're away. It will resume when you're back." : "You're away; the round keeps going.") : "";
  },
});
function applySettings() {
  voice.live = app.set.live; voice.bargeIn = app.set.barge; voice.muted = app.set.mute; voice.awayMode = app.set.away; voice.rate = +app.set.rate;
}
applySettings();

// classmate nudges when the student goes quiet in live mode
setInterval(() => {
  if (!app.sess || !app.set.peer || !app.set.live || voice.away || voice.state !== "listening" && voice.state !== "idle") return;
  if (!["workup", "plan", "round"].includes(app.sess.phase) || app.mode) return;
  const quiet = Date.now() - Math.max(app.lastActivity, app.idleSince || 0);
  if (quiet < app.set.nudge * 1000 || Date.now() - app.lastNudge < 45000) return;
  app.lastNudge = Date.now(); app.lastActivity = Date.now();
  say([{ role: "peer", en: peerIdea() }]);
}, 2000);

function peerIdea() {
  const h = app.sess.hint(); app.sess.hints--;                      // a nudge is not a counted hint
  if (h.phase === "workup") {
    if (h.leftExam.length) return `Shall we examine ${h.leftExam[0]}? There are findings recorded for it.`;
    if (h.leftInv.length) return `What about ${h.leftInv[0]}? I think this patient had that done.`;
  }
  if (h.phase === "plan") return "What's your plan? Think stabilise, treat the cause, monitor, and who else to involve.";
  if (h.phase === "round") return "Say \"next\" for the next ward round, or tell us what you'd do.";
  return PEER_IDEAS[app.peerI++ % PEER_IDEAS.length];
}

// ---------------------------------------------------------------- language
async function setLang(code, fromGesture) {
  app.lang = code; store.setPref(db, "lang", code);
  voice.setLang(langOf(code).speech);
  app.trOK = code === "en";
  if (code !== "en" && translatorSupported()) {
    if (fromGesture) setBanner(`Preparing ${langOf(code).name} on this device…`);
    app.trOK = await prepare(code, p => setBanner(`Downloading the ${langOf(code).name} language pack… ${Math.round(p * 100)}%`)).catch(() => false);
  }
  if (code !== "en" && !app.trOK) setBanner(`On-device ${langOf(code).name} translation isn't available in this browser (it needs a recent desktop Chrome or Edge). You can still speak in ${langOf(code).name}; replies stay in English.`, "warn");
  else if (code !== "en" && !voice.hasVoice(langOf(code).speech)) setBanner(`No ${langOf(code).name} voice is installed on this device, so replies are shown in ${langOf(code).name} and spoken in English. You can add a voice in your phone's or Windows' speech settings.`, "warn");
  else setBanner("");
  translateUI();
}
async function translateUI() {
  if (app.lang === "en" || !app.trOK) {
    document.querySelectorAll("[data-i18n]").forEach(el => { if (el.dataset.en) el.textContent = el.dataset.en; });
    return;
  }
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const en = el.dataset.en || (el.dataset.en = el.textContent);
    el.textContent = (await translate(en, "en", app.lang)) || en;
  }
  for (const el of document.querySelectorAll("[data-i18n-ph]")) {
    const en = el.dataset.enph || (el.dataset.enph = el.placeholder);
    el.placeholder = (await translate(en, "en", app.lang)) || en;
  }
}
function setBanner(text, kind = "info") { const b = $("#banner"); if (!b) return; b.textContent = text; b.hidden = !text; b.dataset.kind = kind; }

// ---------------------------------------------------------------- data
const getJSON = async u => (await fetch(u)).json();
async function loadWards() { if (!app.wards) app.wards = await getJSON("data/wards.json"); return app.wards; }
async function loadIndex(w) { if (!app.idx[w]) app.idx[w] = await getJSON(`data/cases/${w}/index.json`); return app.idx[w]; }
async function loadShard(w, k) { const key = w + "/" + k; if (!app.shards[key]) app.shards[key] = await getJSON(`data/cases/${w}/${k}.json`); return app.shards[key]; }
async function loadDrugs() {
  if (app.drugs !== null) return app.drugs;
  try {
    app.drugs = await getJSON("data/drugs.json");
    const names = [...Object.keys(app.drugs.cards), ...Object.keys(app.drugs.aliases || {})].filter(n => n.length >= 4)
      .sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    app.drugRx = new RegExp(`(?<![a-z])(${names.join("|")})(?![a-z])`, "gi");
  } catch { app.drugs = false; }
  return app.drugs;
}
function drugsIn(text) {
  if (!app.drugRx) return [];
  const out = new Set();
  for (const m of text.matchAll(app.drugRx)) { const n = m[0].toLowerCase(); out.add((app.drugs.aliases || {})[n] || n); }
  return [...out].filter(n => app.drugs.cards[n]);
}
function pickCase(index, mode) {
  const done = new Set(db.sessions.map(s => s.id));
  let pool = index.filter(c => !done.has(c.id));
  if (!pool.length) pool = index;
  if (mode === "tricky") { const t = pool.filter(c => c.t); if (t.length) pool = t; }
  if (mode === "figs") { const t = pool.filter(c => c.f); if (t.length) pool = t; }
  if (mode === "daily") { const d = new Date().toISOString().slice(0, 10); let h = 0; for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return index[h % index.length]; }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------- routing
window.addEventListener("hashchange", render);
async function render() {
  voice.interrupt(); voice.stopListening(); app.mode = null;
  const [, view, a, b] = (location.hash || "#/").split("/");
  document.body.dataset.view = view || "home";
  if (view === "case") return renderCase(a, b);
  if (view === "progress") return renderProgress();
  if (view === "review") return renderReview();
  if (view === "about") return renderAbout();
  return renderHome();
}

function shell(inner) {
  const opts = LANGS.map(l => `<option value="${l.code}" ${l.code === app.lang ? "selected" : ""}>${l.native}</option>`).join("");
  const lv = store.level(db.xp);
  const due = store.dueCards(db).length;
  $("#app").innerHTML = `
  <header class="top">
    <a class="brand" href="#/"><span class="logo" aria-hidden="true"></span>MediORounds</a>
    <nav>
      <a href="#/" data-i18n>Wards</a>
      <a href="#/review"><span data-i18n>Review</span>${due ? ` <b class="pill">${due}</b>` : ""}</a>
      <a href="#/progress" data-i18n>My progress</a>
      <a href="#/about" data-i18n>About</a>
      <span class="xp" title="Experience points">${esc(lv.name)} · ${db.xp} XP</span>
      <label class="lang"><span class="sr">Language</span><select id="lang">${opts}</select></label>
    </nav>
  </header>
  <div id="banner" hidden></div>
  ${inner}
  <div id="toasts" aria-live="polite"></div>
  <div id="lightbox" hidden><figure><img alt=""><figcaption></figcaption></figure></div>
  <footer class="foot" data-i18n>Educational simulation built from published, openly licensed case reports. Not for real patient care. Never enter real patient details.</footer>`;
  $("#lang").addEventListener("change", e => setLang(e.target.value, true));
  $("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });
  setLang(app.lang, false);
}

function toast(text, kind = "xp") {
  const t = $("#toasts"); if (!t) return;
  const d = document.createElement("div"); d.className = "toast " + kind; d.textContent = text; t.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function xp(n, why) {
  if (!n) return;
  store.addXP(db, n); app.xpCase += n;
  toast(`${n > 0 ? "+" : ""}${n} XP · ${why}`, n > 0 ? "xp" : "neg");
  const x = $(".xp"); if (x) { const lv = store.level(db.xp); x.textContent = `${lv.name} · ${db.xp} XP`; }
}

// ---------------------------------------------------------------- home
async function renderHome() {
  const w = await loadWards();
  const lv = store.level(db.xp), st = store.streak(db), due = store.dueCards(db).length;
  const prog = lv.next ? Math.round(100 * (db.xp - lv.floor) / (lv.next - lv.floor)) : 100;
  shell(`
  <main class="home">
    <section class="hero">
      <h1 data-i18n>Live voice ward rounds on real published cases</h1>
      <p class="lede" data-i18n>Talk to the patient, examine, order tests, commit a diagnosis and plan, then round with the whole team: surgeon, neurologist, physiotherapist, ICU, pharmacist and more. Every finding is quoted word for word from a published case report.</p>
      <div class="levelbar"><div><b>${esc(lv.name)}</b> · ${db.xp} XP${lv.next ? ` · <span class="muted">${lv.next - db.xp} XP to ${esc(lv.nextName)}</span>` : ""}</div><div class="track"><i style="width:${prog}%"></i></div></div>
      <div class="hero-stats">
        <div><b>${w.total.toLocaleString()}</b><span data-i18n>real cases</span></div>
        <div><b>${w.wards.length}</b><span data-i18n>wards</span></div>
        <div><b>${st}</b><span data-i18n>day streak</span></div>
        <div><b>${db.badges.length}</b><span data-i18n>badges</span></div>
        ${due ? `<a class="stat-link" href="#/review"><b>${due}</b><span data-i18n>cards to review</span></a>` : ""}
      </div>
      <div class="quick">
        <button class="btn primary" id="daily" data-i18n>Case of the day</button>
        <button class="btn" id="mixed" data-i18n>Random ward</button>
        <button class="btn" id="tricky" data-i18n>Tricky case</button>
        <button class="btn" id="figs" data-i18n>Case with images</button>
      </div>
    </section>
    <h2 class="sect" data-i18n>Choose a ward</h2>
    <section class="wards">
      ${w.wards.map(x => `
        <article class="ward ${x.collection ? "feature" : ""}" data-ward="${x.id}">
          <h3>${esc(x.name)}</h3>
          <p class="blurb">${esc(x.blurb || "")}</p>
          <p class="muted small">${x.count.toLocaleString()} <span data-i18n>cases</span>${(store.summary(db).byWard[x.id] || []).length ? ` · ${(store.summary(db).byWard[x.id] || []).length} <span data-i18n>done</span>` : ""}</p>
          <div class="row">
            <button class="btn small primary" data-go="${x.id}" data-mode="any" data-i18n>Take a bed</button>
            <button class="btn small" data-go="${x.id}" data-mode="tricky" data-i18n>Tricky</button>
          </div>
        </article>`).join("")}
    </section>
  </main>`);
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => startWard(b.dataset.go, b.dataset.mode)));
  const rw = () => w.wards[Math.floor(Math.random() * w.wards.length)].id;
  $("#mixed").onclick = () => startWard(rw(), "any");
  $("#tricky").onclick = () => startWard(rw(), "tricky");
  $("#figs").onclick = () => startWard(rw(), "figs");
  $("#daily").onclick = () => { const d = new Date().getDate(); startWard(w.wards[d % w.wards.length].id, "daily"); };
}

async function startWard(id, mode) {
  const index = await loadIndex(id);
  const c = pickCase(index, mode);
  location.hash = `#/case/${id}/${c.id}`;
}

// ---------------------------------------------------------------- case
async function renderCase(wardId, caseId) {
  const w = await loadWards();
  const index = await loadIndex(wardId);
  const row = index.find(x => x.id === caseId);
  if (!row) { location.hash = "#/"; return; }
  const shard = await loadShard(wardId, row.k);
  const c = shard.find(x => x.id === caseId);
  await loadDrugs();
  app.caseObj = c; app.ward = w.wards.find(x => x.id === wardId); app.shardTitles = shard.map(x => x.src.title);
  app.sess = new CaseSession(c);
  Object.assign(app, { mode: null, teamQ: [], quiz: [], qi: 0, quizRight: 0, xpCase: 0, pharmSeen: new Set(), figShown: new Set(), lastActivity: Date.now(), lastNudge: Date.now() });
  const bed = 1 + (parseInt(c.id.replace(/\D/g, ""), 10) % 24);
  const team = (c.sps || []).filter(s => SPEAKERS.includes(s));
  shell(`
  <main class="round">
    <section class="stage">
      <div class="casebar">
        <div><b>${esc(app.ward.name)}</b> · <span data-i18n>Bed</span> ${bed} · ${esc(c.age || "age not stated")}${c.sex ? " · " + c.sex : ""}${c.tricky ? ' · <span class="tag">tricky</span>' : ""}</div>
        <div class="phases" id="phases"></div>
      </div>
      <div class="teamstrip" aria-label="Team on this round">${["senior", "nurse", ...team.slice(0, 6), drugsIn(c.events.map(e => e.t).join(" ")).length ? "pharmacist" : null, "peer", "hod"].filter(Boolean)
        .map(r => `<span class="av" style="--c:${TEAM[r].color}" title="${esc(TEAM[r].label)}">${esc(TEAM[r].short)}</span>`).join("")}</div>
      <div id="chat" class="chat" aria-live="polite"></div>
      <div class="dock">
        <div id="awayNote" class="awaynote"></div>
        <div id="interim" class="interim"></div>
        <div class="orbrow">
          <button id="orb" class="orb" aria-label="Talk"><span></span></button>
          <div class="orbside">
            <div id="orbLabel" class="orblabel">Tap to talk</div>
            <label class="switch"><input type="checkbox" id="s_live" ${app.set.live ? "checked" : ""}><span data-i18n>Live conversation (hands-free)</span></label>
            <button class="linkbtn" id="openSet" data-i18n>Voice & round settings</button>
          </div>
        </div>
        <div class="chips" id="chips"></div>
        <form id="say" class="say"><input id="text" autocomplete="off" placeholder="Speak or type to the patient and team…" data-i18n-ph><button class="btn primary" data-i18n>Send</button></form>
      </div>
    </section>
    <aside class="notes" id="notes"></aside>
  </main>
  <dialog id="settings">
    <form method="dialog">
      <h3 data-i18n>Voice & round settings</h3>
      <label class="switch"><input type="checkbox" id="s_barge" ${app.set.barge ? "checked" : ""}><span data-i18n>Interrupt by speaking (use headphones)</span></label>
      <label class="switch"><input type="checkbox" id="s_mute" ${app.set.mute ? "checked" : ""}><span data-i18n>Mute spoken replies</span></label>
      <label class="switch"><input type="checkbox" id="s_pharm" ${app.set.pharm ? "checked" : ""}><span data-i18n>Pharmacist comments on medicines</span></label>
      <label class="switch"><input type="checkbox" id="s_peer" ${app.set.peer ? "checked" : ""}><span data-i18n>Classmate nudges when I'm quiet</span></label>
      <label><span data-i18n>Nudge after (seconds of silence)</span> <input type="number" id="s_nudge" min="10" max="120" value="${app.set.nudge}"></label>
      <label><span data-i18n>When I look away for 5 seconds</span>
        <select id="s_away"><option value="pause" ${app.set.away === "pause" ? "selected" : ""}>Pause the audio</option><option value="keep" ${app.set.away === "keep" ? "selected" : ""}>Keep it going</option></select></label>
      <label class="switch"><input type="checkbox" id="s_cam" ${app.set.cam ? "checked" : ""}><span data-i18n>Use the camera to notice when I look away (on this device only)</span></label>
      <video id="camv" muted playsinline hidden></video><div id="camst" class="muted small"></div>
      <label><span data-i18n>Speaking speed</span>
        <select id="s_rate">${[0.8, 0.9, 1, 1.15, 1.3, 1.5].map(r => `<option value="${r}" ${+app.set.rate === r ? "selected" : ""}>${r}×</option>`).join("")}</select></label>
      <div class="row"><button class="btn primary" data-i18n>Done</button></div>
    </form>
  </dialog>`);
  wireCaseUI();
  updateChips(); updateNotes();
  const obj = objectives(app.sess);
  await say([
    { role: "senior", en: `Good morning. New admission in bed ${bed}. Take a focused history, examine, order what you need, then tell me your diagnosis. Today's learning objectives are on screen. Say "hint" any time.`,
      html: `Good morning. New admission in bed ${bed}. Take a focused history, examine, order what you need, then tell me your diagnosis. Say <b>"hint"</b> any time.<div class="objectives"><b data-i18n>Learning objectives</b><ol>${obj.map(o => `<li>${esc(o)}</li>`).join("")}</ol></div>` },
    { role: "patient", en: app.sess.opening.t },
  ]);
}

function wireCaseUI() {
  $("#orb").onclick = () => { app.lastActivity = Date.now(); voice.canListen ? voice.toggle() : $("#text").focus(); };
  $("#s_live").onchange = e => { app.set.live = e.target.checked; saveSet(); applySettings(); if (app.set.live && voice.state === "idle") voice.listen(); };
  $("#openSet").onclick = () => $("#settings").showModal();
  const bind = (id, key, conv = v => v) => { $(id).onchange = e => { app.set[key] = conv(e.target.type === "checkbox" ? e.target.checked : e.target.value); saveSet(); applySettings(); }; };
  bind("#s_barge", "barge"); bind("#s_mute", "mute"); bind("#s_pharm", "pharm"); bind("#s_peer", "peer");
  bind("#s_nudge", "nudge", v => Math.max(10, Math.min(120, +v || 25))); bind("#s_away", "away"); bind("#s_rate", "rate", v => +v);
  $("#s_mute").addEventListener("change", () => { if (app.set.mute) voice.interrupt(); });
  $("#s_cam").onchange = async e => {
    app.set.cam = e.target.checked; saveSet();
    if (app.set.cam) {
      $("#camst").textContent = "Starting the camera (on-device face detection, nothing is uploaded)…";
      const ok = await voice.startPresence($("#camv"), (seen, err) => {
        $("#camst").textContent = err ? "Camera not available: " + (err.message || err) : seen ? "Face seen ✓" : "No face seen";
      });
      if (!ok) { app.set.cam = false; saveSet(); e.target.checked = false; }
    } else { voice.stopPresence(); $("#camst").textContent = ""; }
  };
  if (app.set.cam && !voice.presence) $("#s_cam").dispatchEvent(new Event("change"));
  $("#say").addEventListener("submit", e => { e.preventDefault(); const t = $("#text").value.trim(); if (t) { $("#text").value = ""; handleInput(t, false); } });
}

const CHIPS = {
  workup: [["Presenting complaint", "What brought you here and since when?"], ["Past history", "Any past medical history or previous illness?"],
    ["Drug history", "What medications are you taking?"], ["Family & social", "Any family history, smoking or alcohol?"],
    ["Vitals", "Check vitals"], ["General exam", "General examination"], ["Systemic exam", "Examine chest, heart, abdomen and CNS"],
    ["Local exam", "Local examination"], ["Bloods", "Order CBC and biochemistry"], ["Imaging", "Order X-ray, CT, MRI and ultrasound"],
    ["Biopsy / culture", "Send biopsy, histopathology and culture"], ["Differentials", "My differentials are "], ["Diagnosis", "My diagnosis is "], ["Hint", "hint"]],
  plan: [["Plan", "My plan is "], ["Skip to rounds", "next"], ["Hint", "hint"]],
  round: [["Next round", "next"], ["My decision", "I would "], ["Hint", "hint"]],
  team: [["Skip", "skip"]],
  quiz: [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]],
  reflect: [["Skip", "skip"]],
  debrief: [],
};
const PHASE_NAMES = { workup: "Work-up", plan: "Plan", round: "Ward rounds", team: "Team review", teach: "HOD & quiz", debrief: "Debrief" };
function curPhase() { return app.mode === "team" ? "team" : (app.mode === "quiz" || app.mode === "reflect") ? "teach" : app.sess.finished ? "debrief" : app.sess.phase; }
function updateChips() {
  const el = $("#chips"); if (!el) return;
  const key = app.mode || app.sess.phase;
  el.innerHTML = (CHIPS[key] || []).map(([l, q]) => `<button class="chip" data-q="${esc(q)}" data-i18n>${esc(l)}</button>`).join("");
  el.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
    const q = b.dataset.q;
    if (q.endsWith(" ")) { const t = $("#text"); t.value = q; t.focus(); } else handleInput(q, false, true);
  }));
  const ph = ["workup", "plan", "round", "team", "teach", "debrief"], cur = curPhase();
  $("#phases").innerHTML = ph.map(p => `<span class="ph ${p === cur ? "on" : ph.indexOf(p) < ph.indexOf(cur) ? "done" : ""}" data-i18n>${PHASE_NAMES[p]}</span>`).join("");
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
  if (app.figShown.size) html += `<h4 data-i18n>Images</h4>` + figGrid([...app.figShown]);
  if (s.ddx.length) html += `<h4 data-i18n>Your differentials</h4><ul>${s.ddx.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`;
  if (s.dx) html += `<h4 data-i18n>Your diagnosis</h4><p>${esc(s.dx)}</p>`;
  if (app.pharmSeen.size) html += `<h4 data-i18n>Medicines (official label)</h4>` + [...app.pharmSeen].map(drugCard).join("");
  if (s.finished) html += `<h4 data-i18n>Learn more (free, open resources)</h4><ul class="res">${resources(c).map(([l, u]) => `<li><a target="_blank" rel="noopener" href="${esc(u)}">${esc(l)} ↗</a></li>`).join("")}</ul>`;
  el.innerHTML = html;
  wireFigs(el);
  translateUI();
}

function tableHTML(rows) {
  const [h, ...b] = rows;
  return `<div class="tbl"><table><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${b.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function figGrid(ids) {
  const c = app.caseObj;
  return `<div class="figs">${ids.map(i => `<button class="fig" data-fig="${i}"><img loading="lazy" src="${figureURL(c, i)}" alt="${esc((c.figs.c[i] || "Figure " + (i + 1)).slice(0, 120))}"><span>${esc(c.figs.c[i] ? c.figs.c[i].slice(0, 90) + (c.figs.c[i].length > 90 ? "…" : "") : "Figure " + (i + 1))}</span></button>`).join("")}</div>
    <p class="muted small">Figures: ${esc(c.src.authors)}, ${esc(c.src.journal)} ${esc(c.src.year)}, ${esc(c.src.license)}.</p>`;
}
function wireFigs(root) {
  root.querySelectorAll("[data-fig]").forEach(b => b.onclick = () => {
    const i = +b.dataset.fig, c = app.caseObj, lb = $("#lightbox");
    lb.querySelector("img").src = figureURL(c, i); lb.querySelector("figcaption").textContent = c.figs.c[i] || `Figure ${i + 1} from the article`;
    lb.hidden = false;
  });
}
function drugCard(n) {
  const d = app.drugs && app.drugs.cards[n]; if (!d) return "";
  const row = (k, l) => d[k] ? `<p><b>${l}:</b> ${esc(d[k])}</p>` : "";
  return `<details class="drug"><summary><b>${esc(n)}</b>${d.brand ? ` <span class="muted small">(${esc(d.brand)})</span>` : ""}${d.cls.length ? ` · <span class="small">${esc(d.cls.join(", "))}</span>` : ""}</summary>
    ${d.moa.length ? `<p><b>Mechanism class:</b> ${esc(d.moa.join(", "))}</p>` : ""}${row("mech", "Mechanism")}${row("ind", "Indications")}${row("box", "Boxed warning")}
    ${row("ci", "Contraindications")}${row("ae", "Adverse reactions")}${row("ddi", "Interactions")}${row("preg", "Pregnancy")}
    <p class="muted small">Quoted from the US label${d.route ? " (" + esc(d.route) + ")" : ""}, effective ${esc(d.eff)}. <a target="_blank" rel="noopener" href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${esc(d.sid)}">Full label on DailyMed ↗</a> Doses in the case are what that team gave that patient; check your local formulary.</p></details>`;
}

// ---------------------------------------------------------------- dialogue
async function say(parts, extraHTML = "") {
  const lang = langOf(app.lang);
  const out = [];
  for (const p of parts) {
    let shown = p.en, warn = false, tr = null;
    if (app.lang !== "en" && app.trOK) { tr = await translate(p.en, "en", app.lang); if (tr) { shown = tr; warn = !numbersMatch(p.en, tr); } }
    out.push({ ...p, shown, tr, warn });
  }
  const chat = $("#chat"); if (!chat) return;
  out.forEach((p, k) => {
    const r = TEAM[p.role] || TEAM.record;
    const div = document.createElement("div");
    div.className = "msg r-" + p.role;
    div.style.setProperty("--c", r.color);
    div.innerHTML = `<div class="who"><span class="av sm" style="--c:${r.color}">${esc(r.short)}</span><span data-i18n>${esc(r.label)}</span></div>
      <div class="body">${p.html && !p.tr ? p.html : esc(p.shown)}</div>
      ${p.tr && p.html ? `<div class="body extra">${p.html}</div>` : ""}
      ${p.tr ? `<details class="orig"><summary data-i18n>Original English</summary>${esc(p.en)}</details>` : ""}
      ${p.warn ? `<div class="numwarn" data-i18n>Numbers in this translation differ from the English. Use the English values.</div>` : ""}
      ${k === out.length - 1 ? extraHTML : ""}`;
    chat.appendChild(div);
    wireFigs(div);
  });
  chat.scrollTop = chat.scrollHeight;
  app.lastSaid = out;
  wireInline();
  const speechLang = app.lang !== "en" && app.trOK && voice.hasVoice(lang.speech) ? lang.speech : "en-IN";
  await voice.speak(out.filter(p => !p.silent).map(p => ({ text: speechLang === "en-IN" ? (p.speak || p.en) : p.shown, lang: speechLang, role: p.role })));
  app.lastActivity = Date.now();
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
  document.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => handleInput(b.dataset.opt, false, true));
  const again = $("#again"); if (again) again.onclick = () => startWard(app.caseObj.ward === "mdt" ? "mdt" : app.ward.id, "any");
}

const join = arr => arr.map(e => e.t).join(" ");
const group = (items, phase) => {                 // consecutive sentences by the same speaker -> one message
  const out = [];
  for (const e of items) {
    const r = speakerFor(e, phase);
    if (out.length && out[out.length - 1].role === r) out[out.length - 1].items.push(e); else out.push({ role: r, items: [e] });
  }
  return out;
};

async function handleInput(raw, spoken, fromChip) {
  const s = app.sess; if (!s) return;
  app.lastActivity = Date.now();
  let en = raw;
  if (app.lang !== "en" && app.trOK && !fromChip) en = (await translate(raw, app.lang, "en")) || raw;
  youSaid(raw, en);
  if (app.mode === "team") return teamAnswer(en);
  if (app.mode === "quiz") return quizAnswer(en);
  if (app.mode === "reflect") return reflectAnswer(en);
  if (s.finished) { await say([{ role: "senior", en: "This case is finished. Tap \"Next patient\" for a new one." }]); return; }
  const intent = route(en, s.phase);
  const P = [];
  switch (intent) {
    case "phi": P.push({ role: "senior", en: "This is a simulator. Please don't enter real patient details here." }); break;
    case "repeat":
      if (app.lastSaid.length) await voice.speak(app.lastSaid.map(p => ({ text: p.speak || p.en, lang: "en-IN", role: p.role })));
      return;
    case "hint": {
      const h = s.hint(); const lvl = Math.min(3, s.hints);
      if (h.phase === "workup") {
        if (lvl === 1) P.push({ role: "senior", en: "Work systematically: complaint and timeline, past history, medicines, family and social history, then vitals and the relevant system." });
        else if (lvl === 2) P.push({ role: "senior", en: [h.leftExam.length ? "Examination findings are recorded for: " + h.leftExam.join(", ") + "." : "", h.leftInv.length ? "This patient had: " + h.leftInv.join(", ") + "." : ""].join(" ").trim() || "You've covered the work-up. Commit to a diagnosis." });
        else { const fig = (s.c.sps || []).filter(x => SPEAKERS.includes(x)).slice(0, 3); P.push({ role: "senior", en: `Bigger hint: the specialists most involved in this case are ${fig.map(x => TEAM[x].label.toLowerCase()).join(", ") || "the medical team"}. When you're ready, say "my diagnosis is …".` }); }
        xp(-2, "hint");
      } else if (h.phase === "plan") P.push({ role: "senior", en: "Think: immediate stabilisation, treating the cause, monitoring, medicines and their risks, and who else you'd involve. Then say \"my plan is …\"." });
      else P.push({ role: "senior", en: "Say what you would do next, or say \"next\" to see what the team did." });
      break;
    }
    case "history": {
      const r = s.askHistory(en);
      if (r.kind === "nodoc") P.push({ role: "patient", en: "That isn't documented in this patient's case record." });
      else { P.push({ role: "patient", en: join(r.items) }); if (r.fresh) xp(3 * r.fresh, "history"); }
      break;
    }
    case "exam": {
      const r = s.examine(en);
      if (r.items.length) { P.push({ role: "nurse", en: join(r.items) }); if (r.fresh) xp(3 * r.fresh, "examination"); }
      else P.push({ role: "nurse", en: `No ${r.systems.join(" or ")} findings were recorded for this patient.` });
      if (!r.items.length && r.available.length) P.push({ role: "senior", en: "Findings are recorded for: " + r.available.join(", ") + "." });
      break;
    }
    case "order": {
      const r = s.order(en);
      if (r.kind === "inv-unknown") { P.push({ role: "nurse", en: "Which test would you like? For example: CBC, LFT, kidney function, chest X-ray, CT, MRI, ultrasound, ECG, echo, culture or biopsy." }); break; }
      const cats = [];
      for (const x of r.results) {
        if (x.items.length) {
          cats.push(x.cat);
          for (const g of group(x.items, "work")) P.push({ role: g.role, en: `${x.cat}: ` + join(g.items) });
          if (x.fresh) xp(8, x.cat);
        } else { P.push({ role: "nurse", en: `${x.cat}: not reported for this patient.` }); xp(-1, "test not in this case"); }
      }
      const figs = figuresFor(s.c, cats).filter(i => !app.figShown.has(i));
      if (figs.length) { figs.forEach(i => app.figShown.add(i)); P.push({ role: "radiologist", en: "Here are the images from the case.", html: "Here are the images from the case." + figGrid(figs), speak: "Here are the images from the case." }); }
      if (r.tables) P.push({ role: "nurse", en: "Here is the lab table from the case.", html: "Here is the lab table from the case." + r.tables.map(tableHTML).join(""), speak: "Here is the lab table from the case." });
      break;
    }
    case "ddx": {
      const d = en.replace(/^.*?(differentials?( diagnos[ie]s)?( are| is|:)?|ddx( is| are|:)?|could be|rule out|possibilities( are|:)?)/i, "").trim() || en;
      s.addDdx(d); xp(5, "differentials");
      P.push({ role: "senior", en: `Noted your differentials: ${d}. What finding or test would separate them?` });
      break;
    }
    case "earlyplan": P.push({ role: "senior", en: "Hold the plan a moment. First commit to a diagnosis: say \"my diagnosis is …\"." }); break;
    case "dx": {
      const d = en.replace(/^.*?(final diagnosis( is)?|my diagnosis( is)?|provisional diagnosis( is)?|diagnosis is|i (think|believe|feel) (it|this) (is|was)|i (think|believe) the patient has|(it'?s|this is) (a )?case of|patient (has|is suffering from)|diagnos(e|ing) (it|this) as)\s*:?/i, "").trim() || en;
      const r = s.commitDx(d);
      const v = { close: "Your answer shares the key terms of the published diagnosis.", partial: "Your answer overlaps partly with the published diagnosis.", different: "Your answer doesn't share key terms with the published diagnosis." }[r.verdict];
      xp({ close: 30, partial: 15, different: 0 }[r.verdict], "diagnosis");
      if (r.verdict === "close") celebrate();
      P.push({ role: "hod", en: `Your diagnosis: ${d}. The published case is: ${r.title}. ${v} The term match is automatic and rough, so rate yourself below.` });
      if (r.items.length) for (const g of group(r.items, "round")) P.push({ role: g.role, en: join(g.items) });
      if (app.caseObj.ddx && app.caseObj.ddx.length) P.push({ role: "senior", en: "The authors' differential diagnosis: " + app.caseObj.ddx.join(" ") });
      P.push({ role: "senior", en: "Now your management plan. Say \"my plan is …\"." });
      await say(P, selfRate("dx")); updateChips(); updateNotes(); return;
    }
    case "plan":
    case "planskip": {
      if (intent === "plan") {
        const pl = en.replace(/^.*?(my plan is|management plan( is)?|plan is|plan:)\s*/i, "").trim() || en;
        s.commitPlan(pl); xp(15, "plan");
        const named = drugsIn(pl), used = drugsIn(join(s.course));
        const both = named.filter(n => used.includes(n));
        P.push({ role: "senior", en: `Noted your plan. ${both.length ? "Medicines you named that the team also used: " + both.join(", ") + ". " : ""}Let's round on the patient with the team and see what was actually done.` });
      } else { s.commitPlan(""); P.push({ role: "senior", en: "Let's round on the patient with the team." }); }
      P.push(...roundParts(s.nextRound()));
      await say(P, intent === "plan" ? selfRate("plan") : ""); updateChips(); updateNotes(); return;
    }
    case "next":
    case "decision": {
      if (intent === "decision") { P.push({ role: "senior", en: "Noted. Here is what happened." }); xp(5, "decision"); }
      const rr = s.nextRound(intent === "decision" ? en : null);
      if (rr.kind === "end") { await startTeam(); return; }
      P.push(...roundParts(rr));
      break;
    }
    case "debrief": await startTeam(); return;
  }
  await say(P);
  updateChips(); updateNotes();
  if (s.phase === "debrief" && !app.mode && !s.finished) await startTeam();
}

function roundParts(rr) {
  const P = [];
  group(rr.items, "round").forEach((g, k) => P.push({ role: g.role, en: (k === 0 ? `Day ${rr.day}. ` : "") + join(g.items) }));
  if (app.set.pharm && app.drugs) {
    const fresh = drugsIn(join(rr.items)).filter(n => !app.pharmSeen.has(n)).slice(0, 2);
    for (const n of fresh) {
      app.pharmSeen.add(n);
      const d = app.drugs.cards[n];
      const line = `${n}${d.cls.length ? ", " + d.cls[0] : ""}.${d.box ? " It carries a boxed warning." : ""} The label card is in your notes.`;
      P.push({ role: "pharmacist", en: line, html: esc(line) + drugCard(n) });
    }
  }
  if (rr.event) P.push({ role: "senior", en: "That's a change in the patient's course. What would you do now?" });
  else if (rr.done) P.push({ role: "senior", en: "That's the end of the admission. Say \"next\" for the team review." });
  else P.push({ role: "senior", en: "Tell me what you'd do, or say \"next\"." });
  return P;
}

function selfRate(what) {
  return `<div class="selfrate"><span data-i18n>How close were you?</span>
    <button class="btn small" data-self="${what}:right" data-i18n>Right</button>
    <button class="btn small" data-self="${what}:part" data-i18n>Partly</button>
    <button class="btn small" data-self="${what}:wrong" data-i18n>Missed</button></div>`;
}
function celebrate() {
  const c = document.createElement("div"); c.className = "confetti";
  for (let i = 0; i < 24; i++) { const s = document.createElement("i"); s.style.setProperty("--x", Math.random() * 100 + "vw"); s.style.setProperty("--d", (0.6 + Math.random()) + "s"); s.style.setProperty("--h", Math.floor(Math.random() * 360)); c.appendChild(s); }
  document.body.appendChild(c); setTimeout(() => c.remove(), 2200);
}

// ---------------------------------------------------------------- team review (holistic, multidisciplinary)
async function startTeam() {
  const s = app.sess, c = app.caseObj;
  s.phase = "debrief";
  const team = (c.sps || []).filter(x => SPEAKERS.includes(x) && x !== "pathologist");
  if (app.pharmSeen.size || drugsIn(join(s.ev)).length) team.push("pharmacist");
  app.teamQ = team.slice(0, 5);
  if (!app.teamQ.length) return startTeaching();
  app.mode = "team"; updateChips();
  await say([{ role: "hod", en: `Before the teaching round, the team will each ask you one question. ${app.teamQ.map(r => TEAM[r].label).join(", ")}. Answer in your own words, or say "skip".` }]);
  await askTeam();
}
async function askTeam() {
  const r = app.teamQ[0];
  if (!r) { app.mode = null; return startTeaching(); }
  await say([{ role: r, en: TEAM_Q[r] }]);
}
async function teamAnswer(en) {
  const r = app.teamQ.shift(); const s = app.sess;
  const skip = /^\s*(skip|pass|next|don'?t know|no idea)\s*$/i.test(en);
  const P = [];
  let mine;
  if (r === "pharmacist") mine = [...app.pharmSeen].concat(drugsIn(join(s.ev))).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  else mine = s.ev.filter(e => (e.sp || []).includes(r)).slice(0, 3);
  if (!skip) xp(5, TEAM[r].label + " question");
  if (r === "pharmacist") P.push({ role: r, en: mine.length ? `In this case: ${mine.join(", ")}. Check each label card in your notes for adverse effects and interactions.` : "No labelled medicines were matched in this case." });
  else P.push({ role: r, en: mine.length ? "From the case: " + join(mine) : "The case record has little from my side." });
  await say(P);
  await askTeam();
}

// ---------------------------------------------------------------- HOD teaching, quiz, reflection
async function startTeaching() {
  const c = app.caseObj, s = app.sess;
  app.mode = "quiz"; updateChips();
  const P = [{ role: "hod", en: "Teaching round. The key points, from this case's own article:" }];
  if (c.pearls.length) c.pearls.forEach(p => P.push({ role: "hod", en: p }));
  else P.push({ role: "hod", en: "This report states no explicit teaching points; the full article is in your resources." });
  const rest = c.figs ? c.figs.i.map((_, i) => i).filter(i => !app.figShown.has(i)) : [];
  if (rest.length) { rest.forEach(i => app.figShown.add(i)); P.push({ role: "radiologist", en: "All the figures from the article.", html: "All the figures from the article." + figGrid(rest), speak: "All the figures from the article are on screen." }); }
  await say(P);
  app.quiz = buildQuiz(s, app.drugs || null, app.shardTitles); app.qi = 0; app.quizRight = 0;
  if (!app.quiz.length) return startReflect();
  await say([{ role: "senior", en: `Quick quiz: ${app.quiz.length} questions. Say or tap A, B, C or D.` }]);
  await askQuiz();
}
async function askQuiz() {
  const q = app.quiz[app.qi];
  if (!q) return startReflect();
  const opts = q.options.map((o, i) => `<button class="opt" data-opt="${LETTER[i]}"><b>${LETTER[i]}</b> ${esc(o)}</button>`).join("");
  await say([{ role: "senior", en: `Question ${app.qi + 1}. ${q.stem}`, html: `<b>Question ${app.qi + 1}.</b> ${esc(q.stem)}<div class="opts">${opts}</div>`,
    speak: `Question ${app.qi + 1}. ${q.stem.replace("_____", "blank")}. ` + q.options.map((o, i) => `${LETTER[i]}: ${o}.`).join(" ") }]);
}
async function quizAnswer(en) {
  const q = app.quiz[app.qi];
  const j = judgeAnswer(q, en);
  if (!j.pick) { await say([{ role: "senior", en: "Say A, B, C or D, or tap an option." }]); return; }
  if (j.correct) { app.quizRight++; xp(10, "quiz"); await say([{ role: "senior", en: `Correct: ${q.answer}.` }]); }
  else {
    store.addCard(db, { case: app.caseObj.id, ward: app.caseObj.ward, stem: q.stem, options: q.options, answer: q.answer, src: q.src });
    await say([{ role: "hod", en: `Not quite. The answer is ${q.answer}. From the case: ${q.src}`, speak: `Not quite. The answer is ${q.answer}.` },
      { role: "senior", en: "I've added this to your review deck for tomorrow." }]);
  }
  app.qi++;
  await askQuiz();
}
async function startReflect() {
  app.mode = "reflect"; updateChips();
  await say([{ role: "hod", en: "Last question, and the most important one: what did you learn from this patient? Tell me in a sentence or two." }]);
}
async function reflectAnswer(en) {
  const s = app.sess;
  const skip = /^\s*(skip|pass|nothing)\s*$/i.test(en);
  const P = [];
  if (!skip) {
    const r = reflect(en, s);
    db.reflections.push({ date: new Date().toISOString(), case: s.c.id, title: s.c.src.title, text: en }); store.save(db);
    app.reflection = en;
    xp(15 + (r.hit.length ? 10 : 0), "reflection");
    if (r.hit.length) P.push({ role: "hod", en: "Good. You picked up this point from the article: " + r.hit[0] });
    else P.push({ role: "hod", en: "Thank you. Your reflection doesn't match the article's stated teaching points by its key words, which doesn't make it wrong." });
    if (r.miss.length) P.push({ role: "hod", en: "One more to take away: " + r.miss[0] });
    if (!r.titleHit) P.push({ role: "senior", en: `Remember the diagnosis by name: ${s.c.src.title}.` });
  }
  app.mode = null;
  await say(P.length ? P : [{ role: "hod", en: "All right." }]);
  await finishCase();
}

async function finishCase() {
  const s = app.sess, c = app.caseObj;
  if (s.finished) return; s.finished = true; s.phase = "debrief";
  const sc = s.scores(); sc.quiz = app.quiz.length ? app.quizRight / app.quiz.length : null;
  xp(20, "case finished");
  store.addSession(db, { id: c.id, ward: c.ward, home: c.home || c.ward, title: c.src.title, date: new Date().toISOString(), scores: sc, dx: s.dx, xp: app.xpCase, reflection: app.reflection || "" });
  const got = [];
  const n = db.sessions.length, st = store.streak(db), wardsDone = new Set(db.sessions.map(x => x.home || x.ward));
  const tryB = id => { const b = store.award(db, id); if (b) got.push(b); };
  tryB("first"); if (n >= 5) tryB("five"); if (n >= 25) tryB("twentyfive"); if (st >= 3) tryB("streak3"); if (st >= 7) tryB("streak7");
  if (sc.dx === 1) tryB("dx"); if (app.quiz.length && app.quizRight === app.quiz.length) tryB("quiz");
  if (c.ward === "mdt") tryB("mdt"); if ((c.home || c.ward) === "icu") tryB("icu"); if ((c.home || c.ward) === "rehab") tryB("rehab");
  if ((c.home || c.ward) === "unique" || c.tricky) tryB("rare"); if (app.reflection) tryB("reflect");
  if (app.wards && app.wards.wards.filter(w => !w.collection).every(w => wardsDone.has(w.id))) tryB("allwards");
  got.forEach(b => toast("🏅 " + b[0], "badge"));
  const src = c.src;
  const card = `<div class="scorecard">
    <div><span data-i18n>History uncovered</span><b>${pct(sc.hist)}</b></div>
    <div><span data-i18n>Examination uncovered</span><b>${pct(sc.exam)}</b></div>
    <div><span data-i18n>Relevant tests ordered</span><b>${pct(sc.inv)}</b></div>
    <div><span data-i18n>Tests not in this case</span><b>${sc.invExtra}</b></div>
    <div><span data-i18n>Diagnosis</span><b>${pct(sc.dx)}</b></div>
    <div><span data-i18n>Plan (your rating)</span><b>${pct(sc.plan)}</b></div>
    <div><span data-i18n>Quiz</span><b>${pct(sc.quiz)}</b></div>
    <div><span data-i18n>XP this case</span><b>${app.xpCase}</b></div>
    <div><span data-i18n>Hints</span><b>${sc.hints}</b></div>
    <div><span data-i18n>Time</span><b>${Math.floor(sc.secs / 60)}m ${sc.secs % 60}s</b></div>
  </div>
  ${got.length ? `<p class="badges-new">${got.map(b => `<span class="badge">🏅 ${esc(b[0])}</span>`).join(" ")}</p>` : ""}
  <p class="muted small" data-i18n>Scores are automatic coverage counts, quiz results and your own ratings. They are a practice guide, not a validated assessment.</p>
  <p class="cite"><b data-i18n>Source</b> ${esc(src.authors)}. <a target="_blank" rel="noopener" href="https://pmc.ncbi.nlm.nih.gov/articles/${c.id}/">${esc(src.title)}</a>. ${esc(src.journal)} ${esc(src.year)}. ${src.doi ? `<a target="_blank" rel="noopener" href="https://doi.org/${esc(src.doi)}">doi:${esc(src.doi)}</a>` : ""} · ${esc(src.license)}. <span data-i18n>Case text reproduced verbatim and split into ward-round stages.</span></p>
  <div class="row"><button class="btn primary" id="again" data-i18n>Next patient</button><a class="btn" href="#/review" data-i18n>Review deck</a><a class="btn" href="#/progress" data-i18n>My progress</a></div>`;
  updateChips(); updateNotes();
  await say([{ role: "senior", en: `Well done. You earned ${app.xpCase} XP on this case. Your score card and free resources for further reading are below.` }], card);
}

// ---------------------------------------------------------------- review deck
async function renderReview() {
  const due = store.dueCards(db);
  shell(`<main class="review"><h1 data-i18n>Review deck</h1>
    <p class="muted" data-i18n>Questions you missed come back after 1, 3, 7, 14 and 30 days until you know them.</p>
    <p><b>${due.length}</b> <span data-i18n>due today</span> · ${db.deck.length} <span data-i18n>in the deck</span></p>
    <div id="rv"></div></main>`);
  let i = 0;
  const show = () => {
    const el = $("#rv"); const c = due[i];
    if (!c) { el.innerHTML = `<p data-i18n>All done for today.</p><a class="btn primary" href="#/">Back to the wards</a>`; translateUI(); return; }
    el.innerHTML = `<div class="card"><p class="muted small">${i + 1} / ${due.length}</p><p>${esc(c.stem)}</p><div class="opts">${c.options.map((o, k) => `<button class="opt" data-k="${k}"><b>${LETTER[k]}</b> ${esc(o)}</button>`).join("")}</div><div id="fb"></div></div>`;
    el.querySelectorAll(".opt").forEach(b => b.onclick = () => {
      const ok = c.options[+b.dataset.k] === c.answer;
      store.reviewCard(db, c.key, ok); if (ok) xp(5, "review");
      $("#fb").innerHTML = `<p class="${ok ? "ok" : "bad"}">${ok ? "Correct." : "The answer is <b>" + esc(c.answer) + "</b>."}</p><p class="muted small">${esc(c.src)}</p><button class="btn primary" id="nx">Next</button>`;
      el.querySelectorAll(".opt").forEach(x => x.disabled = true);
      $("#nx").onclick = () => { i++; show(); };
    });
  };
  show();
}

// ---------------------------------------------------------------- progress
async function renderProgress() {
  const w = await loadWards();
  const sm = store.summary(db), lv = store.level(db.xp);
  const names = { hist: "History", exam: "Examination", inv: "Investigations", dx: "Diagnosis", plan: "Plan", quiz: "Quiz" };
  const weakest = Object.entries(sm.skill).filter(([, v]) => v.avg != null).sort((a, b) => a[1].avg - b[1].avg)[0];
  shell(`
  <main class="progress">
    <h1 data-i18n>My progress</h1>
    <p class="muted" data-i18n>Stored only in this browser. Export the CSV to share with your faculty.</p>
    <div class="hero-stats">
      <div><b>${esc(lv.name)}</b><span>${db.xp} XP</span></div>
      <div><b>${db.sessions.length}</b><span data-i18n>cases done</span></div>
      <div><b>${store.streak(db)}</b><span data-i18n>day streak</span></div>
      <div><b>${weakest ? names[weakest[0]] : "—"}</b><span data-i18n>skill to work on</span></div>
    </div>
    <h2 class="sect" data-i18n>Badges</h2>
    <div class="badgegrid">${Object.entries(store.BADGES).map(([id, [n, d]]) => `<div class="badge ${db.badges.includes(id) ? "got" : ""}" title="${esc(d)}">🏅 ${esc(n)}<small>${esc(d)}</small></div>`).join("")}</div>
    <h2 class="sect" data-i18n>Skills</h2>
    <div class="bars">${Object.entries(sm.skill).map(([k, v]) => `<div class="bar"><span data-i18n>${names[k]}</span><div class="track"><i style="width:${v.avg == null ? 0 : Math.round(v.avg * 100)}%"></i></div><b>${pct(v.avg)}</b><em>n=${v.n}</em></div>`).join("")}</div>
    <h2 class="sect" data-i18n>By ward</h2>
    <div class="bars">${w.wards.map(x => { const n = (sm.byWard[x.id] || []).length; return `<div class="bar"><span>${esc(x.name)}</span><div class="track"><i style="width:${Math.min(100, n * 10)}%"></i></div><b>${n}</b><em>/ ${x.count}</em></div>`; }).join("")}</div>
    <h2 class="sect" data-i18n>What I learned</h2>
    <ul class="recent">${db.reflections.slice(-10).reverse().map(r => `<li><span class="muted small">${r.date.slice(0, 10)} · ${esc(r.title)}</span><br>${esc(r.text)}</li>`).join("") || "<li class='muted'>No reflections yet.</li>"}</ul>
    <div class="row"><button class="btn" id="csv" data-i18n>Export CSV</button><button class="btn danger" id="reset" data-i18n>Reset progress</button></div>
  </main>`);
  $("#csv").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([store.toCSV(db)], { type: "text/csv" })); a.download = "mediorounds_progress.csv"; a.click(); };
  $("#reset").onclick = () => { if (confirm("Delete all progress, XP, badges and review cards stored in this browser?")) { Object.assign(db, { sessions: [], xp: 0, badges: [], deck: [], reflections: [] }); store.save(db); renderProgress(); } };
}

// ---------------------------------------------------------------- about
async function renderAbout() {
  const w = await loadWards();
  let nd = 0; try { const d = await loadDrugs(); nd = d ? Object.keys(d.cards).length : 0; } catch {}
  shell(`
  <main class="about">
    <h1 data-i18n>About MediORounds</h1>
    <h2 class="sect" data-i18n>Where everything comes from</h2>
    <ul>
      <li><b>${w.total.toLocaleString()} patients</b>: real published case reports from the PubMed Central Open Access Subset (US National Library of Medicine), licensed CC BY or CC0, published ${esc(w.min_year)} onwards. The text is reproduced word for word and only split into ward-round stages.</li>
      <li><b>Images</b>: each article's own published figures, from the PMC Open Access cloud bucket (AWS Open Data), with credit to the authors.</li>
      <li><b>${nd.toLocaleString()} medicine cards</b>: quoted from official US drug labels (openFDA, public domain), with a link to the full label on DailyMed.</li>
      <li><b>Team questions, hints and quiz prompts</b>: fixed teaching prompts. Quiz questions use the case's own sentences and other real case titles.</li>
    </ul>
    <h2 class="sect" data-i18n>How the conversation works</h2>
    <p data-i18n>When you ask, the site finds the sentence in the case record that answers you and reads it out in the voice of the right team member: patient, nurse, radiologist, surgeon, neurologist, physiotherapist, intensivist and others. If the record doesn't cover it, you're told so rather than given a made-up answer. The same question on the same case always gets the same answer.</p>
    <h2 class="sect" data-i18n>Voice, languages and attention</h2>
    <p data-i18n>Speech uses your browser's built-in Web Speech features, and translation uses its on-device translator (recent desktop Chrome or Edge). Live mode listens, answers and listens again. You can interrupt by tapping, or by speaking if you turn that on (headphones recommended). If you look away for 5 seconds (tab hidden, window unfocused or, with the optional camera mode, no face seen), the audio pauses or keeps going, as you choose. Camera detection runs on your device, and nothing is uploaded.</p>
    <h2 class="sect" data-i18n>What this is not</h2>
    <p data-i18n>A learning simulator, not clinical guidance. Doses in a case report are what one team gave one patient. Never enter real patient details.</p>
  </main>`);
}

render();
